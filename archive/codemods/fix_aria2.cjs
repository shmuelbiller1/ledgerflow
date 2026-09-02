const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('find src -type f -name "*.tsx"').toString().split('\n').filter(Boolean);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  content = content.replace(/<button([^>]*?)>\s*<Trash2([^>]*?)\/>\s*<\/button>/g, (match, attrs, iconAttrs) => {
    if (attrs.includes('aria-label')) return match;
    return `<button aria-label="Delete"${attrs}><Trash2${iconAttrs}/></button>`;
  });
  
  content = content.replace(/<button([^>]*?)>\s*<Edit2([^>]*?)\/>\s*<\/button>/g, (match, attrs, iconAttrs) => {
    if (attrs.includes('aria-label')) return match;
    return `<button aria-label="Edit"${attrs}><Edit2${iconAttrs}/></button>`;
  });

  content = content.replace(/<button([^>]*?)>\s*<Plus([^>]*?)\/>\s*<\/button>/g, (match, attrs, iconAttrs) => {
    if (attrs.includes('aria-label')) return match;
    return `<button aria-label="Add"${attrs}><Plus${iconAttrs}/></button>`;
  });

  content = content.replace(/<button([^>]*?)>\s*<X([^>]*?)\/>\s*<\/button>/g, (match, attrs, iconAttrs) => {
    if (attrs.includes('aria-label')) return match;
    return `<button aria-label="Close"${attrs}><X${iconAttrs}/></button>`;
  });

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed aria labels in', file);
  }
}
