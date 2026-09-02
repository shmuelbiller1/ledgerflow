const fs = require('fs');

let c = fs.readFileSync('src/hooks/useSystemActions.ts', 'utf8');

c = c.replace(
  `useLedgerStore.getState().resetStore?.() || useLedgerStore.setState({ 
      transactions: [], 
      accounts: [], 
      journalEntries: []
    });`,
  `if (typeof useLedgerStore.getState().resetStore === 'function') {
      useLedgerStore.getState().resetStore();
    } else {
      useLedgerStore.setState({ 
        transactions: [], 
        accounts: [], 
        journalEntries: []
      });
    }`
);

fs.writeFileSync('src/hooks/useSystemActions.ts', c);
