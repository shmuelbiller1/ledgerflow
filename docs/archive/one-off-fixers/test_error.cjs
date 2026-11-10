const fs = require('fs');
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace('return (', 'throw new Error("TEST ERROR"); return (');
fs.writeFileSync('src/App.tsx', app);
