import { BRAND_NAME } from '../config/brand';
export type SupportedLocale = 'en' | 'es' | 'fr' | 'de' | 'he';

export const DICTIONARY: Record<SupportedLocale, Record<string, string>> = {
  en: {
    'app.title': `${BRAND_NAME} ERP & Financial Engine`,
    'common.transactions': 'Transactions',
    'common.accounts': 'Chart of Accounts',
    'common.reports': 'Reports & Analytics',
    'common.save': 'Save Changes',
    'common.cancel': 'Cancel',
    'common.amount': 'Amount',
    'common.status': 'Status',
    'common.date': 'Date',
    'common.description': 'Description',
    'common.balance': 'Balance'
  },
  es: {
    'app.title': `${BRAND_NAME} ERP y Motor Financiero`,
    'common.transactions': 'Transacciones',
    'common.accounts': 'Plan de Cuentas',
    'common.reports': 'Informes y Analítica',
    'common.save': 'Guardar Cambios',
    'common.cancel': 'Cancelar',
    'common.amount': 'Monto',
    'common.status': 'Estado',
    'common.date': 'Fecha',
    'common.description': 'Descripción',
    'common.balance': 'Saldo'
  },
  fr: {
    'app.title': `${BRAND_NAME} ERP & Moteur Financier`,
    'common.transactions': 'Transactions',
    'common.accounts': 'Plan Comptable',
    'common.reports': 'Rapports et Analyses',
    'common.save': 'Enregistrer',
    'common.cancel': 'Annuler',
    'common.amount': 'Montant',
    'common.status': 'Statut',
    'common.date': 'Date',
    'common.description': 'Description',
    'common.balance': 'Solde'
  },
  de: {
    'app.title': `${BRAND_NAME} ERP & Finanz-Engine`,
    'common.transactions': 'Transaktionen',
    'common.accounts': 'Kontenrahmen',
    'common.reports': 'Berichte & Analysen',
    'common.save': 'Speichern',
    'common.cancel': 'Abbrechen',
    'common.amount': 'Betrag',
    'common.status': 'Status',
    'common.date': 'Datum',
    'common.description': 'Beschreibung',
    'common.balance': 'Saldo'
  },
  he: {
    'app.title': `${BRAND_NAME} מנוע פיננסי ו-ERP`,
    'common.transactions': 'תנועות',
    'common.accounts': 'לוח חשבונות',
    'common.reports': 'דוחות וניתוחים',
    'common.save': 'שמור שינויים',
    'common.cancel': 'ביטול',
    'common.amount': 'סכום',
    'common.status': 'סטטוס',
    'common.date': 'תאריך',
    'common.description': 'תיאור',
    'common.balance': 'יתרה'
  }
};

export function t(key: string, locale: SupportedLocale = 'en'): string {
  const locDict = DICTIONARY[locale] || DICTIONARY['en'];
  return locDict[key] || DICTIONARY['en'][key] || key;
}
