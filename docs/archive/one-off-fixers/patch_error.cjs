const fs = require('fs');
let content = fs.readFileSync('src/components/ErrorBoundary.tsx', 'utf8');
content = content.replace(
  'console.debug("CRASH_DUMP:", error.stack || error.message);',
  'console.debug("CRASH_DUMP:", error.stack || error.message);\n    fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: error.message, stack: error.stack, info: errorInfo }) }).catch(() => {});'
);
fs.writeFileSync('src/components/ErrorBoundary.tsx', content);

let server = fs.readFileSync('server.ts', 'utf8');
if (!server.includes('app.post("/api/health"')) {
  server = server.replace(
    'app.get("/api/health", (req, res) => {',
    'app.post("/api/health", (req, res) => { console.log("FRONTEND ERROR:", req.body); res.json({ok:true}); });\n  app.get("/api/health", (req, res) => {'
  );
  fs.writeFileSync('server.ts', server);
}
