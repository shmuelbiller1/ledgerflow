/**
 * The setup screen's own words for the chart templates (`src/lib/businessTemplates*.ts` holds the
 * accounts a template writes; this is only what the choice is called).
 *
 * AI12-N10-01 (#838): kept out of `onboardingTranslations.ts` and imported by the setup wizard, which is
 * a lazy chunk. Carrying it in the entry bundle would have put ~4 KB of Hebrew template names into the
 * first download for every visitor, including the ones who never open setup.
 */
export const TEMPLATE_COPY_HE: Readonly<Record<string, { name: string; description: string }>> = {
  creative: { name: 'פרויקט יצירתי', description: 'מתאים לפרילנסרים, לאמנים ולבתי הפקה.' },
  retail: { name: 'מסחר אלקטרוני / קמעונאות', description: 'מתאים לחנויות שמוכרות מוצרים פיזיים או דיגיטליים.' },
  saas: { name: 'SaaS / מנויים', description: 'מתאים לחברות תוכנה עם הכנסה חוזרת.' },
  realestate: { name: 'נדל״ן / נכסים', description: 'מתאים למנהלי נכסים ולמשקיעי נדל״ן.' },
  nonprofit: { name: 'עמותה / ארגון ללא כוונת רווח', description: 'מתאים לעמותות, לקרנות ולקבוצות קהילתיות.' },
  service: { name: 'שירותים מקצועיים', description: 'מתאים לייעוץ, למשרדי עורכי דין ולרואי חשבון.' },
  manufacturing: { name: 'ייצור / תפוקה', description: 'מתאים למפעלים ולחברות פיתוח מוצר.' },
  hospitality: { name: 'אירוח / מסעדנות', description: 'מתאים לבתי מלון, למסעדות ולבתי קפה.' },
  agriculture: { name: 'חקלאות', description: 'מתאים למשקי חי, לגידולים ולחוות אורגניות שעוקבות אחר מזון, ציוד וסובסידיות.' },
  healthcare: { name: 'בריאות / מרפאה', description: 'מתאים למרפאות, לרופאים ולשיניים.' },
  logistics: { name: 'לוגיסטיקה וציים', description: 'מתאים לחברות הובלה, למשלוחים ולמסופי מטענים.' },
  subscription_box: { name: 'קופסת מנוי / מכירה ישירה', description: 'מתאים למודלים של משלוח קופסה חוזר ולערכות חודשיות.' },
  construction: { name: 'בנייה וקבלנות', description: 'מתאים לקבלנים, ליזמים ולבעלי מקצוע.' },
  automotive: { name: 'רכב ומוסכים', description: 'מתאים למוסכים, למכוני תיקון ולמכוני דיטיילינג.' },
  renewable_energy: { name: 'אנרגיה מתחדשת', description: 'מתאים למתקיני סולארי, לתפעול מיקרו־רשתות ולניהול אשראי ירוק.' },
  import_export: { name: 'ייבוא / ייצוא', description: 'מתאים לסוחרים בינלאומיים, למתווכים ולשחרור ממכס.' },
  franchise: { name: 'מפעיל זכיינות', description: 'מתאים לזכיינים של מותגי מזון, כושר או קמעונאות.' },
  software_agency: { name: 'סוכנות תוכנה ופיתוח', description: 'מתאים לפיתוח אתרים, למערכות מידע ולעבודות תוכנה בהתאמה.' },
  enterprise_saas: { name: 'SaaS ארגוני (עולמי)', description: 'מתאים לחברות תוכנה עם כמה מוצרים וכמה אזורים.' },
  holding_company: { name: 'חברת החזקות / קונגלומרט', description: 'מתאים למבנים של כמה חברות, לחברות החזקות ולתיקים מגוונים.' },
  manufacturing_multi: { name: 'ייצור והפצה רב־חברתי', description: 'מתאים לשרשראות אספקה מורכבות, לכמה מפעלים ולהפצה עולמית.' },
  private_equity: { name: 'קרן הון סיכון / השקעות', description: 'מתאים לקרנות שמנהלות הון משקיעים, שווי תיק ודמי ניהול.' },
  personal: { name: 'עושר אישי / משק בית', description: 'מתאים למעקב אחר הוצאות אישיות, השקעות ותקציב הבית.' },
};

export function templateNameHe(id: string): string | undefined {
  return TEMPLATE_COPY_HE[id]?.name;
}

export function templateDescriptionHe(id: string): string | undefined {
  return TEMPLATE_COPY_HE[id]?.description;
}

/** The template ids that have Hebrew display copy, so the setup screen can be checked for gaps. */
export function templateCopyIds(): string[] {
  return Object.keys(TEMPLATE_COPY_HE);
}
