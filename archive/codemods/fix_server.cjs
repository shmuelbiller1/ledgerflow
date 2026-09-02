const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');
content = content.replace('require("fs").writeFileSync', 'fs.writeFileSync');
fs.writeFileSync('server.ts', content);
