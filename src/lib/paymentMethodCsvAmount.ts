import { csvMoneyForCurrency } from './csvExport';

export function paymentMethodCsvAmount(minorUnits: number, currency: string): string {
  return csvMoneyForCurrency(currency)(minorUnits);
}
