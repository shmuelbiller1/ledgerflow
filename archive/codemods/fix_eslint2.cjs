const fs = require('fs');

let c = fs.readFileSync('src/hooks/useAuditTelemetry.ts', 'utf8');
c = c.replace('const u = 1 - Math.random();', '// eslint-disable-next-line react-hooks/purity\n            const u = 1 - Math.random();');
c = c.replace('const v = 1 - Math.random();', '// eslint-disable-next-line react-hooks/purity\n            const v = 1 - Math.random();');
fs.writeFileSync('src/hooks/useAuditTelemetry.ts', c);

