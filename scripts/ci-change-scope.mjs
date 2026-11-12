import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Only static documentation can skip the expensive application test matrix. */
export function isDocsOnlyChangedPaths(files) {
  if (!Array.isArray(files)) throw new TypeError('expected an array of changed paths');
  return files.length > 0 && files.every(path => {
    if (typeof path !== 'string' || !path.trim()) return false;
    if (/\.md$/i.test(path)) return true;
    return /^docs\/.+\.(?:txt|rst|png|jpe?g|gif|svg|webp|pdf)$/i.test(path);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const paths = Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean);
  process.stdout.write('docs_only=' + isDocsOnlyChangedPaths(paths) + '\n');
}
