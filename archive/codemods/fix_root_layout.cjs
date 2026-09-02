const fs = require('fs');

let c = fs.readFileSync('src/core/layout/RootLayout.tsx', 'utf8');

c = c.replace(
  `  const { handleLogout, handleApplyAITemplate, handleSelectTemplate, handleSaveCurrentTemplate, handleCreateWorkspace } = useSystemActions();
  const handleLoginPrompt = () => handleAction('open-login');`,
  `  const { handleLoginPrompt, handleLogout, handleApplyAITemplate, handleSelectTemplate, handleSaveCurrentTemplate, handleCreateWorkspace } = useSystemActions();`
);

fs.writeFileSync('src/core/layout/RootLayout.tsx', c);
