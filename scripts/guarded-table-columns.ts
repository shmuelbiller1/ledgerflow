import ts from 'typescript';

/** Structural attributes cannot be forwarded as cellProps. Parse names, so spreads and bare
 * flags (e.g. `<tr hidden>`) are refused too, without mistaking an expression's contents for names. */
export function onlyAttributes(open: string, allowed: readonly string[]): boolean {
  const file = ts.createSourceFile('tag.tsx', open.slice(0, -1) + ' />', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statement = file.statements[0];
  return !!statement && ts.isExpressionStatement(statement) && ts.isJsxSelfClosingElement(statement.expression) &&
    statement.expression.attributes.properties.every(prop => ts.isJsxAttribute(prop) && !!prop.initializer && allowed.includes(prop.name.getText(file)));
}

/** Read an optional column only when it is `flag && <cell>…</cell>` among literal siblings.
 * No evaluation or regex substitution inside JSX. A flag may govern several columns, but
 * each header and its corresponding cell must have exactly the same flag, checked by the caller. */
export function guardedTableColumns(inner: string, header: boolean) {
  if (!inner.includes('&&')) return undefined;
  const file = ts.createSourceFile('row.tsx', `<tr>${inner}</tr>`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statement = file.statements[0];
  if (!statement || !ts.isExpressionStatement(statement) || !ts.isJsxElement(statement.expression)) return undefined;
  const elements: string[] = [];
  const guards: (string | undefined)[] = [];
  for (const child of statement.expression.children) {
    if (ts.isJsxText(child) && !child.text.trim()) continue;
    let cell: ts.Node = child;
    let guard: string | undefined;
    if (ts.isJsxExpression(child)) {
      const expr = child.expression;
      if (!expr || !ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || !ts.isIdentifier(expr.left)) return undefined;
      guard = expr.left.text;
      cell = expr.right;
      while (ts.isParenthesizedExpression(cell)) cell = cell.expression;
    }
    if (!ts.isJsxElement(cell)) return undefined;
    const { tagName, attributes } = cell.openingElement;
    const tag = tagName.getText(file);
    if (tag !== 'th' && (header || tag !== 'td')) return undefined;
    // A spread/flag or a clickable/spanning heading cannot be reproduced by a column spec.
    if (attributes.properties.some(prop => !ts.isJsxAttribute(prop) || !prop.initializer ||
      (header ? !['scope', 'className'].includes(prop.name.getText(file)) :
        !/^(className|scope|dir|lang|title|aria-[\w-]+|data-[\w-]+)$/.test(prop.name.getText(file))))) return undefined;
    const scope = attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'scope');
    if (scope && (!ts.isJsxAttribute(scope) || !scope.initializer || !ts.isStringLiteral(scope.initializer) ||
        tag !== 'th' || scope.initializer.text !== (header ? 'col' : 'row'))) return undefined;
    elements.push(cell.getText(file));
    guards.push(guard);
  }
  return guards.some(Boolean) ? { inner: elements.join('\n'), guards } : undefined;
}
