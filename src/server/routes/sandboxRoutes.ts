import express from 'express';
import { z } from 'zod';
import { assistantAuthenticate, assistantClaims, issueAssistantToken } from '../auth/assistantToken';
import { requestUser } from '../auth/requestUser';
import { openSandbox, reviewSandbox, undoSandboxStep } from '../commands/sandboxReview';
import { getDb, isWorkspaceMemberData, type Firestore } from '../db/firestore';
import { validateSandboxId } from '../db/pg/sandbox';
import { listOpenSandboxes, ownsOpenSandbox } from '../db/pg/sandboxReviewStore';
import { roleInWorkspace } from '../middleware/requireLedgerWriter';
import { answerCents, calculate, explainNumberInput, getRecord, listRecords, readBooksQuestion, runReportInput, searchRecords } from '../services/sandboxTools';
import { defaultAssistantTools, draftableCommands, findAssistantCommands } from '../services/assistantCatalog';
import { ASSISTANT_READ_TOOL_NAMES, findCommandInput, listProposalsInput, previewProposalInput, rememberedChoicesInput } from '../services/assistantToolDefinitions';
import { listRemembered, suggestFor, suggestionFrom } from '../services/rememberedDecisions';
import { storedSandboxProposal } from '../services/storedSandboxProposal';
import { CommandRefusal, errorOutcome } from '../utils/commandExecutor';
import { createBalanceRouter } from './balanceRoutes';
import { createReportRouter } from './reportRoutes';

/**
 * SBX-1 "What the assistant can call" and "What the person can do", as HTTP.
 *
 * Two routers share one service (`commands/sandboxReview.ts`) and one data handle per sandbox
 * (`live.forSandbox(id)`, the sandbox-scoped `getDb`):
 *
 * - `createSandboxPersonRouter` is mounted under `/api/v1/workspaces/:workspaceId/sandboxes` behind
 *   the ordinary sign-in. The person opens a sandbox (and receives the assistant's token for it),
 *   reviews, accepts all or some steps, edits, reorders, rejects, undoes an accepted step, and reads
 *   "the books with this applied": every list, record, report or balance through the sandbox handle.
 * - `createSandboxAssistantRouter` is mounted under `/api/v1/sandboxes` behind `assistantAuthenticate`
 *   and nothing else accepts that token. It offers `add_step`, `edit_step`, `remove_step`, `reorder`,
 *   the review state, and the read tools. Every write it can reach lands in the overlay; the service
 *   refuses `accept`, `undo` and closing from an assistant principal.
 *
 * Reports and balances are the real routers bound to the sandbox handle (the same code as the live
 * mounts, no second implementation), built per request and dropped. They check the sandbox's person
 * and the live membership themselves (`reports/readScope.ts`).
 */

const revision = z.string().min(1).max(200);
const stepIds = z.array(z.string().uuid()).min(1).max(200);
const addBody = z.object({ command: z.string().min(3).max(120), input: z.unknown() }).strict();
const editBody = z.object({ input: z.unknown(), revision }).strict();
const orderBody = z.object({ stepIds, revision }).strict();
const rejectBody = z.object({ stepIds: stepIds.optional(), revision }).strict();
const removeBody = z.object({ revision }).strict();
const acceptBody = z.object({ stepIds: stepIds.optional(), confirmRechecked: z.array(z.string().uuid()).max(200).optional(), confirmHighRisk: z.string().uuid().optional(), revision }).strict();

type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;

function sendRefusal(res: express.Response, err: unknown) {
  const outcome = errorOutcome(err, 'sandbox');
  if (outcome.ok) return;
  if (outcome.status >= 500) console.error('[sandbox]', err);
  res.status(outcome.status).json({ status: 'error', message: outcome.message, ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.details !== undefined ? { details: outcome.details } : {}) });
}

const guarded = (handler: Handler): express.RequestHandler => async (req, res) => {
  try { await handler(req, res); }
  catch (err) { sendRefusal(res, err); }
};

