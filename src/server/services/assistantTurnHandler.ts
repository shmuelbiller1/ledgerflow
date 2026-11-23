/**
 * SBX-2: one assistant turn on the server, for the person signed in to their own sandbox
 * (`POST /api/v1/workspaces/:workspaceId/sandboxes/:sandboxId/assistant/turn`, body `{ question }`).
 *
 * Before SBX-2 there was no assistant chat loop on the server: the sandbox's tools were built but never
 * given to a model. This is the thinnest one Parts 2–7 need, and every part is applied here:
 *
 * - Part 2: the router answers what the books answer exactly, from a template, without a model.
 * - Part 4: read results come from the read cache while the books are at the same version.
 * - Part 5: the read tools plus the commands of the question's areas, ≤ 25; `find_command` for the rest.
 * - Part 6: the written model rule picks the simple or the strong model and is logged.
 * - Part 7: model turns and model spend are held against the plan; at the limit the turn is refused
 *   politely (code answers still work), never moved to a cheaper model.
 *
 * Boundaries from SBX-1 do not change: the model can only read the sandbox and draft steps into it
 * (`propose_…` → the same `add` intent the assistant token uses). Nothing here accepts a step or
 * writes to the real books. The stored metric holds no question, answer, amounts or names.
 */
import { assistantFacts, todayIn } from './assistantFacts';
import type express from 'express';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { ASSISTANT_SYSTEM_PROMPT } from '../../../assistant/systemPrompt.generated';
import type { reviewSandbox } from '../commands/sandboxReview';
import type { Firestore } from '../db/firestore';
import { assistantLimitRefusal, assistantUsage, reserveAssistantModelTurn } from '../middleware/planCapacity';
import { assistantToolsFor, draftableCommands } from './assistantCatalog';
import { geminiReadTools } from './assistantToolDefinitions';
import { assistantModels, chooseModel, routedModelClient } from './assistantModels';
import { sandboxToolCache, type ToolCache } from './assistantReadCache';
import { answerTurn, routeQuestion } from './assistantRouter';
import { recordAssistantTurn, type ModelClient } from './assistantTurn';
import { CommandRefusal } from '../utils/commandExecutor';
import type { RequestUser } from '../auth/requestUser';

export const assistantTurnBody = z.object({ question: z.string().trim().min(1).max(2000) }).strict();

/** What the sandbox router hands over: its own sandbox check and read-tool runner (no second copy). */
export interface TurnHelpers<Sandbox extends { workspaceId: string; sandboxId: string; workspace: Record<string, unknown>; user: RequestUser }> {
  readableSandbox: (live: Firestore, req: express.Request) => Promise<Sandbox>;
  /** A server-selected live-books mode, never a client-supplied permission. */
  readOnly?: boolean;
  runReadTool: (live: Firestore, req: express.Request, res: express.Response, sandbox: Sandbox, tool: string,
    input: Record<string, unknown>, cache?: ToolCache, policy?: 'sandbox' | 'live-assistant') => Promise<{ status: number; body: unknown; cached: boolean }>;
  /**
   * The only way a turn changes anything: the SBX-1 review service's `add` intent, which drafts a step
   * into the sandbox overlay (never a real row). Passed in at the route so the drafting door is visible
   * where the route is registered.
   */
  draftStep: (req: express.Request, scope: { workspaceId: string; sandboxId: string }, command: string, input: Record<string, unknown>) => ReturnType<typeof reviewSandbox>;
}

export interface TurnDependencies {
  /** The Gemini client, or null when no key is configured (code answers still work). */
  modelClient?: () => ModelClient | null;
}

/** The Gemini client from GEMINI_API_KEY, as AIBackendService makes it. */
async function geminiClient(): Promise<ModelClient | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey }) as unknown as ModelClient;
}

