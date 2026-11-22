import { describeError, errorMessage, type DescribedError } from './errorRemedies';
import type { UiLanguage } from './i18n/uiLanguage';

// These messages come from createPaymentInTransaction via payment.receive and the payment route.
// Keep their copy with the lazy Sales/Purchases screens, not in the bootstrap error dictionary.
const PAYMENT_REFUSALS: ReadonlyArray<{ match: RegExp; en: DescribedError; he: DescribedError }> = [
  {
    match: /^overpayment not allowed: allocation of /i,
    en: {
      title: 'The allocated amount is more than the document balance',
      remedy: 'Reduce the amount applied to the invoice or bill after checking its current balance.',
    },
    he: {
      title: 'הסכום שהוקצה גבוה מיתרת המסמך',
      remedy: 'יש לבדוק את היתרה העדכנית בחשבונית או בחשבון הספק ולהקטין את הסכום שהוקצה למסמך.',
    },
  },
  {
    match: /^total allocated amount \(\d+ cents\) exceeds payment amount \(\d+ cents\)$/i,
    en: {
      title: 'The amounts applied add up to more than the payment',
      remedy: 'Reduce the amounts applied so their total is no more than the payment amount.',
    },
    he: {
      title: 'סך הסכומים שהוקצו גבוה מסכום התשלום',
      remedy: 'יש להקטין את הסכומים שהוקצו כך שהסכום הכולל שלהם לא יעלה על סכום התשלום.',
    },
  },
  {
    match: /^cannot record a payment against a (draft|void) document$/i,
    en: {
      title: 'This invoice or bill is a draft or has been voided',
      remedy: 'Choose an open invoice or bill that still has a balance.',
    },
    he: {
      title: 'החשבונית או חשבון הספק עדיין בטיוטה או בוטלו',
      remedy: 'יש לבחור חשבונית פתוחה או חשבון ספק פתוח שנותרה בהם יתרה לתשלום.',
    },
  },
  {
    match: /^one payment can only pay documents in the same currency \(and exchange rate\); record separate payments$/i,
    en: {
      title: 'These documents have different currencies or exchange rates',
      remedy: 'Record separate payments for documents with different currencies or exchange rates.',
    },
    he: {
      title: 'למסמכים האלה יש מטבעות או שערי חליפין שונים',
      remedy: 'יש לרשום תשלומים נפרדים למסמכים במטבעות או בשערי חליפין שונים.',
    },
  },
];

export function describePaymentRefusal(error: unknown, language: UiLanguage): DescribedError {
  const message = errorMessage(error);
  // Specific refusals win even if the message contains an internal identifier such as 'offline'.
  const result = PAYMENT_REFUSALS.find(({ match }) => match.test(message));
  return result ? { ...result[language] } : describeError(error, 'create', language);
}
