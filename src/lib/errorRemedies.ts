/**
 * Errors that say what to do (BO-07): the common causes of a failed save or load, in plain words,
 * each with the remedy. The technical message stays in the console for support.
 *
 * AI12-N3: the same sentences in Hebrew, so a person reading the app in Hebrew is told what happened
 * and what to do in the language they chose. Nothing about *which* refusal is which changed: the rules
 * and their order are the ones that already existed. The refusal's own words — an amount, a formula,
 * a field name — stay exactly as the server wrote them and are isolated inside the sentence.
 */
export interface DescribedError { title: string; remedy: string }

const VERB: Record<string, string> = { create: 'saving', update: 'saving the changes', delete: 'deleting', list: 'loading', get: 'loading', write: 'saving' };
const VERB_HE: Record<string, string> = { create: 'שמירה', update: 'שמירת השינויים', delete: 'מחיקה', list: 'טעינה', get: 'טעינה', write: 'שמירה' };

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error ?? '');
}

/** U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE: keeps a server-written value's own reading order. */
const isolate = (value: string) => `\u2068${value}\u2069`;

/**
 * Which rule a refusal falls under. `null` means "none of the known causes", and the caller says so in
 * plain words with the operation it was doing.
 */
export type ErrorRemedyRule =
  | 'fieldNotAllowed'
  | 'lockedPeriod'
  | 'sessionEnded'
  | 'permission'
  | 'unreachable'
  | 'alreadyExists'
  | 'gone'
  | 'otherWorkspace'
  | 'unbalanced'
  | 'invalid';

/** The rules, in the order they are tried. Each entry is the pattern and the id it stands for. */
const RULES: ReadonlyArray<{ id: ErrorRemedyRule; test: RegExp }> = [
  { id: 'fieldNotAllowed', test: /field ".*" is not allowed|is not allowed on/ },
  { id: 'lockedPeriod', test: /lock(ed)? (date|period)|period is (locked|closed)|closed period|this period is locked|on or before the lock/ },
  { id: 'sessionEnded', test: /sign in required|unauthenticated|jwt|session (has )?expired|not signed in|\b401\b/ },
  { id: 'permission', test: /permission denied|row-level security|forbidden|requires (owner|an? )|not a member|insufficient|\b403\b|42501/ },
  { id: 'unreachable', test: /failed to fetch|networkerror|network request|offline|timed? ?out|econn|load failed/ },
  { id: 'alreadyExists', test: /duplicate key|already exists|23505|unique constraint/ },
  { id: 'gone', test: /not found|p0002|\b404\b|no longer exists/ },
  // AI12-N3: the workspace-scoped routes refuse a row from another workspace with their own sentence; it is
  // not a missing row and not a permission problem, so it gets the one instruction that ends it.
  { id: 'otherWorkspace', test: /not in the selected workspace|workspace mismatch|belongs to a different workspace/ },
  { id: 'unbalanced', test: /unbalanced|does not balance|debits.*credits/ },
  { id: 'invalid', test: /invalid|validation|must be|required|check constraint|zod/ },
];

/** The rule a refusal matches, or `null` when none of the known causes explains it. */
export function classifyError(error: unknown): ErrorRemedyRule | null {
  const m = errorMessage(error).toLowerCase();
  return RULES.find(rule => rule.test.test(m))?.id ?? null;
}

const ENGLISH: Record<ErrorRemedyRule, DescribedError> = {
  fieldNotAllowed: {
    title: "This change couldn't be saved",
    remedy: "The app sent a detail the database doesn't accept. Please report it (Help → Support) with what you were doing.",
  },
  lockedPeriod: {
    title: 'That date is in a closed period',
    remedy: 'Use a date after the lock date, or ask an owner to reopen the period (Month-End Close).',
  },
  sessionEnded: {
    title: 'Your session ended',
    remedy: 'Sign in again. What you were doing on this screen was not saved.',
  },
  permission: {
    title: "You don't have permission to do this",
    remedy: 'Ask an owner of this workspace to change your role (Settings → Team).',
  },
  unreachable: {
    title: "Can't reach the server",
    remedy: 'Check your internet connection, then try again.',
  },
  alreadyExists: {
    title: 'This already exists',
    remedy: 'Use a different number or name, or open the existing one.',
  },
  gone: {
    title: 'It no longer exists',
    remedy: 'Someone may have deleted it. Refresh the list and try again.',
  },
  otherWorkspace: {
    title: 'This belongs to another workspace',
    remedy: 'Switch to that workspace (the workspace menu at the top) and open it there.',
  },
  unbalanced: {
    title: "The entry doesn't balance",
    remedy: 'Make the debits equal the credits, then save again.',
  },
  invalid: {
    // the refusal's own words are the useful part, so they are kept and quoted
    title: 'Some details aren’t valid',
    remedy: 'Correct it and try again.',
  },
};

