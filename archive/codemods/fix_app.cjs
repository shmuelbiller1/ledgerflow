const fs = require('fs');

let c = fs.readFileSync('src/App.tsx', 'utf8');

c = c.replace(
  `const [isGuest, setIsGuest] = useState(() => localStorage.getItem('isGuest') === 'true');`,
  `const isGuest = useAuthStore(state => state.isGuest);
  const setIsGuest = useAuthStore(state => state.setIsGuest);`
);

fs.writeFileSync('src/App.tsx', c);
