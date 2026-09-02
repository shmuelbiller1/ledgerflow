const fs = require('fs');
let content = fs.readFileSync('src/components/inventory/Inventory.tsx', 'utf8');

// replace <button ... onClick={() => handleDelete(item.id)} ... > with <ConfirmButton onConfirm={() => handleDelete(item.id)} ... >
content = content.replace(/<button\s+onClick=\{\(\) => handleDelete\(item.id\)\}([^>]+)>/g, '<ConfirmButton onConfirm={async () => handleDelete(item.id)} confirmMessage="Are you sure you want to delete this item?" $1>');
content = content.replace(/<\/button>\s*<\/td>/g, (match, offset) => {
  // this is dangerous if not targeted, let's just use string replace for that specific line
  return match;
});

// Actually, let's just do it manually with sed or node for exact match.
