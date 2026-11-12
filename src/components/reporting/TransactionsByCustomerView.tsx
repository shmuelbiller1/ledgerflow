import { FileText } from 'lucide-react';
import { computeTransactionsByCustomer } from '../../server/reports/partyReports';
import { TransactionsByPartyView } from './partyTransactionsShared';

/**
 * Itemized chronological ledger of invoices, receipts, and credits attributed
 * to each customer. The shared behaviour lives in `TransactionsByPartyView`;
 * this file only supplies the customer-specific config.
 */
export const TransactionsByCustomerView: React.FC<{ startDate?: string; endDate?: string }> = (props) => (
  <TransactionsByPartyView
    config={{
      title: 'Transactions by Customer',
      description:
        'Itemized chronological ledger of invoices, receipts, and credits attributed to each customer.',
      icon: FileText,
      partyHeader: 'Customer',
      incomeType: 'Invoice',
      incomeLabel: 'Total Invoiced Volume',
      paymentType: 'Payment',
      paymentLabel: 'Total Payments Volume',
      exportFilename: 'transactions_by_customer',
      toastMessage: 'Transactions by Customer exported to CSV',
      searchPlaceholder: 'Filter by customer name, ref, or type...',
      emptyMessage: 'No customer transactions found matching search filter.',
      partyStore: (s) => s.customers,
      docStore1: (s) => s.invoices,
      docStore2: (s) => s.creditNotes,
      paymentStore: (s) => s.payments,
      collections: ['creditNotes', 'customers', 'invoices', 'payments'],
      computeFn: computeTransactionsByCustomer,
      typeColors: {
        Invoice: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        'Credit Note': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        Payment: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      },
    }}
    {...props}
  />
);

export default TransactionsByCustomerView;