const param = (req: express.Request, name: string) => String((req.params as Record<string, string>)[name] ?? '');

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new CommandRefusal('Invalid request body', 400, 'INVALID_INPUT', parsed.error.issues);
  return parsed.data;
}

function sandboxScope(req: express.Request) {
  let sandboxId: string;
  try { sandboxId = validateSandboxId(param(req, 'sandboxId')); }
  catch { throw new CommandRefusal('Expected a sandbox id', 400, 'INVALID_SANDBOX_ID'); }
  const claims = assistantClaims(req);
  const workspaceId = claims?.workspaceId ?? param(req, 'workspaceId');
  if (!workspaceId) throw new CommandRefusal('Workspace ID is required', 400, 'WORKSPACE_REQUIRED');
  return { workspaceId, sandboxId };
}

/** A sandbox the caller may read: it belongs to them, is open, and they are a live member. */
async function readableSandbox(live: Firestore, req: express.Request) {
  const scope = sandboxScope(req);
  const user = requestUser(req);
  if (!user?.uid || user.usedApiKeyId || user.developerWorkspaceId) throw new CommandRefusal('Only a signed-in person or their assistant can read a sandbox', 403, 'PERSON_ONLY');
  if (user.assistantSandboxId && user.assistantSandboxId !== scope.sandboxId) throw new CommandRefusal('This assistant token belongs to another sandbox', 403, 'ASSISTANT_SANDBOX_MISMATCH');
  if (!await ownsOpenSandbox(live.pool, { id: scope.sandboxId, workspaceId: scope.workspaceId, personId: user.uid })) throw new CommandRefusal('No open sandbox belongs to you in this workspace', 404, 'SANDBOX_NOT_FOUND');
  const workspace = (await live.collection('workspaces').doc(scope.workspaceId).get()).data();
  if (!workspace || !isWorkspaceMemberData(workspace, { uid: user.uid }, scope.workspaceId)) throw new CommandRefusal('You are not a member of these books', 403, 'FORBIDDEN');
  if (workspace.requireTwoStep === true && user.aal !== 'aal2') throw new CommandRefusal('Sign in with two-step verification for these books', 403, 'TWO_STEP_REQUIRED');
  const books = live.forSandbox(scope.sandboxId);
  return { ...scope, user, workspace, books };
}

/** Sends `req` through a router bound to the sandbox handle, at `url`, and answers with its response. */
function dispatch(router: express.Router, req: express.Request, res: express.Response, method: string, url: string, body?: unknown) {
  req.method = method;
  req.url = url;
  if (body !== undefined) req.body = body;
  router(req, res, err => {
    if (err) return sendRefusal(res, err);
    res.status(404).json({ status: 'error', code: 'REPORT_NOT_FOUND', message: `No such report: ${url.split('?')[0]}` });
  });
}

function boundRouters(live: Firestore, books: Firestore) {
  return { reports: createReportRouter(live, books), balances: createBalanceRouter(live, books) };
}

