const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');
if (!server.includes('app.post("/api/health"')) {
  server = server.replace(
    'app.get("/api/health", async (req, res) => {',
    'app.post("/api/health", (req, res) => { console.log("FRONTEND ERROR:", req.body); require("fs").writeFileSync("frontend_error.log", JSON.stringify(req.body, null, 2)); res.json({ok:true}); });\n  app.get("/api/health", async (req, res) => {'
  );
  fs.writeFileSync('server.ts', server);
}
