const fs = require('fs');
const file = 'src/components/sales/Sales.tsx';
let content = fs.readFileSync(file, 'utf8');

// I accidentally removed the Zap import somehow
if (!content.includes('Zap,')) {
  content = content.replace("Trash2,", "Trash2, Zap,");
}

// But wait, the error is: src/components/sales/Sales.tsx(263,30): error TS2304: Cannot find name 'Zap'.
// Oh! I added `Zap` to `Trash2, Calendar, Zap,` but `Trash2` was already imported. Let me just add Zap explicitly at the end of lucide-react imports.

content = content.replace(/import \{([\s\S]*?)\} from 'lucide-react';/, (match, group) => {
  if (!group.includes('Zap')) {
    return `import {${group}, Zap} from 'lucide-react';`;
  }
  return match;
});

fs.writeFileSync(file, content);
