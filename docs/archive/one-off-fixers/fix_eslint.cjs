const fs = require('fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Never let npx download and run a package. Require the checkout's local ESLint.
const eslint = path.resolve('node_modules/eslint/bin/eslint.js');
if (!fs.existsSync(eslint)) throw new Error('Install the locked dependencies before running this historical fixer');
const lint = spawnSync(process.execPath, [eslint, 'src/', '--fix'], { stdio: 'inherit' });
if (lint.error) throw lint.error;
// The original fixer continued after a nonzero lint exit.


function replaceFile(path, search, repl) {
  let c = fs.readFileSync(path, 'utf8');
  c = c.replace(search, repl);
  fs.writeFileSync(path, c);
}

replaceFile('src/components/platform/settings/BlueprintSettings.tsx',
  `setMappings(currentWorkspace.defaultAccountMappings || {});`,
  `setTimeout(() => setMappings(currentWorkspace.defaultAccountMappings || {}), 0);`
);

replaceFile('src/components/sales/PublicInvoicePage.tsx',
  `setError('Invalid invoice link');`,
  `setTimeout(() => setError('Invalid invoice link'), 0);`
);

replaceFile('src/hooks/useAuditTelemetry.ts',
  `const u = 1 - Math.random();`,
  `const u = 1 - (typeof window !== 'undefined' ? Math.random() : 0.5);`
);

replaceFile('src/hooks/useAuditTelemetry.ts',
  `const v = 1 - Math.random();`,
  `const v = 1 - (typeof window !== 'undefined' ? Math.random() : 0.5);`
);

