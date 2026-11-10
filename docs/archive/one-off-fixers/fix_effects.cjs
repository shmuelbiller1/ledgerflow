const fs = require('fs');

function replaceFile(path, search, repl) {
  let c = fs.readFileSync(path, 'utf8');
  c = c.replace(search, repl);
  fs.writeFileSync(path, c);
}

replaceFile('src/components/platform/SystemCommandCenter.tsx',
  `fetchGlobalConfig();`,
  `setTimeout(() => fetchGlobalConfig(), 0);`
);

replaceFile('src/components/platform/settings/AISettings.tsx',
  `setThreshold(currentWorkspace.matchingThreshold);`,
  `setTimeout(() => setThreshold(currentWorkspace.matchingThreshold), 0);`
);

replaceFile('src/components/sales/PublicInvoicePage.tsx',
  `setLoading(false);`,
  `setTimeout(() => setLoading(false), 0);`
);

