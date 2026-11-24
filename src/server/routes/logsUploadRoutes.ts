import { isForbidden } from '../http/serverKit';
import { errorMessage, requestUser } from "../auth/requestUser";
import { apiLogsForWorkspace } from "../http/apiRequestLog";
import { formatTzDate, sendError, authorizeWorkspace, authenticate, upload, uploadedFilePath } from "../http/serverKit";
import type { AuthenticatedRequest, ServerContext } from "../http/serverKit";
import { apiAuthenticate } from "../auth/apiAuthenticate";
import express from "express";
import { assertWorkspaceAccess, getDb } from "../db/firestore";
import fs from "fs";
import { parse as parseCsv } from 'csv-parse/sync';
import crypto from "crypto";
import { TruthEngine } from "../../modules/integrity/TruthEngine";
import { civilDateParts } from '../../lib/calendarDate';
import { validateUploadedFile } from "../utils/fileValidation";

/** Routes moved out of server.ts (F-01), registered in the same place and order. */
export function registerLogsUploadRoutes(app: express.Express, ctx: ServerContext): void {
  const { apiLogs } = ctx;
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
      if (isForbidden(errorMessage(err))) return sendError(res, "Forbidden workspace access", 403);
      sendError(res, errorMessage(err), 500);
    }
  });

  app.post("/api/upload-bank-csv", authenticate, upload.single("file"), async (req: express.Request, res: express.Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!req.file) return sendError(res, "No file uploaded", 400);
    let filePath: string;
    try {
      filePath = uploadedFilePath(req.file);
    } catch {
      return sendError(res, "Invalid upload", 400);
    }

    const validation = await validateUploadedFile(filePath);
    if (!validation.valid) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return sendError(res, validation.error || "Invalid file content", 400);
    }

    try {
      const csvData = fs.readFileSync(filePath, "utf8");
      const records: Array<Record<string, string>> = parseCsv(csvData, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true
      });

      if (!records || records.length === 0) {
        fs.unlinkSync(filePath);
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

      const uploadWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
      const wsData = uploadWorkspaceId ? (await assertWorkspaceAccess(getDb(), uploadWorkspaceId, authReq.user)).data : undefined;
      // AUP-30: a date that cannot be read is an error for that row, never today's date
      const normalizeDate = (rawDate: string): string => {
        const s = (rawDate || '').trim();
        if (!s) throw new Error('The date is empty');
        let ymd: string | null = null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) ymd = s;
        const usMatch = s.match(/^(\d{1,2})[/|-](\d{1,2})[/|-](\d{2,4})$/);
        if (!ymd && usMatch) {
          const [, m, d, yRaw] = usMatch;
          const y = yRaw.length === 2 ? (Number.parseInt(yRaw, 10) > 50 ? '19' : '20') + yRaw : yRaw;
          ymd = `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        if (!ymd) {
          const parsed = new Date(s);
          if (Number.isNaN(parsed.getTime())) throw new Error(`The date "${s.slice(0, 40)}" could not be read`);
          ymd = formatTzDate(parsed, wsData?.settings?.timezone || wsData?.timezone);
        }
        if (!civilDateParts(ymd)) throw new Error(`The date "${s.slice(0, 40)}" is not a real calendar date`);
        return ymd;
      };
      // a filled-in debit or credit cell that is not a number is an error, not zero
      const cellCents = (value: string | undefined): number => (value === undefined || value.trim() === '' ? 0 : TruthEngine.parseAmountToCents(value));

      const batchId = crypto.randomUUID().split('-')[0];
      const transactions: Array<{ id: string; date: string; description: string; amountCents: number; category?: string }> = [];
      const rejected: Array<{ row: number; reason: string; raw: Record<string, string> }> = [];

      records.forEach((r, idx) => {
        try {
          let amountCents = 0;
          if (debitKey && creditKey && (r[debitKey] !== undefined || r[creditKey] !== undefined)) {
            const deb = cellCents(r[debitKey]);
            const cred = cellCents(r[creditKey]);
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

      fs.unlinkSync(filePath);
      // AUP-30: nothing is imported from a file with rows that could not be read; the answer names each one
      if (rejected.length > 0) {
        const listed = rejected.slice(0, 20).map(r => `row ${r.row}: ${r.reason}`).join('; ');
        const message = `${rejected.length} ${rejected.length === 1 ? 'row' : 'rows'} could not be read, so nothing was imported. Fix ${rejected.length === 1 ? 'it' : 'them'} in the file and upload it again (${listed}${rejected.length > 20 ? '; …' : ''}).`;
        return res.status(422).json({ status: 'error', message, rejected: rejected.map(({ row, reason }) => ({ row, reason })) });
      }
      res.json(transactions);
    } catch (error) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (/not a member|API key is scoped/i.test(errorMessage(error))) return sendError(res, "Forbidden workspace access", 403);
      sendError(res, "Failed to parse CSV", 500, error);
    }
  });
}
