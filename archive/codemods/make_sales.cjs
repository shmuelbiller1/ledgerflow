const fs = require('fs');

const p = fs.readFileSync('src/components/purchases/Purchases.tsx', 'utf8');
const s_start = fs.readFileSync('src/components/sales/Sales.tsx', 'utf8');

// The cutoff in Sales.tsx is right after `<div className="flex items-center bg-[var(--surface)]/80 p-1 rounded-xl border border-[var(--line)] shadow-inner backdrop-blur-sm">`
// Let's grab everything after that from Purchases.tsx
const p_parts = p.split('<div className="flex items-center bg-[var(--surface)]/80 p-1 rounded-xl border border-[var(--line)] shadow-inner backdrop-blur-sm">');
let p_end = p_parts[1];

// Substitutions
p_end = p_end.replace(/bills/g, 'invoices');
p_end = p_end.replace(/Bills/g, 'Invoices');
p_end = p_end.replace(/activeSubTab === 'bills'/g, "activeSubTab === 'invoices'");
p_end = p_end.replace(/setIsBillModalOpen/g, 'setIsInvoiceModalOpen');
p_end = p_end.replace(/setIsVendorModalOpen/g, 'setIsCustomerModalOpen');
p_end = p_end.replace(/Add Bill/g, 'Add Invoice');
p_end = p_end.replace(/Add Vendor/g, 'Add Customer');
p_end = p_end.replace(/Vendors & Suppliers/g, 'Customers & Clients');
p_end = p_end.replace(/vendors/g, 'customers');
p_end = p_end.replace(/vendors/g, 'customers');
p_end = p_end.replace(/Vendors/g, 'Customers');
p_end = p_end.replace(/BillModal/g, 'InvoiceModal');
p_end = p_end.replace(/VendorModal/g, 'CustomerModal');
p_end = p_end.replace(/bill/g, 'inv');
p_end = p_end.replace(/vend/g, 'cust');
p_end = p_end.replace(/Supplier Profile/g, 'Customer Profile');
p_end = p_end.replace(/Infrastructure/g, 'Contact');
p_end = p_end.replace(/Net Liability/g, 'Net Receivable');
p_end = p_end.replace(/Total Aggregate Payable/g, 'Total Accounts Receivable');
p_end = p_end.replace(/Disbursement Horizon/g, 'Inbound Cashflow Horizon');
p_end = p_end.replace(/Outflow Expected/g, 'Inflow Expected');
p_end = p_end.replace(/Cash Outflow Map/g, 'Cash Inflow Map');
p_end = p_end.replace(/filteredBills/g, 'filteredInvoices');
p_end = p_end.replace(/onUpdateBill/g, 'onAddInvoice'); // wait, onUpdateBill didn't exist in Sales, it just uses onAddInvoice
p_end = p_end.replace(/onAddBill/g, 'onAddInvoice');
p_end = p_end.replace(/onAddVendor/g, 'onAddCustomer');
p_end = p_end.replace(/Enter Bill/g, 'Enter Invoice');

const final_sales = s_start + p_end;

fs.writeFileSync('src/components/sales/Sales.tsx', final_sales);