class ModelNotAllowed extends Error {}
const blockedClient: ModelClient = { models: { generateContent: async () => { throw new ModelNotAllowed('no model for this turn'); } } };
/** The route's own cache layer is the turn's (so hits show in the metric); the tool runner does not cache again. */
const passThrough: ToolCache = { read: async (_tool, _args, run) => ({ value: (await run()).value, hit: false }) };

const LIVE_READ_TOOLS = new Set(['list_records', 'get_record', 'search_records', 'calculate', 'run_report', 'explain_number', 'ask_books']);
// Member-readable collections only; this must be reviewed when adding a new collection.
const LIVE_COLLECTIONS = new Set(['bills', 'budgets', 'chartAccounts', 'creditNotes', 'customers', 'dimensionNodes', 'documents', 'estimates', 'fixedAssets', 'inventory', 'invoices', 'journalEntries', 'loans', 'paymentAllocations', 'payments', 'periods', 'projects', 'purchaseOrders', 'reconciliations', 'recurring', 'stockMoves', 'taxRates', 'transactions', 'vendorCredits', 'vendors']);
const DEFAULT_LIVE_SEARCH = ['customers', 'vendors', 'invoices', 'bills', 'payments', 'transactions', 'chartAccounts', 'inventory', 'projects', 'documents'];
// Live report routers also have cross-workspace endpoints. Explicitly admit only reviewed, single-book readers.
const LIVE_REPORTS = new Set(['aging']);
const LIVE_BALANCES = new Set<string>();
function liveReadAllowed(name: string, args: Record<string, unknown>): boolean {
  if (!LIVE_READ_TOOLS.has(name)) return false;
  if ((name === 'get_record' || name === 'list_records') && (typeof args.collection !== 'string' || !LIVE_COLLECTIONS.has(args.collection))) return false;
  if (name === 'search_records' && args.collections !== undefined && (!Array.isArray(args.collections) || !args.collections.every(c => typeof c === 'string' && LIVE_COLLECTIONS.has(c)))) return false;
  if (name === 'run_report') {
    const reports = args.source === 'balances' ? LIVE_BALANCES : args.source === 'reports' || args.source === undefined ? LIVE_REPORTS : null;
    return typeof args.report === 'string' && !!reports?.has(args.report);
  }
  return true;
}

/** Keep the offered schema aligned with the server-side collection check. Never trust it as authorization. */
function liveToolDeclaration(tool: FunctionDeclaration): FunctionDeclaration {
  const result = structuredClone(tool);
  result.description = `${tool.description} Employee records are unavailable. Record fields, filters and search are restricted; direct record reads omit banking and tax identifiers. Reports are limited to aging summaries.`;
  const schema = result.parametersJsonSchema as { properties?: Record<string, { enum?: string[]; items?: { enum?: string[] } }> } | undefined;
  const properties = schema?.properties;
  if (properties?.collection?.enum) properties.collection.enum = properties.collection.enum.filter(c => LIVE_COLLECTIONS.has(c));
  if (properties?.collections?.items?.enum) properties.collections.items.enum = properties.collections.items.enum.filter(c => LIVE_COLLECTIONS.has(c));
  return result;
}

/** Only aggregate fields from reports reach the model; report line text can contain secrets. */
function privateToolResult(name: string, body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const data = body as Record<string, unknown>;
  if (name === 'run_report') return Object.fromEntries(['current', '1-30', '31-60', '61-90', '90+', 'total']
    .filter(key => typeof data[key] === 'number').map(key => [key, data[key]]));
  if (name === 'explain_number') return typeof data.totalCents === 'number' ? { totalCents: data.totalCents } : {};
  if (name === 'ask_books') {
    const answer = data.answer && typeof data.answer === 'object' ? data.answer as Record<string, unknown> : null;
    return { question: data.question, today: data.today, reading: data.reading,
      answer: answer && typeof answer.answerCents === 'number' ? { answerCents: answer.answerCents } : null };
  }
  return body;
}

const PROPOSE = /^propose_([a-z][a-z0-9]*)_([a-z][a-z0-9]*)$/;

