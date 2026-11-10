const fs = require('fs');

let c = fs.readFileSync('src/hooks/useSystemActions.ts', 'utf8');

c = c.replace(
  `  const handleLogout = useCallback(() => {`,
  `  const handleLoginPrompt = useCallback(() => {
    useAuthStore.getState().setIsGuest(false);
  }, []);

  const handleLogout = useCallback(() => {`
);

c = c.replace(
  `  return {
    handleLogout,`,
  `  return {
    handleLoginPrompt,
    handleLogout,`
);

fs.writeFileSync('src/hooks/useSystemActions.ts', c);
