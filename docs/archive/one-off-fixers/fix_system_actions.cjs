const fs = require('fs');

let c = fs.readFileSync('src/hooks/useSystemActions.ts', 'utf8');

c = c.replace(
  `  const handleLogout = useCallback(() => {
    localStorage.setItem('isGuest', 'false');`,
  `  const handleLogout = useCallback(() => {
    useAuthStore.getState().setIsGuest(false);`
);

fs.writeFileSync('src/hooks/useSystemActions.ts', c);
