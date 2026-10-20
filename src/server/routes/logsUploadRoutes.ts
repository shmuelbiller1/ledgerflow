import { errorMessage, requestUser } from "../auth/requestUser";
import { apiLogsForWorkspace } from "../http/apiRequestLog";
import { formatTzDate, sendError, authorizeWorkspace, authenticate, upload } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import express from "express";
import { assertWorkspaceAccess, getDb } from "../db/firestore";
import fs from "fs";
import path from "path";
import { parse as parseCsv } from 'csv-parse/sync';
import crypto from "crypto";
import { TruthEngine } from "../../modules/integrity/TruthEngine";
import { validateUploadedFile } from "../utils/fileValidation";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerLogsUploadRoutes(app: express.Express, ctx: ServerContext): void {
  const { apiLogs } = ctx;
  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const getSafeUploadedFilePath = (uploadedPath: string): string | null => {
    const resolved = path.resolve(uploadedPath);
    const relative = path.relative(uploadRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return resolved;
  };
  app.get("/api/v1/logs", apiAuthenticate, async (req: express.Request, res: express.Response) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || requestUser(req).developerWorkspaceId;
      if (!workspaceId) return sendError(res, "Missing workspaceId parameters", 400);

      const authReq = req as AuthenticatedRequest;
      await authorizeWorkspace(authReq, workspaceId);

      // A scoped API key must never receive the global process log.
      const filtered = apiLogsForWorkspace(apiLogs, workspaceId);

      res.json(filtered);
    } catch (err) {
      if (errorMessage(err) === "NOT_FOUND" || errorMessage(err).includes("NOT_FOUND")) return res.json([]);
      if (errorMessage(err) === "FORBIDDEN") return sendError(res, "Forbidden workspace access", 403);
      sendError(res, errorMessage(err), 500);
    }
  });

  app.post("/api/upload-bank-csv", authenticate, upload.single("file"), async (req: express.Request, res: express.Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!req.file) return sendError(res, "No file uploaded", 400);

    const safeFilePath = getSafeUploadedFilePath(req.file.path);
    if (!safeFilePath) return sendError(res, "Invalid upload path", 400);

    const validation = await validateUploadedFile(safeFilePath);
    if (!validation.valid) {
      if (fs.existsSync(safeFilePath)) fs.unlinkSync(safeFilePath);
      return sendError(res, validation.error || "Invalid file content", 400);
    }

    try {
      const csvData = fs.readFileSync(safeFilePath, "utf8");
      const records: Array<Record<string, string>> = parseCsv(csvData, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true
      });

      if (!records || records.length === 0) {
        if (fs.existsSync(safeFilePath)) fs.unlinkSync(safeFilePath);
        return res.json([]);
      }

      const sampleKeys = Object.keys(records[0] || {});
      
      // Score-based column detector
      const findBestCol = (patterns: RegExp[], excludePatterns: RegExp[] = []): string | undefined => {
        let bestKey: string | undefined;
        let bestScore = -1;
        for (const key of sampleKeys) {
          const lower = key.toLowerCase().trim();
          if (excludePatterns.some(p => p.test(lower))) continue;
          for (let i = 0; i < patterns.length; i++) {
            if (patterns[i].test(lower)) {
              const score = 100 - i * 10;
              if (score > bestScore) {
                bestScore = score;
                bestKey = key;
              }
            }
          }
        }
        return bestKey;
      };

      const dateKey = findBestCol([/^date$/i, /^trans(action)?[_\s]?date$/i, /^posted[_\s]?date$/i, /date/i]);
      const descKey = findBestCol([/^description$/i, /^memo$/i, /^payee$/i, /^narrative$/i, /^details$/i, /desc/i, /name/i]);
      const debitKey = findBestCol([/^debit$/i, /^withdrawal$/i, /^outflow$/i, /^charge$/i, /^debit[_\s]?amount$/i], [/balance/i]);
      const creditKey = findBestCol([/^credit$/i, /^deposit$/i, /^inflow$/i, /^payment$/i, /^credit[_\s]?amount$/i], [/balance/i]);
      const amountKey = findBestCol([/^amount$/i, /^total$/i, /^net$/i, /^sum$/i, /amount/i], [/balance/i, /account[_\s]?num/i, /debit/i, /credit/i]);
      const categoryKey = findBestCol([/^category$/i, /^account[_\s]?category$/i, /^class$/i, /^label$/i, /category/i]);

      // dates without a year/format fall back to today in the workspace's time zone
      const uploadWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
      const wsData = uploadWorkspaceId ? (await assertWorkspaceAccess(getDb(), uploadWorkspaceId, authReq.user)).data : undefined;
      const normalizeDate = (rawDate: string): string => {
        if (!rawDate) return formatTzDate(new Date(), wsData?.settings?.timezone || wsData?.timezone);
        const s = rawDate.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const usMatch = s.match(/^(\d{1,2})[/|-](\d{1,2})[/|-](\d{2,4})$/);
        if (usMatch) {
          const [, m, d, yRaw] = usMatch;
          let y = yRaw;
          if (y.length === 2) {
            y = parseInt(y, 10) > 50 ? '19' + y : '20' + y;
          }
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) {
          return formatTzDate(parsed, wsData?.settings?.timezone || wsData?.timezone);
        }
        return formatTzDate(new Date(), wsData?.settings?.timezone || wsData?.timezone);
      };

      const batchId = crypto.randomUUID().split('-')[0];
      const transactions: Array<{ id: string; date: string; description: string; amountCents: number; category?: string }> = [];
      const rejected: Array<{ row: number; reason: string; raw: Record<string, string> }> = [];

      records.forEach((r, idx) => {
        try {
          let amountCents = 0;
          if (debitKey && creditKey && (r[debitKey] !== undefined || r[creditKey] !== undefined)) {
            const deb = TruthEngine.parseAmountToCentsOrZero(r[debitKey]);
            const cred = TruthEngine.parseAmountToCentsOrZero(r[creditKey]);
            amountCents = cred - deb;
          } else if (amountKey && r[amountKey] !== undefined) {
            amountCents = TruthEngine.parseAmountToCents(r[amountKey]);
          } else {
            throw new Error("No amount column found for row");
          }

          const rawDate = dateKey ? r[dateKey] : '';
          const date = normalizeDate(rawDate);
          const description = (descKey ? r[descKey] : '') || "Bank Transaction";
          const categoryVal = categoryKey ? r[categoryKey] : null;

          transactions.push({
            id: `csv-${batchId}-${idx}`,
            date,
            description: description.trim(),
            amountCents,
            category: categoryVal ? categoryVal.trim() : undefined
          });
        } catch (rowErr) {
          rejected.push({
            row: idx + 1,
            reason: errorMessage(rowErr) || "Invalid row format",
            raw: r
          });
        }
      });

      fs.unlinkSync(req.file.path);
      res.json(transactions);
    } catch (error) {
      if (fs.existsSync(safeFilePath)) fs.unlinkSync(safeFilePath);
      if (/not a member|API key is scoped/i.test(errorMessage(error))) return sendError(res, "Forbidden workspace access", 403);
      sendError(res, "Failed to parse CSV", 500, error);
    }
  });
}
