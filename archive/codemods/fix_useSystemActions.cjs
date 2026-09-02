const fs = require('fs');

let c = fs.readFileSync('src/hooks/useSystemActions.ts', 'utf8');

c = c.replace(
  `  const handleLoginPrompt = useCallback(() => {
    console.log("handleLoginPrompt CALLED!");
    useAuthStore.getState().setIsGuest(false);
    if (typeof window !== "undefined") window.location.reload();
  }, []);`,
  `  const handleLoginPrompt = useCallback(() => {
    useAuthStore.getState().setIsGuest(false);
  }, []);`
);

c = c.replace(
  `  const handleLogout = useCallback(() => {
    console.log("handleLogout CALLED!");
    useAuthStore.getState().setIsGuest(false);
    localStorage.removeItem('ledgerflow_use_sandbox_mode');
    localStorage.removeItem('ledgerflow_identity_email');
    localStorage.removeItem('ledgerflow_identity_name');
    
    useAuthStore.getState().setUser(null);
    if (typeof useLedgerStore.getState().resetStore === 'function') {
      useLedgerStore.getState().resetStore();
    } else {
      useLedgerStore.setState({ 
        transactions: [], 
        accounts: [], 
        journalEntries: []
      });
    }
    
    signOut(auth).catch(() => {});
    toast.success('Returned to login screen');
    if (typeof window !== "undefined") window.location.reload();
  }, []);`,
  `  const handleLogout = useCallback(() => {
    useAuthStore.getState().setIsGuest(false);
    localStorage.removeItem('ledgerflow_use_sandbox_mode');
    localStorage.removeItem('ledgerflow_identity_email');
    localStorage.removeItem('ledgerflow_identity_name');
    
    useAuthStore.getState().setUser(null);
    if (typeof useLedgerStore.getState().resetStore === 'function') {
      useLedgerStore.getState().resetStore();
    } else {
      useLedgerStore.setState({ 
        transactions: [], 
        accounts: [], 
        journalEntries: []
      });
    }
    
    signOut(auth).catch(() => {});
    toast.success('Returned to login screen');
  }, []);`
);

fs.writeFileSync('src/hooks/useSystemActions.ts', c);
