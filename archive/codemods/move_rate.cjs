const fs = require('fs');
let c = fs.readFileSync('src/services/LedgerPostService.ts', 'utf8');

c = c.replace(/const rawAmount = invoiceData.totalCents \|\| invoiceData.amountCents \|\| 0;\n    const amount = roundCents\(rawAmount \* rate\);\n    if \(amount <= 0\) \{ if \(entityMutation\) \{ await this.postTxsServerApi\(\[\], workspaceId, entityMutation\); \} return; \}\n    const rate = invoiceData.exchangeRate \|\| 1;/g,
  "const rawAmount = invoiceData.totalCents || invoiceData.amountCents || 0;\n    const rate = invoiceData.exchangeRate || 1;\n    const amount = roundCents(rawAmount * rate);\n    if (amount <= 0) { if (entityMutation) { await this.postTxsServerApi([], workspaceId, entityMutation); } return; }");

c = c.replace(/const rawAmount = billData.amountCents \|\| billData.totalCents \|\| 0;\n    const amount = roundCents\(rawAmount \* rate\);\n    if \(amount <= 0\) \{ if \(entityMutation\) \{ await this.postTxsServerApi\(\[\], workspaceId, entityMutation\); \} return; \}\n    const rate = billData.exchangeRate \|\| 1;/g,
  "const rawAmount = billData.amountCents || billData.totalCents || 0;\n    const rate = billData.exchangeRate || 1;\n    const amount = roundCents(rawAmount * rate);\n    if (amount <= 0) { if (entityMutation) { await this.postTxsServerApi([], workspaceId, entityMutation); } return; }");

fs.writeFileSync('src/services/LedgerPostService.ts', c);
