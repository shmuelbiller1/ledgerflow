const fs = require('fs');
const file = 'src/components/sales/Sales.tsx';
let content = fs.readFileSync(file, 'utf8');

// The "Send late-payment reminder" one
content = content.replace(/<button[^>]*>\s*<svg[^>]*Email \/ Send Late-Payment Reminder[^>]*>[\s\S]*?<\/button>/g, '');
content = content.replace(/<button[^>]*>\s*<svg[^>]*Write-off Bad Debt \/ Hold[^>]*>[\s\S]*?<\/button>/g, '');
// Wait, the SVG has title on the BUTTON!
content = content.replace(/<button[^>]*title="Email \/ Send Late-Payment Reminder"[\s\S]*?<\/button>/g, '');
content = content.replace(/<button[^>]*title="Write-off Bad Debt \/ Hold"[\s\S]*?<\/button>/g, '');

fs.writeFileSync(file, content);
