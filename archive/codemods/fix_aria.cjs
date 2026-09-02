const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('find src -type f -name "*.tsx"').toString().split('\n').filter(Boolean);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // regex to find button with an icon inside but no aria-label
  // A naive replacement for common cases:
  const trashRegex = /<button([^>]+)><Trash2([^>]*)><\/button>/g;
  const editRegex = /<button([^>]+)><Edit2([^>]*)><\/button>/g;
  const plusRegex = /<button([^>]+)><Plus([^>]*)><\/button>/g;
  const xRegex = /<button([^>]+)><X ([^>]*)><\/button>/g;
  
  if (trashRegex.test(content) || editRegex.test(content) || plusRegex.test(content) || xRegex.test(content)) {
    content = content.replace(/<button([^>]+)><Trash2([^>]*)><\/button>/g, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Delete"${attrs}><Trash2${iconAttrs}></button>`;
    });
    content = content.replace(/<button([^>]+)><Edit2([^>]*)><\/button>/g, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Edit"${attrs}><Edit2${iconAttrs}></button>`;
    });
    content = content.replace(/<button([^>]+)><Plus([^>]*)><\/button>/g, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Add"${attrs}><Plus${iconAttrs}></button>`;
    });
    content = content.replace(/<button([^>]+)><X ([^>]*)><\/button>/g, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Close"${attrs}><X ${iconAttrs}></button>`;
    });
    
    // Also handle self-closing icons, e.g., <Trash2 size={16} />
    const trashRegex2 = /<button([^>]+)>\s*<Trash2([^>]*)\/>\s*<\/button>/g;
    content = content.replace(trashRegex2, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Delete"${attrs}>\n<Trash2${iconAttrs}/>\n</button>`;
    });
    const editRegex2 = /<button([^>]+)>\s*<Edit2([^>]*)\/>\s*<\/button>/g;
    content = content.replace(editRegex2, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Edit"${attrs}>\n<Edit2${iconAttrs}/>\n</button>`;
    });
    const plusRegex2 = /<button([^>]+)>\s*<Plus([^>]*)\/>\s*<\/button>/g;
    content = content.replace(plusRegex2, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Add"${attrs}>\n<Plus${iconAttrs}/>\n</button>`;
    });
    const xRegex2 = /<button([^>]+)>\s*<X([^>]*)\/>\s*<\/button>/g;
    content = content.replace(xRegex2, (match, attrs, iconAttrs) => {
      if (attrs.includes('aria-label')) return match;
      return `<button aria-label="Close"${attrs}>\n<X${iconAttrs}/>\n</button>`;
    });
    
    fs.writeFileSync(file, content);
    console.log('Fixed aria labels in', file);
  }
}