const HEBREW: Record<ErrorRemedyRule, DescribedError> = {
  fieldNotAllowed: {
    title: 'לא הצלחנו לשמור את השינוי',
    remedy: 'האפליקציה שלחה פרט שהמסד לא מקבל. אפשר לדווח על כך (עזרה ← תמיכה) ולציין מה ניסיתם לעשות.',
  },
  lockedPeriod: {
    title: 'התאריך נמצא בתקופה סגורה',
    remedy: 'אפשר להשתמש בתאריך אחרי תאריך הנעילה, או לבקש מבעל העסק לפתוח את התקופה מחדש (סגירת חודש).',
  },
  sessionEnded: {
    title: 'פג תוקף החיבור',
    remedy: 'יש להתחבר שוב. מה שעשיתם במסך הזה לא נשמר.',
  },
  permission: {
    title: 'אין לכם הרשאה לפעולה הזו',
    remedy: 'אפשר לבקש מבעל העסק לשנות את התפקיד שלכם (הגדרות ← צוות).',
  },
  unreachable: {
    title: 'לא מצליחים להגיע לשרת',
    remedy: 'אפשר לבדוק את החיבור לאינטרנט ולנסות שוב.',
  },
  alreadyExists: {
    title: 'הרשומה הזו כבר קיימת',
    remedy: 'אפשר להשתמש במספר או בשם אחרים, או לפתוח את הרשומה הקיימת.',
  },
  gone: {
    title: 'הרשומה כבר לא קיימת',
    remedy: 'ייתכן שמישהו מחק אותה. אפשר לרענן את הרשימה ולנסות שוב.',
  },
  otherWorkspace: {
    title: 'הרשומה שייכת לסביבת עבודה אחרת',
    remedy: 'אפשר לעבור לסביבת העבודה הזו (בתפריט סביבות העבודה למעלה) ולפתוח אותה שם.',
  },
  unbalanced: {
    title: 'הפקודה אינה מאוזנת',
    remedy: 'אפשר לתקן כך שהחיובים יהיו שווים לזיכויים ולשמור שוב.',
  },
  invalid: {
    title: 'חלק מהפרטים אינם תקינים',
    remedy: 'אפשר לתקן ולנסות שוב.',
  },
};

const UNKNOWN_EN: DescribedError = {
  title: 'Something went wrong',
  remedy: 'Try again. If it keeps happening, report it (Help → Support).',
};
const UNKNOWN_HE: DescribedError = {
  title: 'משהו השתבש',
  remedy: 'אפשר לנסות שוב. אם זה ממשיך, אפשר לדווח על כך (עזרה ← תמיכה).',
};

/**
 * The sentence pair for a refusal.
 *
 * `language` is optional so that every caller written before this change keeps the English it showed.
 * A caller that knows the selected language passes it and the same refusal is explained in Hebrew.
 */
export function describeError(error: unknown, operation?: string, language: 'en' | 'he' = 'en'): DescribedError {
  const isHe = language === 'he';
  const rule = classifyError(error);
  if (!rule) {
    const key = operation?.toLowerCase() ?? '';
    if (isHe) {
      const doing = VERB_HE[key];
      return doing ? { title: `משהו השתבש ב${doing}`, remedy: UNKNOWN_HE.remedy } : { ...UNKNOWN_HE };
    }
    const doing = VERB[key];
    return doing ? { title: `Something went wrong while ${doing}`, remedy: UNKNOWN_EN.remedy } : { ...UNKNOWN_EN };
  }
  const described = (isHe ? HEBREW : ENGLISH)[rule];
  if (rule !== 'invalid') return { ...described };
  // Invalid: the server's own words are the instruction, so they are quoted as written (isolated for direction).
  const detail = isolate(errorMessage(error).slice(0, 140));
  return isHe
    ? { title: described.title, remedy: `${detail} — ${described.remedy}` }
    : { title: described.title, remedy: `${errorMessage(error).slice(0, 140)}. ${described.remedy}` };
}

/** Every rule a refusal can fall under, for tests and for a screen that lists the common causes. */
export function errorRemedyRules(): ErrorRemedyRule[] {
  return RULES.map(rule => rule.id);
}
