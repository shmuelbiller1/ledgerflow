const fs = require('fs');
let content = fs.readFileSync('src/components/layout/MainViewSwitcher.tsx', 'utf8');
content = content.replace(
  'static getDerivedStateFromError(error: Error) {',
  'componentDidCatch(error: Error, info: any) { fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: error.message, stack: error.stack, type: "module-error" }) }).catch(()=>{}); }\n  static getDerivedStateFromError(error: Error) {'
);
fs.writeFileSync('src/components/layout/MainViewSwitcher.tsx', content);
