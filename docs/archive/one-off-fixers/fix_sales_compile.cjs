const fs = require('fs');
const file = 'src/components/sales/Sales.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add missing imports
if (!content.includes("import { motion }")) {
  content = content.replace("import { format } from 'date-fns';", "import { format, differenceInDays } from 'date-fns';\nimport { motion } from 'motion/react';");
} else {
  if (!content.includes('differenceInDays')) {
    content = content.replace("import { format } from 'date-fns';", "import { format, differenceInDays } from 'date-fns';");
  }
}

if (!content.includes('Calendar')) {
  content = content.replace("Trash2,", "Trash2, Calendar, Zap,");
}

// 2. Fix agingBuckets references
content = content.replace(/agingBuckets\.due30/g, 'agingBuckets.dueSoon');
content = content.replace(/agingBuckets\.due60/g, '0 /* N/A for sales */');
content = content.replace(/agingBuckets\.current/g, 'agingBuckets.total');

// 3. Remove Timeline Visualization
// find "Timeline Visualization" comment and remove until "activeSubTab ==="
const timelineStart = content.indexOf('{/* Timeline Visualization */}');
if (timelineStart !== -1) {
  let nextTab = content.indexOf('{activeSubTab ===', timelineStart);
  if (nextTab !== -1) {
    content = content.substring(0, timelineStart) + content.substring(nextTab);
  }
}

// 4. Fix custorName
content = content.replace(/inv\.custorName/g, 'inv.customerName');

// 5. Fix status overlap (unpaid -> pending)
content = content.replace(/inv\.status === 'unpaid'/g, "inv.status === 'pending'");

// 6. Fix onAddInvoice arguments
// From: onAddInvoice(inv.id, { status: 'paid' })
// To: onAddInvoice({ id: inv.id, status: 'paid' })
content = content.replace(/onAddInvoice\(\s*inv\.id\s*,\s*\{\s*status:\s*'paid'\s*\}\s*\)/g, "onAddInvoice({ id: inv.id, status: 'paid' })");
content = content.replace(/onAddInvoice\(\s*inv\.id\s*,\s*\{\s*status:\s*'void'\s*\}\s*\)/g, "onAddInvoice({ id: inv.id, status: 'void' })");

// 7. Fix any missing onUpdateCustomer calls (from onUpdateVendor)
content = content.replace(/onAddCustomer\(\s*cust\.id\s*,\s*\{\s*status:\s*'active'\s*\}\s*\)/g, "onAddCustomer({ id: cust.id, status: 'active' })");

fs.writeFileSync(file, content);
