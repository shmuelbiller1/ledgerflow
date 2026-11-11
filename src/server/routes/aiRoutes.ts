import { errorMessage } from '../auth/requestUser';
import express from "express";
import { z } from "zod";
import { verifyIdToken } from "../auth/supabaseAuth";
import { AIBackendService } from "../services/aiBackendService";
import { allowedPayload, type AiCallTrace } from "../services/aiGateway";
import { SecurityService } from "../../services/securityService";
import { getDb, validateWorkspaceMember } from "../db/firestore";
import { incrementShardedCounter, getShardedCounterValue } from "../services/shardedCounterService";

export const aiRouter = express.Router();

const AiTaskEnum = z.enum([
  'strategic-analysis',
  'generate-forecast',
  'map-transactions',
  'analyze-trends',
  'parse-query',
  'parse-magic-entry',
  'parse-receipt',
  'parse-statement',
  'parse-personal-tax-profile',
  'build-auto-rule',
  'chat',
  'parse-business-blueprint'
]);

const AiProcessSchema = z.object({
  task: AiTaskEnum,
  payload: z.record(z.string(), z.any()).optional().default({})
});

const TASK_WEIGHTS: Record<string, number> = {
  'strategic-analysis': 500,
  'generate-forecast': 300,
  'map-transactions': 200,
  'analyze-trends': 300,
  'parse-query': 50,
  'parse-magic-entry': 100,
  'parse-receipt': 150,
  'parse-statement': 250,
  'parse-personal-tax-profile': 200,
  'build-auto-rule': 300,
  'chat': 100,
  'parse-business-blueprint': 400
};

aiRouter.post("/process", async (req: express.Request, res: express.Response) => {
  // 1. Standard token validation FIRST (No guest/test bypass allowed)
  // Ensures unauthenticated calls return 401 even before key check
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ status: "error", message: "Unauthenticated: No token provided" });
  }

  const token = authHeader.split("Bearer ")[1];
  let decodedToken: Awaited<ReturnType<typeof verifyIdToken>>;
  try {
    decodedToken = await verifyIdToken(token);
  } catch {
    return res.status(401).json({ status: "error", message: "Unauthenticated: Invalid token" });
  }

  // 2. Ensure GEMINI_API_KEY is configured
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      status: "error",
      message: "AI service is currently unavailable. Gemini API key is missing."
    });
  }

  // 3. Parse and validate req body
  const parsed = AiProcessSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: "error",
      message: "Invalid AI task specification",
      errors: parsed.error.issues
    });
  }

  const { task } = parsed.data;
  const rawPayload = parsed.data.payload;
  const workspaceId =
    typeof rawPayload.workspaceId === 'string' && rawPayload.workspaceId.trim().length > 0
      ? rawPayload.workspaceId.trim()
      : typeof req.headers['x-workspace-id'] === 'string' && (req.headers['x-workspace-id'] as string).trim().length > 0
      ? (req.headers['x-workspace-id'] as string).trim()
      : null;

  // Enforce required workspaceId - no bypass allows free AI
  if (!workspaceId) {
    return res.status(400).json({
      status: "error",
      message: "Bad Request: workspaceId is required in payload or x-workspace-id header."
    });
  }

  // 4. Workspace membership authorization & credit verification
  const db = getDb();
  let wsData: Record<string, unknown> | undefined;
  try {
    const memberValidation = await validateWorkspaceMember(db, workspaceId, decodedToken);
    wsData = memberValidation.data;
  } catch (err) {
    return res.status(403).json({
      status: "error",
      message: errorMessage(err) || "Forbidden: You are not authorized to access this workspace."
    });
  }

  // 5. Compute Credit Checking
  if (wsData && wsData.bypassBilling !== true) {
    const baseline = wsData.computeCreditBalance !== undefined ? Number(wsData.computeCreditBalance) : 100000;
    const currentBalance = await getShardedCounterValue(db, workspaceId, 'computeCreditBalance', baseline);
    
    if (currentBalance <= 0) {
      return res.status(402).json({
        status: "error",
        message: "PAYMENT_REQUIRED: This workspace has exhausted its compute credit balance (0 left). Please upgrade your plan or top up in settings."
      });
    }
  }

  // only the fields this task declares reach the model (src/server/services/aiGateway.ts)
  const payload = allowedPayload(task, rawPayload);

  // Scrub PII on chat or textual inputs
  if (payload.query && typeof payload.query === 'string') {
    payload.query = SecurityService.scrubPII(payload.query);
  }
  if (payload.input && typeof payload.input === 'string') {
    payload.input = SecurityService.scrubPII(payload.input);
  }
  if (payload.message && typeof payload.message === 'string') {
    payload.message = SecurityService.scrubPII(payload.message);
  }

  const weight = TASK_WEIGHTS[task] || 100;

  try {
    // 6. Charge compute credits before execution
    if (wsData && wsData.bypassBilling !== true) {
      await incrementShardedCounter(db, workspaceId, 'computeCreditBalance', -weight);
    }

    // 7. Process task
    const traces: AiCallTrace[] = [];
    const result = await AIBackendService.processTask(task, payload, traces);
    await recordAiTraces(db, workspaceId, String(decodedToken?.uid || ''), task, traces, result);
    return res.json(result);
  } catch (err) {
    // Refund credits on failure so user is never charged for failed tasks
    if (wsData && wsData.bypassBilling !== true) {
      await incrementShardedCounter(db, workspaceId, 'computeCreditBalance', weight).catch((refundErr) => {
        console.error('[AI Route] Credit refund failed:', errorMessage(refundErr));
      });
    }
    return res.status(503).json({
      status: "error",
      message: errorMessage(err) || "AI task processing failed. Service Unavailable."
    });
  }
});

/** One trace record per AI request: the task, each model call, and whether the answer was degraded. */
async function recordAiTraces(db: ReturnType<typeof getDb>, workspaceId: string, uid: string, task: string, traces: AiCallTrace[], result: unknown) {
  try {
    const id = `trace-${crypto.randomUUID()}`;
    await db.collection('billingLedgerTraces').doc(id).set({
      id, workspaceId, uid, algorithmName: `AI_TASK_${task}`, calls: traces,
      executionTimeMs: traces.reduce((s, t) => s + t.ms, 0),
      degraded: Boolean((result as { degraded?: boolean } | null)?.degraded) || traces.length === 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AI trace not recorded]', err);
  }
}
