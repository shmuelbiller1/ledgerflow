const fs = require('fs');
const { execSync } = require('child_process');

const files = execSync('find src -type f -name "*.tsx"').toString().split('\n').filter(Boolean);

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // regex to find all <form> blocks
  // Then inside those blocks, replace <button> with <button type="button"> unless it has type="submit"
  let startIndex = 0;
  while ((startIndex = content.indexOf('<form', startIndex)) !== -1) {
    let endIndex = content.indexOf('</form>', startIndex);
    if (endIndex === -1) break;
    
    let formBlock = content.substring(startIndex, endIndex);
    
    // Replace <button... > with <button type="button"... > 
    // Wait, regex might match <button type="submit" 
    formBlock = formBlock.replace(/<button([^>]*?)>/g, (match, attrs) => {
      if (attrs.includes('type=')) return match;
      return `<button type="button"${attrs}>`;
    });
    
    content = content.substring(0, startIndex) + formBlock + content.substring(endIndex);
    startIndex = endIndex + '</form>'.length;
  }

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed form buttons in', file);
  }
}
