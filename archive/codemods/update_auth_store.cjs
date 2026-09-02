const fs = require('fs');

let c = fs.readFileSync('src/stores/useAuthStore.ts', 'utf8');

c = c.replace(
  'user: FirebaseUser | null;',
  'user: FirebaseUser | null;\n  isGuest: boolean;'
);

c = c.replace(
  'setUser: (user: FirebaseUser | null) => void;',
  'setUser: (user: FirebaseUser | null) => void;\n  setIsGuest: (val: boolean) => void;'
);

c = c.replace(
  'user: null,',
  'user: null,\n  isGuest: typeof localStorage !== "undefined" ? localStorage.getItem("isGuest") === "true" : false,'
);

c = c.replace(
  'setUser: (user) => set({ user }),',
  'setUser: (user) => set({ user }),\n  setIsGuest: (isGuest) => {\n    if (typeof localStorage !== "undefined") {\n      localStorage.setItem("isGuest", isGuest ? "true" : "false");\n    }\n    set({ isGuest });\n  },'
);

fs.writeFileSync('src/stores/useAuthStore.ts', c);
