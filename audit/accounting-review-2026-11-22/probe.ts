// Non-destructive audit probe. Prints observed values; it intentionally does not
// assert that the current behavior is correct. See REPORT.md for expectations.
import { mileageRateFor } from '../../src/lib/tax/expenseRateTables';
import { mileageCents } from '../../src/lib/expenseClaims';
import { needsAllocationNumber } from '../../src/lib/tax/ilAllocation';
import { build1099Preview, threshold1099Cents } from '../../src/lib/tax/us1099Preview';

const rate = mileageRateFor({ country: 'US', date: '2026-07-01', unit: 'mi', currency: 'USD' });
console.log('2026 US mileage:', rate?.rateText, 'USD/mile;', mileageCents(1000, rate?.row.rateThousandths ?? 0) / 100, 'USD for 1,000 miles');
console.log('Israel allocation, USD with missing FX:', needsAllocationNumber({ date: '2026-07-01', netCents: 200000, currency: 'USD', buyerVatNumber: '123456789', taxCents: 36000 }));
console.log('Israel allocation, ILS 6,000 net / ILS 180 VAT:', needsAllocationNumber({ date: '2026-07-01', netCents: 600000, currency: 'ILS', buyerVatNumber: '123456789', taxCents: 18000 }));
console.log('2099 NEC threshold in USD cents:', threshold1099Cents(2099, '1099-NEC', '1a'));
const preview = build1099Preview([
  { vendorId: 'v1', vendorName: 'Vendor', form: '1099-MISC', box: '1', paidCents: 200000 },
  { vendorId: 'v1', vendorName: 'Vendor', form: '1099-MISC', box: '2', paidCents: 1000 },
], 2026);
console.log('Same vendor, two MISC boxes: rows / MISC 1096 form count:', preview.forms.length, '/', preview.form1096.find(row => row.form === '1099-MISC')?.forms);
