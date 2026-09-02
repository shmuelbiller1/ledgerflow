const fs = require('fs');

let algCode = fs.readFileSync('src/lib/algorithms.ts', 'utf8');
algCode = algCode.replace(/const start = parseLocalDate\(end\);/g, "const start = new Date(end.getTime());");
algCode = algCode.replace(/const d = parseLocalDate\(start\);/g, "const d = new Date(start.getTime());");
fs.writeFileSync('src/lib/algorithms.ts', algCode);
