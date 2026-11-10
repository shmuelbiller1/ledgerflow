const fs = require('fs');

let c = fs.readFileSync('src/components/ledger/MagicEntry.tsx', 'utf8');

c = c.replace(
  "import { Check, Wand2, Receipt, Camera, X, Loader2 } from 'lucide-react';",
  "import { Check, Wand2, Receipt, Camera, X, Loader2, Edit2 } from 'lucide-react';"
);

c = c.replace(
  "const [receiptMode, setReceiptMode] = useState(false);",
  "const [receiptMode, setReceiptMode] = useState(false);\n  const [isEditing, setIsEditing] = useState(false);"
);

c = c.replace(
  "setReceiptMode(false);\n    if (onClose)",
  "setReceiptMode(false);\n    setIsEditing(false);\n    if (onClose)"
);

const targetBlock = `{parsed && (
        <div className="mt-8 bg-[var(--panel)] border border-[var(--line)] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">We understood:</h3>
          <div className="grid grid-cols-2 gap-y-4 gap-x-8">
            <div>
              <p className="text-xs text-[var(--faint)] mb-1">Amount</p>
              <p className={\`text-xl font-bold \${parsed.action === 'expense' ? 'text-[var(--neg)]' : 'text-[var(--pos)]'}\`}>
                \${Math.abs(parsed.amount / 100).toFixed(2)} {parsed.action === 'expense' ? 'Out' : 'In'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--faint)] mb-1">Method</p>
              <p className="text-lg font-medium text-[var(--text)]">{parsed.method}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--faint)] mb-1">Description / Category</p>
              <p className="text-lg font-medium text-[var(--text)] capitalize">{parsed.description || 'General'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--faint)] mb-1">Date</p>
              <p className="text-lg font-medium text-[var(--text)]">{parsed.dateStr}</p>
            </div>
          </div>
          
          <button 
            className="w-full mt-6 bg-[var(--brass)] text-black font-bold py-3 px-4 rounded-xl flex items-center justify-center transition-opacity hover:opacity-90 shadow-md"
            onClick={handleSave}
          >
            <Check className="w-4 h-4 mr-2" /> Looks Right - Save It
          </button>
        </div>
      )}`;

const replacementBlock = `{parsed && (
        <div className="mt-8 bg-[var(--panel)] border border-[var(--line)] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">We understood:</h3>
            {!isEditing && (
              <button onClick={() => setIsEditing(true)} className="text-xs font-medium text-[var(--brass)] hover:underline flex items-center">
                <Edit2 className="w-3 h-3 mr-1" /> Edit Details
              </button>
            )}
          </div>
          {isEditing ? (
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Amount ($)</p>
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={(parsed.amount / 100).toFixed(2)}
                  onChange={(e) => setParsed({...parsed, amount: Math.round(parseFloat(e.target.value || '0') * 100)})}
                />
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Action</p>
                <select 
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.action}
                  onChange={(e) => setParsed({...parsed, action: e.target.value})}
                >
                  <option value="expense">Expense (Out)</option>
                  <option value="revenue">Revenue (In)</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Method</p>
                <input 
                  type="text" 
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.method}
                  onChange={(e) => setParsed({...parsed, method: e.target.value})}
                />
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Date</p>
                <input 
                  type="date" 
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.dateStr}
                  onChange={(e) => setParsed({...parsed, dateStr: e.target.value})}
                />
              </div>
              <div className="col-span-2">
                <p className="text-xs text-[var(--faint)] mb-1">Description / Category</p>
                <input 
                  type="text" 
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded p-2 text-sm focus:outline-none focus:border-[var(--brass)] text-[var(--text)]"
                  value={parsed.description}
                  onChange={(e) => setParsed({...parsed, description: e.target.value})}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Amount</p>
                <p className={\`text-xl font-bold \${parsed.action === 'expense' ? 'text-[var(--neg)]' : 'text-[var(--pos)]'}\`}>
                  \${Math.abs(parsed.amount / 100).toFixed(2)} {parsed.action === 'expense' ? 'Out' : 'In'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Method</p>
                <p className="text-lg font-medium text-[var(--text)]">{parsed.method}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Description / Category</p>
                <p className="text-lg font-medium text-[var(--text)] capitalize">{parsed.description || 'General'}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--faint)] mb-1">Date</p>
                <p className="text-lg font-medium text-[var(--text)]">{parsed.dateStr}</p>
              </div>
            </div>
          )}
          
          <div className="mt-6 flex gap-3">
            {isEditing && (
              <button 
                className="w-1/3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] font-medium py-3 px-4 rounded-xl transition-colors hover:bg-[var(--elevated)] shadow-sm"
                onClick={() => setIsEditing(false)}
              >
                Done Editing
              </button>
            )}
            <button 
              className={\`\${isEditing ? 'w-2/3' : 'w-full'} bg-[var(--brass)] text-black font-bold py-3 px-4 rounded-xl flex items-center justify-center transition-opacity hover:opacity-90 shadow-md\`}
              onClick={handleSave}
            >
              <Check className="w-4 h-4 mr-2" /> Looks Right - Save It
            </button>
          </div>
        </div>
      )}`;

c = c.replace(targetBlock, replacementBlock);

fs.writeFileSync('src/components/ledger/MagicEntry.tsx', c);
