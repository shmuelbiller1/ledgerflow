const fs = require('fs');

function fixSales() {
  const file = 'src/components/sales/Sales.tsx';
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/<button[^>]*>\s*<svg[^>]*Email \/ Send Late-Payment Reminder[^>]*>[\s\S]*?<\/button>/, '');
  content = content.replace(/<button[^>]*>\s*<svg[^>]*Write-off Bad Debt \/ Hold[^>]*>[\s\S]*?<\/button>/, '');
  
  // also replace the onAddInvoice with async await
  content = content.replace(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); onAddInvoice\(\{\.\.\.inv, id: '', number: `INV-\$\{Date\.now\(\)\.toString\(\)\.slice\(-6\)\}`, date: format\(new Date\(\), 'yyyy-MM-dd'\)\}\); toast\.success\('Duplicated invoice successfully\.'\) \}\}/g, 
    "onClick={async (e) => { e.stopPropagation(); try { await onAddInvoice({...inv, id: '', number: `INV-${Date.now().toString().slice(-6)}`, date: format(new Date(), 'yyyy-MM-dd')}); toast.success('Duplicated invoice successfully.'); } catch (err) { toast.error('Failed to duplicate invoice.'); } }}");
  content = content.replace(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); onAddInvoice\(\{\.\.\.inv, status: 'paid' as any\}\); toast\.success\('Payment applied successfully\.'\) \}\}/g,
    "onClick={async (e) => { e.stopPropagation(); try { await onAddInvoice({...inv, status: 'paid' as any}); toast.success('Payment applied successfully.'); } catch (err) { toast.error('Failed to apply payment.'); } }}");
  content = content.replace(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); onAddInvoice\(\{\.\.\.inv, status: 'void' as any\}\); toast\.success\('Instrument strictly voided\.'\) \}\}/g,
    "onClick={async (e) => { e.stopPropagation(); try { await onAddInvoice({...inv, status: 'void' as any}); toast.success('Instrument strictly voided.'); } catch (err) { toast.error('Failed to void instrument.'); } }}");
  content = content.replace(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); onAddInvoice\(\{\.\.\.inv, status: 'void' as any\}\); toast\.success\('Written off as Bad Debt\.'\); \}\}/g,
    "onClick={async (e) => { e.stopPropagation(); try { await onAddInvoice({...inv, status: 'void' as any}); toast.success('Written off as Bad Debt.'); } catch (err) { toast.error('Failed to write off bad debt.'); } }}");

  fs.writeFileSync(file, content);
}

function fixPurchases() {
  const file = 'src/components/purchases/Purchases.tsx';
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/<button onClick=\{\(e\)=>\{e\.stopPropagation\(\); toast\.success\(`Payment batch queued for \$\{vend\.name\}`\)\}\} className="p-2 text-indigo-500 hover:bg-indigo-50 rounded" title="Make Payment"><Zap size=\{14\}\/><\/button>/g, '');
  content = content.replace(/<button onClick=\{\(e\)=>\{e\.stopPropagation\(\); toast\.success\(`Vendor \$\{vend\.name\} status updated`\)\}\} className="p-2 text-rose-500 hover:bg-rose-50 rounded" title="Block\/Deactivate"><Trash2 size=\{14\}\/><\/button>/g, '');
  
  content = content.replace(/onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*onAddBill\(\{\.\.\.b, id: '', number: `BILL-\$\{Date\.now\(\)\.toString\(\)\.slice\(-6\)\}`, date: format\(new Date\(\), 'yyyy-MM-dd'\)\}\);\s*toast\.success\('Liability Copied'\);\s*\}\}/g,
    "onClick={async (e) => { e.stopPropagation(); try { await onAddBill({...b, id: '', number: `BILL-${Date.now().toString().slice(-6)}`, date: format(new Date(), 'yyyy-MM-dd')}); toast.success('Liability Copied'); } catch (err) { toast.error('Failed to copy liability.'); } }}");

  fs.writeFileSync(file, content);
}

try { fixSales(); } catch(e) { console.error(e); }
try { fixPurchases(); } catch(e) { console.error(e); }

