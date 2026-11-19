/** Translate the finite status vocabulary at display time. CSVs keep their recorded values. */
export function certificateFieldText(reportText: (key: string, fallback: string) => string, value: string) {
  switch (value) {
    case 'Expiring within 30 days': return reportText('r.expires-soon', 'Expiring within 30 days');
    case 'Expired': return reportText('r.expired', 'Expired');
    case 'Needs review': return reportText('r.needs-review-2', 'Needs review');
    case 'Current by recorded date': return reportText('r.current-by-date', 'Current by recorded date');
    case 'No expiry recorded': return reportText('r.no-expiry', 'No expiry recorded');
    case 'Recorded — unverified': return reportText('r.tax-id-unverified', 'Recorded — unverified');
    case 'Not recorded': return reportText('r.not-recorded', 'Not recorded');
    case 'The stored certificate number needs review.': return reportText('r.review-cert-number', 'The stored certificate number needs review.');
    case 'The stored expiry is not a real calendar day.': return reportText('r.review-expiry', 'The stored expiry is not a real calendar day.');
    case 'Tax/VAT ID not recorded in a readable field.': return reportText('r.review-tax-id', 'Tax/VAT ID not recorded in a readable field.');
    case 'Review the stored withholding data or expiry.': return reportText('r.review-withholding', 'Review the stored withholding data or expiry.');
    case 'Certificate reference not recorded.': return reportText('r.missing-cert-ref', 'Certificate reference not recorded.');
    case 'Review the recorded certificate expiry.': return reportText('r.review-cert-expiry', 'Review the recorded certificate expiry.');
    case 'Check whether the certificate has an expiry.': return reportText('r.check-expiry', 'Check whether the certificate has an expiry.');
    case 'No Israeli withholding certificate is recorded; check whether one is required.': return reportText('r.check-il-certificate', 'No Israeli withholding certificate is recorded; check whether one is required.');
    default: return value;
  }
}