function toolRoutes(router: express.Router, live: Firestore) {
  // Reports and balances with the sandbox applied: the same routers, bound to the sandbox handle.
  for (const source of ['reports', 'balances'] as const) {
    router.use(`/:sandboxId/${source}`, guarded(async (req, res) => {
      const { books, workspaceId } = await readableSandbox(live, req);
      const search = new URLSearchParams(req.url.split('?')[1] ?? '');
      if (!search.has('workspaceId')) search.set('workspaceId', workspaceId);
      if (req.method === 'POST' && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) req.body = { ...req.body, workspaceId };
      dispatch(boundRouters(live, books)[source], req, res, req.method, `${req.path}?${search.toString()}`);
    }));
  }

  router.get('/:sandboxId/records/:collection', guarded(async (req, res) => {
    const { books, workspaceId } = await readableSandbox(live, req);
    const q = req.query as Record<string, unknown>;
    let where: unknown;
    if (typeof q.where === 'string') {
      try { where = JSON.parse(q.where); }
      catch { throw new CommandRefusal('`where` must be JSON', 400, 'INVALID_INPUT'); }
    }
    const orderBy = typeof q.orderBy === 'string' ? { field: q.orderBy, direction: q.direction === 'desc' ? 'desc' : 'asc' } : undefined;
    res.json(await listRecords(books, workspaceId, {
      collection: param(req, 'collection'), ...(where ? { where } : {}), ...(orderBy ? { orderBy } : {}),
      ...(q.limit ? { limit: Number(q.limit) } : {}), ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
      ...(typeof q.fields === 'string' ? { fields: q.fields.split(',').filter(Boolean) } : {}), count: q.count === '1' || q.count === 'true',
    }));
  }));

  router.get('/:sandboxId/records/:collection/:recordId', guarded(async (req, res) => {
    const { books, workspaceId } = await readableSandbox(live, req);
    res.json(await getRecord(books, workspaceId, { collection: param(req, 'collection'), id: param(req, 'recordId') }));
  }));

  router.get('/:sandboxId/tools', guarded(async (req, res) => {
    const { user, workspace } = await readableSandbox(live, req);
    const commands = draftableCommands(workspace, user, assistantClaims(req)?.role);
    res.json({ tools: defaultAssistantTools(commands), workspaceCurrency: typeof workspace.currency === 'string' ? workspace.currency : null });
  }));

  router.post('/:sandboxId/tools/:tool', guarded(async (req, res) => {
    const tool = param(req, 'tool');
    if (!(ASSISTANT_READ_TOOL_NAMES as readonly string[]).includes(tool)) {
      throw new CommandRefusal(`Unknown tool: ${tool}`, 404, 'TOOL_NOT_FOUND', { tools: ASSISTANT_READ_TOOL_NAMES });
    }
    const { books, workspaceId, workspace, sandboxId, user } = await readableSandbox(live, req);
    const binding = { id: sandboxId, workspaceId, personId: user.uid };
    const input = req.body && typeof req.body === 'object' ? req.body : {};
    const routers = () => boundRouters(live, books);
    switch (tool) {
      case 'list_records': return res.json(await listRecords(books, workspaceId, input));
      case 'get_record': return res.json(await getRecord(books, workspaceId, input));
      case 'search_records': return res.json(await searchRecords(books, workspaceId, input));
      case 'calculate': return res.json(calculate(input));
      case 'list_proposals': {
        parse(listProposalsInput, req.body ?? {});
        return res.json({ proposals: [await storedSandboxProposal(live.pool, binding, false)] });
      }
      case 'preview_proposal': {
        const { proposalId } = parse(previewProposalInput, req.body);
        if (proposalId !== sandboxId) throw new CommandRefusal('This proposal belongs to another sandbox', 403, 'ASSISTANT_SANDBOX_MISMATCH');
        return res.json({ proposal: await storedSandboxProposal(live.pool, binding, true) });
      }
      case 'remembered_choices': {
        const body = parse(rememberedChoicesInput, req.body);
        return res.json({ suggestions: suggestFor(body.command, body.input, await listRemembered(live.pool, workspaceId)) });
      }
      case 'find_command': {
        const { words, limit } = parse(findCommandInput, req.body);
        const commands = draftableCommands(workspace, user, assistantClaims(req)?.role);
        return res.json({ matches: findAssistantCommands(commands, words, limit) });
      }
      case 'run_report': {
        const { report, source, params } = parse(runReportInput, input);
        const search = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
        search.set('workspaceId', workspaceId);
        const routeTable = routers() as Record<string, unknown>;
        const selectedRouter = routeTable[source];
        if (typeof selectedRouter !== 'function') {
          throw new CommandRefusal(`Unknown report source: ${source}`, 404, 'REPORT_SOURCE_NOT_FOUND');
        }
        return dispatch(selectedRouter as express.Router, req, res, 'GET', `/${report}?${search.toString()}`);
      }
      case 'explain_number': {
        const explain = parse(explainNumberInput, input);
        return dispatch(routers().reports, req, res, 'POST', '/explain', { ...explain, workspaceId });
      }
      case 'ask_books': {
        const { question, reading, today } = await readBooksQuestion(books, workspaceId, workspace, input);
        if (!reading.filter) return res.json({ question, today, reading, answer: null });
        const { accountIds, startDate, endDate, label } = reading.filter;
        const body = { workspaceId, accountIds, startDate, endDate, ...(label ? { labelDimension: label.dimensionId, labelValue: label.value } : {}) };
        const original = res.json.bind(res);
        res.json = ((payload: unknown) => {
          const explanation = payload as { totalCents?: number } | undefined;
          return typeof explanation?.totalCents === 'number'
            ? original({ question, today, reading, answer: { ...explanation, answerCents: answerCents(explanation.totalCents, reading.sense), sense: reading.sense } })
            : original(payload);
        }) as typeof res.json;
        return dispatch(routers().reports, req, res, 'POST', '/explain', body);
      }
      default: throw new CommandRefusal(`Unknown tool: ${tool}`, 404, 'TOOL_NOT_FOUND');
    }
  }));
}

