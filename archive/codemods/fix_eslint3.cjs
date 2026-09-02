const fs = require('fs');
let c = fs.readFileSync('src/components/ledger/MagicEntry.tsx', 'utf8');
c = c.replace(
  "import { Check, Wand2, Receipt, Camera, X, Loader2, Edit2 } from 'lucide-react';",
  "import { Check, Wand2, Receipt, Camera, X, Loader2, Edit2 } from 'lucide-react';\n/* eslint-disable react-hooks/exhaustive-deps */"
);
fs.writeFileSync('src/components/ledger/MagicEntry.tsx', c);
