/** A bank and a few expense accounts, by id, for tests of categorising and labelling entries. */
import { makeChartAccount } from '../fixtures';

const ALL = {
  bank: makeChartAccount({ id: 'bank', code: '1000', name: 'Bank', type: 'asset', category: 'Cash' }),
  office: makeChartAccount({ id: 'office', code: '6000', name: 'Office', type: 'expense', category: 'Expenses' }),
  fuel: makeChartAccount({ id: 'fuel', code: '6100', name: 'Fuel', type: 'expense', category: 'Expenses' }),
  hosting: makeChartAccount({ id: 'hosting', code: '6200', name: 'Hosting', type: 'expense', category: 'Expenses' }),
  meals: makeChartAccount({ id: 'meals', code: '6300', name: 'Meals', type: 'expense', category: 'Expenses' }),
};

/** The named accounts, in the order given (always starting from the bank). */
export const expenseAccounts = (...ids: Array<Exclude<keyof typeof ALL, 'bank'>>) => [ALL.bank, ...ids.map(id => ALL[id])];
