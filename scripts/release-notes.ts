/**
 * F-36 — write the week's release notes from the commit history.
 *
 *   npm run release:notes                 # last 7 days, printed
 *   npm run release:notes -- --weeks 4    # last 4 weeks, printed
 *   npm run release:notes -- --write      # one file per week under docs/releases/
 *   npm run release:notes -- --since 2026-10-01
 *
 * Only commits whose subject says a person sees a change are included (`feat`, `fix`,
 * `perf`, `a11y`, `[user-facing]`); chores, docs, tests, refactors and CI are left out.
 * Nothing is invented: the line is the commit's own subject.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { groupByWeek, releaseNotesMarkdown, type ReleaseCommit } from '../src/lib/releaseNotes';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const since = value('--since') || `${Number(value('--weeks') || 1) * 7} days ago`;
const write = flag('--write');

const output = execFileSync('git', ['log', `--since=${since}`, '--date=short', '--pretty=format:%h%x1f%cd%x1f%s'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

const commits: ReleaseCommit[] = output
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => {
    const [hash, date, subject] = line.split('\x1f');
    return { hash, date, subject: subject || '' };
  });

const weeks = groupByWeek(commits);

if (write) {
  fs.mkdirSync('docs/releases', { recursive: true });
  for (const week of weeks) {
    const file = path.join('docs/releases', `${week.start}.md`);
    fs.writeFileSync(file, releaseNotesMarkdown(week));
    console.log(`wrote ${file} (${week.entries.length} entries)`);
  }
  if (weeks.length === 0) console.log('No user-facing commits in this period; nothing written.');
} else {
  if (weeks.length === 0) {
    console.log('No user-facing commits in this period.');
  } else {
    console.log(weeks.map(releaseNotesMarkdown).join('\n'));
  }
}
