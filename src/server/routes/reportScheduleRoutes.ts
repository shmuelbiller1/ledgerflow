import express from 'express';
import { getDb } from '../db/firestore';
import { ScheduledReportError, previewSchedule, sendScheduleNow } from '../services/scheduledReportService';

/**
 * Scheduled reports (K-28, R-3), mounted at /api/v1/workspaces/:workspaceId/report-schedules for owners and
 * accountants (workspaceRoutes checks the role): preview what a schedule would send, and send one now.
 */
export const reportScheduleRouter = express.Router({ mergeParams: true });

// R-3: the email a schedule would send, shown before it is saved (nothing is sent)
reportScheduleRouter.post('/preview', async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const body = (req.body || {}) as { report?: unknown; frequency?: unknown };
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'success', ...(await previewSchedule(getDb(), { workspaceId, report: body.report, frequency: body.frequency })) });
  } catch (err) {
    if (err instanceof ScheduledReportError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(500).json({ status: 'error', message: 'The preview could not be made', details: err instanceof Error ? err.message : String(err) });
  }
});
reportScheduleRouter.post('/:scheduleId/send-now', async (req, res) => {
  try {
    const { workspaceId, scheduleId } = req.params as Record<string, string>;
    const result = await sendScheduleNow(getDb(), { workspaceId, scheduleId });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof ScheduledReportError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(500).json({ status: 'error', message: 'The report could not be sent', details: err instanceof Error ? err.message : String(err) });
  }
});
