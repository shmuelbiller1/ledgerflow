const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');
server = server.replace(
  'console.log("FRONTEND ERROR:", req.body);',
  'console.log("FRONTEND ERROR:", req.body); require("fs").writeFileSync("frontend_error.log", JSON.stringify(req.body, null, 2));'
);
fs.writeFileSync('server.ts', server);
