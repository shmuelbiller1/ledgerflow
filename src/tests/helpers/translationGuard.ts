/**
 * EU-G1: one check for every translated screen. Reads the component's TypeScript AST and reports
 * visible English that does not go through the screen's text helper, and helper calls whose key
 * has no EN/HE entry (or whose English fallback differs from the table).
 */
import fs from 'node:fs';
import ts from 'typescript';
import { SCREEN_TRANSLATION_TABLE, type TranslatedScreenId } from '../../lib/i18n/screenTranslations';

/** Props whose value a person reads or hears. */
const VISIBLE_PROPS = new Set(['aria-label', 'title', 'description', 'label', 'placeholder', 'alt']);
const hasLetters = (text: string) => /[A-Za-z]/.test(text);

export interface TranslationReport {
  /** `line: text` for every visible English literal not routed through the helper. */
  untranslated: string[];
  /** `key: problem` for helper calls that the table cannot answer. */
  badKeys: string[];
  /** Number of helper calls found. */
  calls: number;
}

export function checkTranslatedScreen(
  file: string, screenId: TranslatedScreenId, helper: string,
  /** Which props count as visible; a screen not yet fully done can start from ['aria-label']. */
  visibleProps: ReadonlySet<string> = VISIBLE_PROPS,
  /** Whether strings written into the markup ({'Sync Feed'}) are checked. */
  checkMarkupStrings = true,
): TranslationReport {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bundle = SCREEN_TRANSLATION_TABLE.find(b => b.screenId === screenId);
  const untranslated: string[] = [];
  const badKeys: string[] = [];
  let calls = 0;
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const insideHelper = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isCallExpression(n) && n.expression.getText(source) === helper) return true;
      if (ts.isJsxAttribute(n) || ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) return false;
    }
    return false;
  };
  const stringOf = (node: ts.Node): string | null =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text
      : ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join(' ') : null;
  const flag = (node: ts.Node, text: string) => untranslated.push(`${lineOf(node)}: ${text.replace(/\s+/g, ' ').trim()}`);

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && /[\p{L}\p{N}]/u.test(node.getText(source))) flag(node, node.getText(source));
    // a string written straight into the markup: {'Sync Feed'} or {busy ? 'Syncing...' : 'Sync Feed'}
    if (checkMarkupStrings && ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && node.expression) {
      const scan = (e: ts.Node): void => {
        const text = stringOf(e);
        if (text !== null) { if (hasLetters(text) && !insideHelper(e)) flag(e, text); return; }
        if (ts.isConditionalExpression(e)) { scan(e.whenTrue); scan(e.whenFalse); }
        else if (ts.isBinaryExpression(e) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) { scan(e.left); scan(e.right); }
        else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) scan(e.right);
        else if (ts.isParenthesizedExpression(e)) scan(e.expression);
      };
      scan(node.expression);
    }
    if (ts.isJsxAttribute(node) && visibleProps.has(node.name.getText(source)) && node.initializer) {
      const init = node.initializer;
      const value = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) ? init.expression : undefined;
      const text = value ? stringOf(value) : null;
      if (value && text !== null && hasLetters(text) && !insideHelper(value)) flag(value, `${node.name.getText(source)}=${text}`);
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === helper) {
      calls++;
      const [keyArg, fallbackArg] = node.arguments;
      const key = keyArg && ts.isStringLiteral(keyArg) ? keyArg.text : null;
      const fallback = fallbackArg && ts.isStringLiteral(fallbackArg) ? fallbackArg.text : null;
      const entry = key ? bundle?.strings.find(s => s.key === key) : undefined;
      if (key === null || fallback === null) badKeys.push(`${lineOf(node)}: ${helper} needs literal key and fallback`);
      else if (!entry) badKeys.push(`${key}: no dictionary entry`);
      else if (entry.en !== fallback) badKeys.push(`${key}: fallback "${fallback}" differs from "${entry.en}"`);
      else if (!/[֐-׿]/.test(entry.he)) badKeys.push(`${key}: no Hebrew`);
      return; // the fallback text inside the call is the translated text itself
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { untranslated, badKeys, calls };
}
