/**
 * F-36 — release notes from commit messages, once a week.
 *
 * The owner reads what changed for a user, not a commit log. So a commit counts only when
 * its subject says it changes something a person can see (`feat`, `fix`, `perf`, `a11y`) or
 * carries an explicit `user-facing:` marker; `chore`, `docs`, `test`, `refactor`, `ci`,
 * `build`, `style` and `revert` do not appear unless marked. Nothing is invented: the line
 * is the commit's own subject with the prefix removed, and the hash is kept for tracing.
 *
 * Dates are calendar days (`YYYY-MM-DD`), and a week starts on the day the caller names
 * (Monday by default), so the same commits give the same notes in every time zone.
 */

export interface ReleaseCommit {
  hash: string;
  /** YYYY-MM-DD (the committer's day, taken from `git log --date=short`) */
  date: string;
  subject: string;
}

export interface ReleaseWeek {
  /** YYYY-MM-DD of the week's first day */
  start: string;
  /** YYYY-MM-DD of the week's last day */
  end: string;
  entries: Array<{ hash: string; area: string; text: string }>;
}

const USER_FACING = new Set(['feat', 'fix', 'perf', 'a11y']);
const HIDDEN = new Set(['chore', 'docs', 'test', 'tests', 'refactor', 'ci', 'build', 'style', 'revert']);
const MARKER = /\[user-facing\]|user-facing:/i;

/** `feat(sales): ...` → `{ type: 'feat', area: 'sales', text: '...' }` */
export function parseSubject(subject: string): { type: string; area: string; text: string } {
  // the explicit marker is for readers of the log, not for the note
  const cleaned = subject.replace(/\[user-facing\]\s*/i, '').replace(/user-facing:\s*/i, '').trim();
  const match = cleaned.match(/^\s*([a-zA-Z][a-zA-Z0-9]*)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (!match) return { type: '', area: 'general', text: cleaned };
  return { type: match[1].toLowerCase(), area: (match[2] || 'general').trim(), text: match[3].trim() };
}

/** Whether a commit belongs in the notes a customer reads. */
export function isUserFacing(subject: string): boolean {
  if (MARKER.test(subject)) return true;
  const { type } = parseSubject(subject);
  if (USER_FACING.has(type)) return true;
  if (HIDDEN.has(type)) return false;
  // A subject with no conventional prefix and no hidden word is offered, because a
  // person wrote it in words a person will read.
  return type === '';
}

/**
 * Day count from the civil date (Hinnant's algorithm): no Date, no time zone, no clock.
 * 1970-01-01 is day 0, which was a Thursday.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The civil date of a day count, back to `YYYY-MM-DD`. */
function civilFromDays(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The calendar day counted back `days` days (integer arithmetic, no time zone). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return civilFromDays(daysFromCivil(y, m, d) + days);
}

/** Day of week, 0 = Sunday … 6 = Saturday, from a civil date. */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return ((daysFromCivil(y, m, d) + 4) % 7 + 7) % 7;
}

/** The first day of the week holding `iso`, for a week that starts on `weekStartsOn` (1 = Monday). */
export function weekStart(iso: string, weekStartsOn = 1): string {
  const delta = (weekday(iso) - weekStartsOn + 7) % 7;
  return addDays(iso, -delta);
}

/** Group the commits by week, newest week first, keeping only what a user can see. */
export function groupByWeek(commits: ReleaseCommit[], weekStartsOn = 1): ReleaseWeek[] {
  const weeks = new Map<string, ReleaseWeek>();
  for (const commit of commits) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(commit.date)) continue;
    if (!isUserFacing(commit.subject)) continue;
    const start = weekStart(commit.date, weekStartsOn);
    if (!weeks.has(start)) weeks.set(start, { start, end: addDays(start, 6), entries: [] });
    const { area, text } = parseSubject(commit.subject);
    weeks.get(start)!.entries.push({ hash: commit.hash.slice(0, 7), area, text });
  }
  return [...weeks.values()]
    .sort((a, b) => b.start.localeCompare(a.start))
    .map(week => ({
      ...week,
      entries: [...week.entries].sort((a, b) => a.area.localeCompare(b.area) || a.text.localeCompare(b.text)),
    }));
}

/** One week as the markdown the owner reads. An empty week says so instead of pretending. */
export function releaseNotesMarkdown(week: ReleaseWeek): string {
  const title = `# What changed — week of ${week.start}`;
  const range = `${week.start} to ${week.end}`;
  if (week.entries.length === 0) return `${title}\n\n${range}\n\nNo user-facing changes this week.\n`;
  const lines = week.entries.map(entry => `- **${entry.area}** — ${entry.text} (${entry.hash})`);
  return `${title}\n\n${range}\n\n${lines.join('\n')}\n`;
}

/** A whole period, one section per week. */
export function releaseNotesDocument(commits: ReleaseCommit[], weekStartsOn = 1): string {
  const weeks = groupByWeek(commits, weekStartsOn);
  if (weeks.length === 0) return '# What changed\n\nNo user-facing commits in this period.\n';
  return weeks.map(releaseNotesMarkdown).join('\n');
}