export function assistantTurnHandler<Sandbox extends { workspaceId: string; sandboxId: string; workspace: Record<string, unknown>; user: RequestUser }>(
  live: Firestore, helpers: TurnHelpers<Sandbox>, deps: TurnDependencies = {},
) {
  return async (req: express.Request, res: express.Response) => {
    const parsed = assistantTurnBody.safeParse(req.body);
    if (!parsed.success) throw new CommandRefusal('Ask a question of up to 2,000 characters', 400, 'INVALID_INPUT', parsed.error.issues);
    const { question } = parsed.data;
    const sandbox = await helpers.readableSandbox(live, req);
    const { workspaceId, workspace, user } = sandbox;
    // Payroll proposals can replay sensitive employee data. Keep them out of provider turns until
    // their command inputs, previews and errors have a reviewed privacy contract.
    const commands = helpers.readOnly ? [] : draftableCommands(workspace, user)
      .filter(command => !/^(employee|payroll)\./.test(command.name));

    const usage = await assistantUsage(live, workspaceId, workspace);
    const refusal = usage ? assistantLimitRefusal(usage) : null;
    const decision = routeQuestion(question);
    if (refusal && decision.path === 'model') return res.status(402).json({ status: 'error', ...refusal });
    const client = deps.modelClient ? deps.modelClient() : routedModelClient(await geminiClient());
    if (!client && decision.path === 'model') {
      return res.status(503).json({ status: 'error', code: 'ASSISTANT_MODEL_UNAVAILABLE', message: 'The assistant model is not configured. Questions the books answer directly still work.' });
    }
    const models = assistantModels();
    const tools = (helpers.readOnly
      ? geminiReadTools.filter(tool => LIVE_READ_TOOLS.has(String(tool.name))).map(liveToolDeclaration)
      : assistantToolsFor(commands, question)[0].functionDeclarations
        .filter(tool => !['list_proposals', 'preview_proposal', 'remembered_choices'].includes(String(tool.name)))
        .map(tool => LIVE_READ_TOOLS.has(String(tool.name)) ? liveToolDeclaration(tool) : tool)) as FunctionDeclaration[];

    const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      // Defense in depth: even an unexpected model response cannot reach proposals or unlisted tools.
      if ((helpers.readOnly || LIVE_READ_TOOLS.has(name)) && !liveReadAllowed(name, args)) return { error: 'This is a read-only assistant; this tool is not available.' };
      const proposal = PROPOSE.exec(name);
      if (proposal) {
        // the same drafting intent the assistant token has: the step lands in the sandbox, never the books
        try {
          const review = await helpers.draftStep(req, { workspaceId, sandboxId: sandbox.sandboxId }, `${proposal[1]}.${proposal[2]}`, args);
          const step = review.steps.at(-1);
          return { drafted: true, proposalId: review.id, step: step ? { id: step.id, command: step.command, state: step.state } : null };
        } catch {
          // Command errors can contain record text or preview details. Show details to the person
          // through review, never hand an unclassified server exception to the provider.
          return { error: 'The draft could not be created. Review the draft workspace for details.' };
        }
      }
      // the model never sets "today": the books tool counts "this year" and "last month" from the workspace's own date
      const { today: _madeUp, ...readArgs } = args;
      const safeArgs = name === 'search_records' && args.collections === undefined ? { ...args, collections: DEFAULT_LIVE_SEARCH } : args;
      try {
        const { status, body } = await helpers.runReadTool(live, req, res, sandbox, name, name === 'ask_books' ? readArgs : safeArgs, passThrough, 'live-assistant');
        if (status !== 200) return { error: 'The tool refused this request.' };
        return privateToolResult(name, body);
      } catch {
        return { error: 'The tool refused this request.' };
      }
    };
    const discover = (tool: string, result: unknown): FunctionDeclaration[] => {
      if (helpers.readOnly || tool !== 'find_command') return [];
      const matches = (result as { matches?: Array<{ tool?: FunctionDeclaration }> })?.matches ?? [];
      return matches.flatMap(match => (match.tool ? [match.tool] : []));
    };

    // The first model call of the turn (a model question, or a code answer that fell short) first takes
    // a turn from the allowance; at the limit no model is called at all.
    let reservation: { id: string } | null = null;
    let refusedAtCall: NonNullable<ReturnType<typeof assistantLimitRefusal>> | null = null;
    let busy = false;
    const metered: ModelClient | null = client && !refusal ? { models: { generateContent: async request => {
      if (!reservation) {
        const reserved = await reserveAssistantModelTurn(live, workspaceId, user.uid, workspace).catch((err: unknown) => {
          busy = true;
          throw new ModelNotAllowed(err instanceof Error ? err.message : 'busy');
        });
        if ('refusal' in reserved) { refusedAtCall = reserved.refusal; throw new ModelNotAllowed('assistant allowance used'); }
        reservation = { id: reserved.id };
      }
      return client.models.generateContent(request);
    } } } : null;

    const { answer, metric } = await answerTurn({
      client: metered ?? blockedClient,
      model: models.simple,
      systemPrompt: helpers.readOnly ? `${ASSISTANT_SYSTEM_PROMPT}\n\nThis turn is read-only on the live books. You cannot create, review or modify drafts. Never claim you did. If a change is requested, explain that a writer must do it.` : ASSISTANT_SYSTEM_PROMPT,
      tools, question, callTool, discover,
      facts: assistantFacts({ today: todayIn(typeof workspace.timezone === 'string' ? workspace.timezone : null), timeZone: typeof workspace.timezone === 'string' ? workspace.timezone : null, currency: typeof workspace.currency === 'string' ? workspace.currency : null,
        fiscalYearStartMonth: typeof workspace.fiscalYearStartMonth === 'number' ? workspace.fiscalYearStartMonth : null,
        fiscalYearStartDay: typeof workspace.fiscalYearStartDay === 'number' ? workspace.fiscalYearStartDay : null }),
      cache: helpers.readOnly ? passThrough : sandboxToolCache(live.pool, sandbox, 'turn-private-v1', { timeZone: workspace.timezone }),
      currency: typeof workspace.currency === 'string' ? workspace.currency : null,
      modelRule: { choose: reason => chooseModel(question, reason, commands, models), strong: models.strong },
    });
    const refused = refusal ?? (refusedAtCall as NonNullable<ReturnType<typeof assistantLimitRefusal>> | null);
    if (metric.path === 'model' && refused && !reservation) return res.status(402).json({ status: 'error', ...refused });
    if (metric.path === 'model' && busy && !reservation) {
      return res.status(503).json({ status: 'error', code: 'ASSISTANT_BUSY', message: 'The assistant is busy for this workspace. Try again in a moment.' });
    }
    if (metric.path === 'model' && !client) {
      return res.status(503).json({ status: 'error', code: 'ASSISTANT_MODEL_UNAVAILABLE', message: 'The assistant model is not configured. Questions the books answer directly still work.' });
    }
    await recordAssistantTurn(live, workspaceId, user.uid, metric, (reservation as { id: string } | null)?.id);
    const after = usage && {
      ...usage,
      turns: usage.turns + 1,
      modelTurns: usage.modelTurns + (metric.modelCalls > 0 ? 1 : 0),
      inputTokens: usage.inputTokens + metric.inputTokens,
      outputTokens: usage.outputTokens + metric.outputTokens,
      costCents: usage.costCents + (metric.costCents ?? 0),
      unpricedTurns: usage.unpricedTurns + (metric.modelCalls > 0 && metric.costCents === null ? 1 : 0),
    };
    res.json({
      status: metric.ok ? 'success' : 'error', answer,
      path: metric.path, ...(metric.model ? { model: metric.model } : {}),
      ...(metric.modelTier ? { modelTier: metric.modelTier, modelReason: metric.modelReason } : {}),
      usage: after,
    });
  };
}
