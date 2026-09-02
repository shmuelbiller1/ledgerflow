const fs = require('fs');
const files = [
  'src/components/forensics/tabs/BookClosureTab.tsx',
  'src/components/ledger/CashFlowView.tsx',
  'src/components/ledger/ProfitAndLossView.tsx',
  'src/hooks/useFinancialReporting.ts',
  'src/lib/algorithms.ts',
  'src/lib/algorithms/working-capital-aging.ts',
  'src/modules/integrity/TruthEngine.ts'
];

for (const file of files) {
  let c = fs.readFileSync(file, 'utf8');
  if (!c.includes('parseLocalDate')) continue;
  
  // Find standard utils import
  const r1 = /import\s+\{[^}]*\}\s+from\s+['"](?:\.\.\/)+lib\/utils['"];/;
  const m = c.match(r1);
  if (m) {
    if (!m[0].includes('parseLocalDate')) {
      const newImport = m[0].replace('{', '{ parseLocalDate,');
      c = c.replace(m[0], newImport);
    }
  } else {
    // try to determine depth based on file
    let depth = '';
    if (file.split('/').length === 5) depth = '../../../';
    else if (file.split('/').length === 4) depth = '../../';
    else depth = '../';
    
    // TruthEngine depth: src/modules/integrity/TruthEngine.ts (4 parts, so ../../)
    // working-capital-aging (4 parts, ../../)
    // algorithms.ts (2 parts -> src/lib -> ../) wait src/lib/algorithms.ts (3 parts so ../)
    
    let path = '../../lib/utils';
    if (file === 'src/lib/algorithms.ts') path = './utils';
    
    c = `import { parseLocalDate } from '${path}';\n` + c;
  }
  fs.writeFileSync(file, c);
}
