/** Sample books for the browser tests (moved from src/lib when the demo-seed route was removed, #656). */
import { ChartAccount, Transaction, Customer, Vendor } from '../../src/types';

export function seedDemoWorkspace(workspaceId: string) {
  const accounts: ChartAccount[] = [
    { id: `acc_demo_bank_${workspaceId}`, uid: 'usr_demo', workspaceId, code: '1010', name: 'Operating Bank Account', type: 'asset', category: 'Cash', balanceCents: 8500000 },
    { id: `acc_demo_ar_${workspaceId}`, uid: 'usr_demo', workspaceId, code: '1200', name: 'Accounts Receivable', type: 'asset', category: 'Receivables', balanceCents: 2400000 },
    { id: `acc_demo_ap_${workspaceId}`, uid: 'usr_demo', workspaceId, code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables', balanceCents: 1500000 },
    { id: `acc_demo_rev_${workspaceId}`, uid: 'usr_demo', workspaceId, code: '4000', name: 'SaaS Software Revenue', type: 'income', category: 'Sales', balanceCents: 12500000 },
    { id: `acc_demo_exp_${workspaceId}`, uid: 'usr_demo', workspaceId, code: '5000', name: 'Cloud Server Hosting', type: 'expense', category: 'Operations', balanceCents: 3100000 }
  ];

  const customers: Customer[] = [
    { id: `cust_demo_1_${workspaceId}`, uid: 'usr_demo', workspaceId, name: 'Acme Enterprises', email: 'billing@acme.com', balanceCents: 1500000 },
    { id: `cust_demo_2_${workspaceId}`, uid: 'usr_demo', workspaceId, name: 'Stark Industries', email: 'finance@stark.com', balanceCents: 900000 }
  ];

  const vendors: Vendor[] = [
    { id: `vend_demo_1_${workspaceId}`, uid: 'usr_demo', workspaceId, name: 'Amazon Web Services', category: 'Hosting & Infrastructure', balanceCents: 1200000 },
    { id: `vend_demo_2_${workspaceId}`, uid: 'usr_demo', workspaceId, name: 'GitHub Services', category: 'Software Tools', balanceCents: 300000 }
  ];

  const transactions: Transaction[] = [
    {
      id: `tx_demo_1_${workspaceId}`,
      uid: 'usr_demo',
      workspaceId,
      date: '2026-09-01',
      description: 'Acme Enterprise Software Renewal',
      totalAmountCents: 1500000,
      currency: 'USD',
      status: 'completed',
      type: 'income',
      createdAt: '2026-09-01T00:00:00Z',
      lines: [
        { accountId: accounts[0].id, accountName: accounts[0].name, amountCents: 1500000 },
        { accountId: accounts[3].id, accountName: accounts[3].name, amountCents: -1500000 }
      ]
    },
    {
      id: `tx_demo_2_${workspaceId}`,
      uid: 'usr_demo',
      workspaceId,
      date: '2026-09-05',
      description: 'AWS September Hosting Fee',
      totalAmountCents: 1200000,
      currency: 'USD',
      status: 'completed',
      type: 'expense',
      createdAt: '2026-09-05T00:00:00Z',
      lines: [
        { accountId: accounts[4].id, accountName: accounts[4].name, amountCents: 1200000 },
        { accountId: accounts[0].id, accountName: accounts[0].name, amountCents: -1200000 }
      ]
    }
  ];

  return { accounts, customers, vendors, transactions };
}
