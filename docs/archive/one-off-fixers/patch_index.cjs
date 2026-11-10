const fs = require('fs');
let index = fs.readFileSync('index.html', 'utf8');
if (!index.includes('window.addEventListener("error"')) {
  index = index.replace(
    '<script type="module" src="/src/main.tsx"></script>',
    `<script>
      window.addEventListener("error", (e) => {
        fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message, stack: e.error ? e.error.stack : null, type: "error" }) }).catch(()=>{});
      });
      window.addEventListener("unhandledrejection", (e) => {
        fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: e.reason ? e.reason.message : "Promise Rejection", stack: e.reason ? e.reason.stack : null, type: "unhandledrejection" }) }).catch(()=>{});
      });
    </script>
    <script type="module" src="/src/main.tsx"></script>`
  );
  fs.writeFileSync('index.html', index);
}
