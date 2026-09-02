import fs from 'fs';
import glob from 'glob';
import path from 'path';

const files = glob.sync('src/**/*.{ts,tsx}');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('parseLocalDate(') && !content.includes('parseLocalDate') || content.match(/parseLocalDate\(/)) {
    if (!content.includes('import ') || content.includes('function parseLocalDate(')) {
       // Ignore if it's the definition itself
       continue;
    }
    if (!content.includes('import {') || !content.includes('parseLocalDate')) {
      // It might be imported, check if it's in the imports
    }
    
    let hasImport = false;
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('import ') && line.includes('parseLocalDate')) {
        hasImport = true;
        break;
      }
    }
    
    if (!hasImport) {
      // Try to find an existing import from utils or add a new one
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
         lines[utilsImportIndex] = lines[utilsImportIndex].replace('import { ', 'import { parseLocalDate, ').replace('import {', 'import { parseLocalDate, ');
      } else {
         // Insert after last import
         let lastImport = 0;
         for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('import ')) lastImport = i;
         }
         lines.splice(lastImport + 1, 0, `import { parseLocalDate } from '${relativePath}';`);
      }
      fs.writeFileSync(file, lines.join('\n'));
      console.log('Fixed ' + file);
    }
  }
}
