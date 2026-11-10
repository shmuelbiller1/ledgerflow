const fs = require('fs');
const glob = require('glob');

// Use glob to find all ts and tsx files
const files = glob.sync('src/**/*.{ts,tsx}');

let replacements = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  // Patterns to replace new Date(...) with parseLocalDate(...)
  // We only replace variables that we are confident contain date strings (YYYY-MM-DD),
  // e.g. dueDate, date, start, end, startDate, endDate, tDateStr, etc.
  const regexes = [
    /new Date\((start)\)/g,
    /new Date\((end)\)/g,
    /new Date\((startDate)\)/g,
    /new Date\((endDate)\)/g,
    /new Date\((dueDate)\)/g,
    /new Date\((dueDateStr)\)/g,
    /new Date\((dateInput)\)/g,
    /new Date\((tDateStr)\)/g,
    /new Date\((targetDateStr)\)/g,
    /new Date\((dateVar)\)/g,
    /new Date\(([a-zA-Z0-9_\.]+\.dueDate)\)/g,
    /new Date\(([a-zA-Z0-9_\.]+\.date)\)/g,
    /new Date\(([a-zA-Z0-9_\.]+\.validFrom)\)/g,
    /new Date\(([a-zA-Z0-9_\.]+\.validTo)\)/g,
  ];

  regexes.forEach(regex => {
    content = content.replace(regex, 'parseLocalDate($1)');
  });

  if (content !== originalContent) {
    // Add import if missing
    if (!content.includes("parseLocalDate")) {
      content = "import { parseLocalDate } from '@/lib/utils';\n" + content; 
      // wait, imports are relative in this codebase, let's just do a naive regex or let the linter complain.
      // Or we can dynamically find the relative path.
      let depth = file.split('/').length - 2;
      let relPath = depth === 0 ? './lib/utils' : '../'.repeat(depth) + 'lib/utils';
      content = `import { parseLocalDate } from '${relPath}';\n` + content;
    }
    fs.writeFileSync(file, content, 'utf8');
    replacements++;
    console.log(`Replaced in ${file}`);
  }
});

console.log(`Updated ${replacements} files.`);
