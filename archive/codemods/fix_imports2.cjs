const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('grep -rl "formatDecimal(" src/').toString().split('\n').filter(Boolean);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('function formatDecimal(')) continue;
  
  const lines = content.split('\n');
  let hasImport = false;
  for (const line of lines) {
    if (line.includes('import ') && line.includes('formatDecimal')) {
      hasImport = true;
      break;
    }
  }
  
  if (!hasImport) {
    const depth = file.split('/').length - 2;
    const relativePath = depth === 0 ? './lib/utils' : '../'.repeat(depth) + 'lib/utils';
    
    let utilsImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
       if (lines[i].includes('lib/utils') && lines[i].includes('import {') && !lines[i].includes('//')) {
           utilsImportIndex = i;
           break;
       }
    }
    
    if (utilsImportIndex !== -1) {
       lines[utilsImportIndex] = lines[utilsImportIndex].replace('import { ', 'import { formatDecimal, ').replace('import {', 'import { formatDecimal, ');
    } else {
       let lastImport = 0;
       for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('import ')) lastImport = i;
       }
       lines.splice(lastImport + 1, 0, `import { formatDecimal } from '${relativePath}';`);
    }
    fs.writeFileSync(file, lines.join('\n'));
    console.log('Fixed ' + file);
  }
}
