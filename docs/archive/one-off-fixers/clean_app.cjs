const fs = require('fs');

let c = fs.readFileSync('src/App.tsx', 'utf8');
c = c.replace(/localStorage\.setItem\('isGuest', 'true'\);\n\s+/g, '');
c = c.replace(/localStorage\.setItem\('isGuest', 'false'\);\n\s+/g, '');

fs.writeFileSync('src/App.tsx', c);
