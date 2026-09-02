const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('find src -type f -name "*.tsx"').toString().split('\n').filter(Boolean);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Replace <div ... onClick=... > without role="button"
  content = content.replace(/<div([^>]*?onClick=[^>]*?)>/g, (match, attrs) => {
    if (attrs.includes('role="button"')) return match;
    // Add role and tabIndex
    return `<div role="button" tabIndex={0}${attrs}>`;
  });

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed divs in', file);
  }
}
