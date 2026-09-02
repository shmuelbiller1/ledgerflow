const fs = require('fs');

let c = fs.readFileSync('src/App.tsx', 'utf8');
c = c.replace(
  `  const handleLoginPrompt = () => {
    localStorage.setItem('isGuest', 'false');
    setIsGuest(false);
  };`,
  ``
);

fs.writeFileSync('src/App.tsx', c);
