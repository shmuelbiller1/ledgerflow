import { FileSpreadsheet } from 'lucide-react';
import { computeTransactionsByVendor } from '../../server/reports/partyReports';
import { TransactionsByPartyView } from './TransactionsByPartyView';

/**
 * Itemized chronological register of bills, vendor credits, and disbursement
 * payments per supplier. The shared behaviour lives in `TransactionsByPartyView`;
 * this file only supplies the vendor-specific config.
 */
export const TransactionsByVendorView: React.FC<{ startDate?: string; endDate?: string }> = (props) => (
  <TransactionsByPartyView
    config={{
      title: 'Transactions by Vendor',
      description:
        'Itemized chronological register of bills, vendor credits, and disbursement payments per supplier.',
      icon: FileSpreadsheet,
      partyHeader: 'Vendor',
      incomeType: 'Bill',
      incomeLabel: 'Total Billed Volume',
      paymentType: 'Vendor Payment',
      paymentLabel: 'Total Disbursements',
      exportFilename: 'transactions_by_vendor',
      toastMessage: 'Transactions by Vendor exported to CSV',
      searchPlaceholder: 'Filter by vendor name, ref, or type...',
      emptyMessage: 'No vendor transactions found matching search filter.',
      partyStore: (s) => s.vendors,
      docStore1: (s) => s.bills,
      docStore2: (s) => s.vendorCredits,
      paymentStore: (s) => s.payments,
      collections: ['bills', 'payments', 'vendorCredits', 'vendors'],
      computeFn: computeTransactionsByVendor,
      typeColors: {
        Bill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        'Vendor Credit': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        'Vendor Payment': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      },
    }}
    {...props}
  />
);

export default TransactionsByVendorView;