/** Drafting routes, shared by both principals: the person may also draft by hand. */
function draftRoutes(router: express.Router, live: Firestore) {
  router.get('/:sandboxId', guarded(async (req, res) => res.json(await reviewSandbox(req, sandboxScope(req), { kind: 'review' }, live))));
  // Command metadata for this binding. The provider's loadable functions are at /tools.
  router.get('/:sandboxId/commands', guarded(async (req, res) => {
    const { user, workspace } = await readableSandbox(live, req);
    res.json({ commands: draftableCommands(workspace, user, assistantClaims(req)?.role).map(command => {
      return { name: command.name, risk: command.risk, ...(command.capacity ? { metered: true } : {}), sentence: command.describe.sentence, example: command.describe.example };
    }) });
  }));
  router.post('/:sandboxId/steps', guarded(async (req, res) => {
    const { command, input } = parse(addBody, req.body);
    res.status(201).json(await reviewSandbox(req, sandboxScope(req), { kind: 'add', command, input }, live));
  }));
  router.put('/:sandboxId/steps/order', guarded(async (req, res) => {
    const body = parse(orderBody, req.body);
    res.json(await reviewSandbox(req, sandboxScope(req), { kind: 'reorder', stepIds: body.stepIds, revision: body.revision }, live));
  }));
  router.put('/:sandboxId/steps/:stepId', guarded(async (req, res) => {
    const body = parse(editBody, req.body);
    res.json(await reviewSandbox(req, sandboxScope(req), { kind: 'edit', stepId: param(req, 'stepId'), input: body.input, revision: body.revision }, live));
  }));
  router.delete('/:sandboxId/steps/:stepId', guarded(async (req, res) => {
    const body = parse(removeBody, req.body);
    res.json(await reviewSandbox(req, sandboxScope(req), { kind: 'reject', stepIds: [param(req, 'stepId')], revision: body.revision }, live));
  }));
}

async function tokenFor(live: Firestore, req: express.Request, workspaceId: string, sandboxId: string) {
  const user = requestUser(req);
  const workspace = (await live.collection('workspaces').doc(workspaceId).get()).data();
  return issueAssistantToken({ sandboxId, personId: user.uid, workspaceId, role: roleInWorkspace(workspace, user.uid), aal: typeof user.aal === "string" ? user.aal : undefined, email: user.email });
}

