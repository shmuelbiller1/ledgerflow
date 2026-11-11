/**
 * R-4: a short note for one report and one period ("rent paid late this month"), kept on the workspace
 * (`reportNotes`), shown above the report on screen and in its print / PDF. The database checks the same limits
 * (migration 20261110010000_report_notes).
 */
export const REPORT_NOTE_MAX = 500;
export const REPORT_NOTES_MAX = 500;

/** The note's key: the report and its period. */
export function reportNoteKey(report: string, startDate: string, endDate: string): string {
  return `${report}|${startDate}|${endDate}`;
}

/** The notes after setting (or, with blank text, removing) one; or the reason it cannot be saved. */
export function withReportNote(notes: Record<string, string> | undefined, key: string, text: string): { notes: Record<string, string> } | { problem: string } {
  const value = text.trim();
  if (value.length > REPORT_NOTE_MAX) return { problem: `A note is at most ${REPORT_NOTE_MAX} characters` };
  const next = { ...(notes || {}) };
  if (value) next[key] = value; else delete next[key];
  if (Object.keys(next).length > REPORT_NOTES_MAX) return { problem: `At most ${REPORT_NOTES_MAX} report notes; clear an old one first` };
  return { notes: next };
}
