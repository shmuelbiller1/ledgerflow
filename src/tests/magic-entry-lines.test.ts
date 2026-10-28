// The quick-entry window ("Paid $45 for lunch") used to hand only { amount } to onAdd. The save ignores
// `amount`, so every entry reached the server with no lines and was refused: "Failed to add transaction.
// Protocol interrupted. Invalid transaction structure: at least 2 lines required."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const magic = readFileSync('src/components/ledger/MagicEntry.tsx', 'utf8');
const entry = readFileSync('src/hooks/transactionActions/entryActions.ts', 'utf8');

test('quick entry posts both lines itself, never an amount-only object', () => {
  assert.doesNotMatch(magic, /onAdd\(\{/);
  assert.match(magic, /handleQuickAdd\(\{[\s\S]*?lines: \[[\s\S]*?amountCents: isExp \? amt : -amt[\s\S]*?amountCents: isExp \? -amt : amt/);
});

test('quick entry refuses a missing amount and shows success only after the save', () => {
  assert.match(magic, /if \(!amt\) \{[\s\S]*?toast\.error/);
  assert.match(magic, /if \(!saved\) return;\s*toast\.success/);
});

test('handleQuickAdd stops an entry with fewer than two lines before the server', () => {
  assert.match(entry, /processedLines\.length < 2\) \{\s*\/?\/?[^\n]*\n?\s*toast\.error/);
});
