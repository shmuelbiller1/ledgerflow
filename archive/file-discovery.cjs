// Historical fixers are destructive; run them only on a disposable trusted checkout.
// Enumerate regular files without a shell or following symlinks.
const fs = require('node:fs');
const path = require('node:path');

function regularFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  return files.sort();
}

module.exports = { regularFiles };
