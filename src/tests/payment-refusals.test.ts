import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../lib/errorRemedies';
import { describePaymentRefusal } from '../lib/paymentRefusals';

// HTTP examples using the message shapes preserved by paymentRoutes.ts from paymentService.ts.
const examples = [
  ['Overpayment not allowed: allocation of 9000 cents exceeds remaining balance of 8000 cents for document offline-02', /current balance/, /היתרה העדכנית/],
  ['Total allocated amount (15000 cents) exceeds payment amount (12500 cents)', /total is no more than the payment amount/, /לא יעלה על סכום התשלום/],
  ['Cannot record a payment against a draft document', /open invoice or bill/, /חשבונית פתוחה/],
  ['Cannot record a payment against a void document', /open invoice or bill/, /חשבונית פתוחה/],
  ['One payment can only pay documents in the same currency (and exchange rate); record separate payments', /Record separate payments/, /תשלומים נפרדים/],
] as const;

for (const [message, englishRemedy, hebrewRemedy] of examples) {
  test(`manual payment refusal gives a specific remedy: ${message}`, () => {
    const error = new Error(message);
    const en = describePaymentRefusal(error, 'en');
    const he = describePaymentRefusal(error, 'he');
    assert.match(en.remedy, englishRemedy);
    assert.match(he.remedy, hebrewRemedy);
    assert.match(he.title, /\p{Script=Hebrew}/u);
    assert.doesNotMatch(`${en.title} ${en.remedy} ${he.title} ${he.remedy}`, /offline-02/);
  });
}

test('an unrecognized or general payment refusal still uses the shared localized message', () => {
  for (const message of ['This period is locked', 'An unrecognized message']) {
    for (const language of ['en', 'he'] as const) {
      const error = new Error(message);
      assert.deepEqual(describePaymentRefusal(error, language), describeError(error, 'create', language));
    }
  }
});
