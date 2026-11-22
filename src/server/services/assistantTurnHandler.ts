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
import type express from 'express';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { ASSISTANT_SYSTEM_PROMPT } from '../../../assistant/systemPrompt.generated';
import type { reviewSandbox } from '../commands/sandboxReview';
import type { Firestore } from '../db/firestore';
import { assistantLimitRefusal, assistantUsage } from '../middleware/planCapacity';
import { assistantToolsFor, draftableCommands } from './assistantCatalog';
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
  runReadTool: (live: Firestore, req: express.Request, res: express.Response, sandbox: Sandbox, tool: string,
    input: Record<string, unknown>, cache?: ToolCache) => Promise<{ status: number; body: unknown; cached: boolean }>;
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
    const commands = draftableCommands(workspace, user);

    const usage = await assistantUsage(live, workspaceId, workspace);
    const refusal = usage ? assistantLimitRefusal(usage) : null;
    const decision = routeQuestion(question);
    if (refusal && decision.path === 'model') return res.status(402).json({ status: 'error', ...refusal });
    const client = deps.modelClient ? deps.modelClient() : routedModelClient(await geminiClient());
    if (!client && decision.path === 'model') {
      return res.status(503).json({ status: 'error', code: 'ASSISTANT_MODEL_UNAVAILABLE', message: 'The assistant model is not configured. Questions the books answer directly still work.' });
    }
    const models = assistantModels();
    const tools = assistantToolsFor(commands, question)[0].functionDeclarations as FunctionDeclaration[];

    const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const proposal = PROPOSE.exec(name);
      if (proposal) {
        // the same drafting intent the assistant token has: the step lands in the sandbox, never the books
        const review = await helpers.draftStep(req, { workspaceId, sandboxId: sandbox.sandboxId }, `${proposal[1]}.${proposal[2]}`, args);
        const step = review.steps.at(-1);
        return { drafted: true, proposalId: review.id, step: step ? { id: step.id, command: step.command, state: step.state, preview: step.preview } : null };
      }
      const { status, body } = await helpers.runReadTool(live, req, res, sandbox, name, args, passThrough);
      if (status !== 200) return { error: (body as { message?: string } | undefined)?.message ?? 'The tool refused this request' };
      return body;
    };
    const discover = (tool: string, result: unknown): FunctionDeclaration[] => {
      if (tool !== 'find_command') return [];
      const matches = (result as { matches?: Array<{ tool?: FunctionDeclaration }> })?.matches ?? [];
      return matches.flatMap(match => (match.tool ? [match.tool] : []));
    };

    const { answer, metric } = await answerTurn({
      client: refusal || !client ? blockedClient : client,
      model: models.simple,
      systemPrompt: ASSISTANT_SYSTEM_PROMPT,
      tools, question, callTool, discover,
      cache: sandboxToolCache(live.pool, sandbox),
      currency: typeof workspace.currency === 'string' ? workspace.currency : null,
      modelRule: { choose: reason => chooseModel(question, reason, commands, models), strong: models.strong },
    });
    if (metric.path === 'model' && refusal) return res.status(402).json({ status: 'error', ...refusal });
    if (metric.path === 'model' && !client) {
      return res.status(503).json({ status: 'error', code: 'ASSISTANT_MODEL_UNAVAILABLE', message: 'The assistant model is not configured. Questions the books answer directly still work.' });
    }
    await recordAssistantTurn(live, workspaceId, user.uid, metric);
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
