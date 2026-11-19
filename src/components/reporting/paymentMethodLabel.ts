/** Translate the built-in method codes for the screen, never rewrite a named method or a financial CSV key. */
export function paymentMethodLabel(method: string, reportText: (key: string, fallback: string) => string): string {
  switch (method) {
    case 'cash': return reportText('basis.cash', 'Cash');
    case 'card': return reportText('r.method-card', 'Card');
    case 'bank_transfer': return reportText('r.method-transfer', 'Bank transfer');
    case 'check': return reportText('r.method-check', 'Check');
    case 'other': return reportText('r.method-other', 'Other');
    case 'Unspecified': return reportText('r.method-unspecified', 'Unspecified');
    default: return method;
  }
}
