import fs from 'node:fs';

const lines = fs.readFileSync('test-shard.log', 'utf8').replaceAll('\r', '').split('\n');
const failurePattern = /(?:^|\s)✖\s|^\s*not ok\s+\d+/u;
const failureIndexes = lines.flatMap((line, index) => failurePattern.test(line) ? [index] : []);
const escapeCommandData = (value) => value
  .replaceAll('%', '%25')
  .replaceAll('\r', '%0D')
  .replaceAll('\n', '%0A')
  .replaceAll(':', '%3A');

if (failureIndexes.length === 0) {
  const tail = lines.slice(-40).join('\n').trim() || 'The test runner exited nonzero without emitting a log.';
  console.log(`::error file=.github/workflows/ci.yml,line=1,title=Test shard failed::${escapeCommandData(tail.slice(-5000))}`);
} else {
  for (const [position, start] of failureIndexes.entries()) {
    if (position >= 10) break;
    const nextFailure = failureIndexes[position + 1] ?? lines.length;
    const end = Math.min(nextFailure, start + 24);
    const details = lines.slice(start, end).join('\n').trim();
    console.log(`::error file=.github/workflows/ci.yml,line=1,title=Failing test::${escapeCommandData(details.slice(0, 5000))}`);
  }
}
