import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DoubleEntryValidator } from '../kernel/validation/DoubleEntryValidator';
import { TransactionTemplates } from '../kernel/templates/TransactionTemplates';
import { Transaction, TransactionLine } from '../types';
import { typesSource } from './helpers/typesSource';

describe('A-04 & H-30: Property Invariants & Double-Entry Equality Suite', () => {

  /** The journal a template produced, shaped the way the validator reads it. */
  function journalFor(id: string, description: string, totalAmountCents: number, currency: string, lines: TransactionLine[]): Transaction {
    return {
      id,
      uid: 'user-test',
      workspaceId: 'ws-test',
      date: '2026-06-01',
      description,
      totalAmountCents,
      currency,
      status: 'completed',
      type: 'actual',
      createdAt: new Date().toISOString(),
      lines,
    };
  }

  /** A posting's debits and credits, each summed without its sign. */
  function postingTotals(lines: TransactionLine[]): { debitCents: number; creditCents: number } {
    return {
      debitCents: lines.filter(l => l.amountCents > 0).reduce((sum, l) => sum + l.amountCents, 0),
      creditCents: lines.filter(l => l.amountCents < 0).reduce((sum, l) => sum + Math.abs(l.amountCents), 0),
    };
  }

  /** The posting passes the double-entry validator, and its debits equal its credits to the cent. */
  function assertBalancedPosting(label: string, tx: Transaction) {
    assert.doesNotThrow(() => DoubleEntryValidator.validateJournalEntry(tx));
    const { debitCents, creditCents } = postingTotals(tx.lines);
    assert.strictEqual(debitCents, creditCents, `${label} debits must equal credits exactly`);
  }

  test('Every generated Invoice template posting set satisfies totalDebit === totalCredit exactly', () => {
    // Test 1,000 randomized permutations of invoices
    for (let i = 0; i < 1000; i++) {
      const totalCents = Math.floor(Math.random() * 5000000) + 100; // $1 to $50,000
      const taxCents = Math.floor(totalCents * 0.15 * Math.random());
      const discountCents = Math.floor(totalCents * 0.1 * Math.random());
      const retainageCents = Math.floor((totalCents - taxCents) * 0.1 * Math.random());
      const exchangeRate = parseFloat((0.25 + Math.random() * 5).toFixed(4));

      const lines = TransactionTemplates.buildInvoiceLines({
        invoiceNumber: `INV-${i + 1000}`,
        customerName: `Customer ${i}`,
        totalCents,
        taxCents,
        discountCents,
        retainageCents,
        exchangeRate,
        arAccount: { id: 'acc-ar-1', name: 'Accounts Receivable' },
        revenueAccount: { id: 'acc-rev-1', name: 'Sales Revenue' },
        taxAccount: taxCents > 0 ? { id: 'acc-tax-1', name: 'Sales Tax Payable' } : null,
        discountAccount: discountCents > 0 ? { id: 'acc-disc-1', name: 'Sales Discounts' } : null,
        retainageAccount: retainageCents > 0 ? { id: 'acc-ret-1', name: 'Retainage Receivable' } : null
      });

      assertBalancedPosting(`Invoice ${i}`, journalFor(`tx-inv-${i}`, `Invoice INV-${i + 1000}`, totalCents, 'USD', lines));
    }
  });

  test('Every generated Bill template posting set satisfies totalDebit === totalCredit exactly', () => {
    // Test 1,000 randomized permutations of bills
    for (let i = 0; i < 1000; i++) {
      const totalCents = Math.floor(Math.random() * 5000000) + 100;
      const taxCents = Math.floor(totalCents * 0.2 * Math.random());
      const discountCents = Math.floor(totalCents * 0.05 * Math.random());
      const retainageCents = Math.floor((totalCents - taxCents) * 0.1 * Math.random());
      const exchangeRate = parseFloat((0.5 + Math.random() * 3).toFixed(4));

      const lines = TransactionTemplates.buildBillLines({
        billNumber: `BILL-${i + 1000}`,
        vendorName: `Vendor ${i}`,
        totalCents,
        taxCents,
        discountCents,
        retainageCents,
        exchangeRate,
        apAccount: { id: 'acc-ap-1', name: 'Accounts Payable' },
        expenseAccount: { id: 'acc-exp-1', name: 'Operating Expense' },
        taxAccount: taxCents > 0 ? { id: 'acc-tax-input-1', name: 'Input Tax Recoverable' } : null,
        discountAccount: discountCents > 0 ? { id: 'acc-disc-rec-1', name: 'Purchase Discounts' } : null,
        retainageAccount: retainageCents > 0 ? { id: 'acc-ret-pay-1', name: 'Retainage Payable' } : null
      });

      assertBalancedPosting(`Bill ${i}`, journalFor(`tx-bill-${i}`, `Bill BILL-${i + 1000}`, totalCents, 'EUR', lines));
    }
  });

  test('Random N-split journal entries sum strictly to 0 net impact', () => {
    // Test 1,000 multi-leg split distributions
    for (let iter = 0; iter < 1000; iter++) {
      const legCount = Math.floor(Math.random() * 8) + 2; // 2 to 10 legs
      const totalAmountCents = Math.floor(Math.random() * 1000000) + 1000;
      
      const lines: TransactionLine[] = [];
      let remainingCents = totalAmountCents;

      // Create N-1 debit legs
      for (let j = 0; j < legCount - 1; j++) {
        const slice = j === legCount - 2 
          ? remainingCents 
          : Math.floor((remainingCents / (legCount - j)) * (0.5 + Math.random()));
        const amount = Math.max(1, Math.min(slice, remainingCents));
        lines.push({
          accountId: `acc-leg-${j}`,
          accountName: `Account Leg ${j}`,
          amountCents: amount
        });
        remainingCents -= amount;
      }
      if (remainingCents > 0) {
        lines[lines.length - 1].amountCents += remainingCents;
      }

      // Single balancing credit leg
      lines.push({
        accountId: 'acc-offset',
        accountName: 'Offset Clearing',
        amountCents: -totalAmountCents
      });

      const tx = journalFor(`tx-split-${iter}`, `Split journal entry #${iter}`, totalAmountCents, 'USD', lines);

      assert.doesNotThrow(() => DoubleEntryValidator.validateJournalEntry(tx));
    }
  });

  test('§AG Guard: No money field may be read via a ??/|| fallback to a second field name', () => {
    function getFiles(dir: string): string[] {
      const results: string[] = [];
      const list = readdirSync(dir);
      for (const file of list) {
        const fullPath = join(dir, file);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          if (file !== 'node_modules' && file !== 'dist' && file !== 'tests') {
            results.push(...getFiles(fullPath));
          }
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const srcFiles = getFiles('src');
    const moneyFallbackPattern = /\.(amountCents|totalAmountCents|totalCents|amountPaidCents|paidAmountCents)\s*(\?\?|\|\|)\s*[\w.]*\.(amountCents|totalAmountCents|totalCents|amountPaidCents|paidAmountCents)/;

    const violations: string[] = [];
    const phantomReads: string[] = [];

    for (const filePath of srcFiles) {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (moneyFallbackPattern.test(line)) {
          violations.push(`${filePath}:${idx + 1} -> ${line.trim()}`);
        }
        if (line.includes('paidAmountCents')) {
          phantomReads.push(`${filePath}:${idx + 1} -> ${line.trim()}`);
        }
      });
    }

    assert.equal(
      violations.length,
      0,
      `Detected forbidden money fallback across second field name:\n${violations.join('\n')}`
    );

    assert.equal(
      phantomReads.length,
      0,
      `Detected phantom paidAmountCents read (must use amountPaidCents):\n${phantomReads.join('\n')}`
    );

    // Verify PurchaseOrderItem.totalCents in types.ts is strictly preserved as a line-item total (quantity * unitPrice)
    const typesContent = typesSource(); // src/types.ts and the area files it re-exports (src/model/)
    assert.ok(
      typesContent.includes('totalCents: number;'),
      'PurchaseOrderItem.totalCents must be present in src/types.ts'
    );
    const totalCentsMatches = typesContent.match(/totalCents\??:\s*number/g) || [];
    assert.equal(
      totalCentsMatches.length,
      1,
      'PurchaseOrderItem should be the ONLY interface in src/types.ts with totalCents'
    );
  });
});
