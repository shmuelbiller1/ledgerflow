import express from 'express';
import { reportSchedulePreviewCommand, reportScheduleSendCommand } from '../commands/workspaceHousekeeping';
import { executeCommand } from '../utils/commandExecutor';
import { legacyAnswer, workspaceInvocation } from '../utils/legacyCommandRoute';

/**
 * Scheduled reports (K-28, R-3), mounted at /api/v1/workspaces/:workspaceId/report-schedules for owners
 * and accountants (workspaceRoutes checks the role): preview what a schedule would send
 * (`reportschedule.preview`, which needs no schema and refuses nothing) and send one now
 * (`reportschedule.send`). Both keep the answers their handlers gave.
 */
export const reportScheduleRouter = express.Router({ mergeParams: true });

// R-3: the email a schedule would send, shown before it is saved (nothing is sent)
reportScheduleRouter.post('/preview', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  await executeCommand(req, res, {
    ...workspaceInvocation(req, reportSchedulePreviewCommand),
    formatResponse: legacyAnswer({ badBody: 'Check the report and how often it is sent', failed: 'The preview could not be made' }),
  });
});

reportScheduleRouter.post('/:scheduleId/send-now', async (req, res) => {
  const params = req.params as Record<string, string>;
  await executeCommand(req, res, {
    ...workspaceInvocation(req, reportScheduleSendCommand, { scheduleId: params.scheduleId }),
    formatResponse: legacyAnswer({ badBody: 'Check the schedule', failed: 'The report could not be sent' }),
  });
});