/** Mounted under /api/v1/workspaces/:workspaceId/sandboxes behind the ordinary sign-in. */
export function createSandboxPersonRouter(live: Firestore = getDb()): express.Router {
  const router = express.Router({ mergeParams: true });
  router.use((req, res, next) => {
    if (requestUser(req)?.assistantSandboxId) {
      res.status(403).json({ status: 'error', code: 'ASSISTANT_CANNOT_COMMIT', message: 'Only the person can use this address' });
      return;
    }
    next();
  });
  router.get('/', guarded(async (req, res) => {
    const user = requestUser(req);
    const workspaceId = param(req, 'workspaceId');
    if (!user?.uid) throw new CommandRefusal('Sign in required', 401, 'UNAUTHENTICATED');
    if (user.usedApiKeyId || user.developerWorkspaceId) throw new CommandRefusal('Only a signed-in person can list sandboxes', 403, 'PERSON_ONLY');
    const workspace = (await live.collection('workspaces').doc(workspaceId).get()).data();
    if (!workspace || !isWorkspaceMemberData(workspace, { uid: user.uid }, workspaceId)) throw new CommandRefusal('You are not a member of these books', 403, 'FORBIDDEN');
    res.json({ sandboxes: await listOpenSandboxes(live.pool, workspaceId, user.uid) });
  }));
  // SBX-2 Part 3: a member sees and deletes what this workspace remembers. Person only, one workspace.
  const memberWorkspace = async (req: express.Request) => {
    const user = requestUser(req);
    const workspaceId = param(req, 'workspaceId');
    if (!user?.uid) throw new CommandRefusal('Sign in required', 401, 'UNAUTHENTICATED');
    if (user.usedApiKeyId || user.developerWorkspaceId || user.assistantSandboxId) throw new CommandRefusal('Only a signed-in person can manage remembered decisions', 403, 'PERSON_ONLY');
    const workspace = (await live.collection('workspaces').doc(workspaceId).get()).data();
    if (!workspace || !isWorkspaceMemberData(workspace, { uid: user.uid }, workspaceId)) throw new CommandRefusal('You are not a member of these books', 403, 'FORBIDDEN');
    return workspaceId;
  };
  router.get('/remembered', guarded(async (req, res) => {
    const rows = await listRemembered(live.pool, await memberWorkspace(req));
    res.json({ remembered: rows.map(row => ({ ...row, offered: suggestionFrom(row) ?? null })) });
  }));
  // forgetting is the registered command assistant.forgetremembered (POST /api/v1/commands/assistant.forgetremembered)
  router.post('/', guarded(async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const sandbox = await openSandbox(req, workspaceId, live);
    const assistant = await tokenFor(live, req, workspaceId, sandbox.id);
    res.status(201).json({ sandbox, assistant });
  }));
  router.post('/:sandboxId/token', guarded(async (req, res) => {
    const { workspaceId, sandboxId } = await readableSandbox(live, req);
    res.json({ assistant: await tokenFor(live, req, workspaceId, sandboxId) });
  }));
  draftRoutes(router, live);
  toolRoutes(router, live);
  router.post('/:sandboxId/accept', guarded(async (req, res) => {
    const body = parse(acceptBody, req.body);
    res.json(await reviewSandbox(req, sandboxScope(req), { kind: 'accept', ...body }, live));
  }));
  router.post('/:sandboxId/reject', guarded(async (req, res) => {
    const body = parse(rejectBody, req.body);
    res.json(await reviewSandbox(req, sandboxScope(req), { kind: 'reject', ...body }, live));
  }));
  router.post('/:sandboxId/steps/:stepId/undo', guarded(async (req, res) => {
    const { step, outcome } = await undoSandboxStep(req, sandboxScope(req), param(req, 'stepId'), live);
    res.status(outcome.ok ? 200 : outcome.status).json(outcome.ok
      ? { status: 'success', step, data: outcome.data }
      : { status: 'error', step, message: outcome.message, ...(outcome.code ? { code: outcome.code } : {}) });
  }));
  return router;
}

/** Mounted under /api/v1/sandboxes behind `assistantAuthenticate` only. */
export function createSandboxAssistantRouter(live: Firestore = getDb()): express.Router {
  const router = express.Router();
  router.use(assistantAuthenticate);
  draftRoutes(router, live);
  toolRoutes(router, live);
  return router;
}

/**
 * SBX-1's two doors: the person's sandbox review under the workspace (behind the ordinary sign-in) and the
 * assistant's drafting and read tools (its own token only; see `assistantAuthenticate`). Mounted before
 * `/api/v1/workspaces` so the nested address is not swallowed by the workspace router.
 */
export function registerSandboxRoutes(app: express.Express, signIn: express.RequestHandler, live: Firestore = getDb()): void {
  app.use('/api/v1/workspaces/:workspaceId/sandboxes', signIn, createSandboxPersonRouter(live));
  app.use('/api/v1/sandboxes', createSandboxAssistantRouter(live));
}
