const fs = require('fs');
let c = fs.readFileSync('src/components/ledger/MagicEntry.tsx', 'utf8');

c = c.replace(
  `<div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">We understood:</h3>
            {!isEditing && (
              <button onClick={() => setIsEditing(true)} className="text-xs font-medium text-[var(--brass)] hover:underline flex items-center">
                <Edit2 className="w-3 h-3 mr-1" /> Edit Details
              </button>
            )}
          </div>`,
  `<div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">We understood:</h3>
          </div>`
);

c = c.replace(
  `<div className="mt-6 flex gap-3">
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
          </div>`,
  `<div className="mt-6 flex flex-col sm:flex-row gap-3">
            {!isEditing ? (
              <button 
                className="w-full sm:w-1/3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] font-medium py-3 px-4 rounded-xl transition-colors hover:bg-[var(--elevated)] shadow-sm flex items-center justify-center"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="w-4 h-4 mr-2" /> Edit Details
              </button>
            ) : (
              <button 
                className="w-full sm:w-1/3 bg-[var(--surface)] border border-[var(--line)] text-[var(--text)] font-medium py-3 px-4 rounded-xl transition-colors hover:bg-[var(--elevated)] shadow-sm flex items-center justify-center"
                onClick={() => setIsEditing(false)}
              >
                Done Editing
              </button>
            )}
            <button 
              className="w-full sm:flex-1 bg-[var(--brass)] text-black font-bold py-3 px-4 rounded-xl flex items-center justify-center transition-opacity hover:opacity-90 shadow-md"
              onClick={handleSave}
            >
              <Check className="w-4 h-4 mr-2" /> Looks Right - Save It
            </button>
          </div>`
);

fs.writeFileSync('src/components/ledger/MagicEntry.tsx', c);
