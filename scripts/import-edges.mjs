/** Literal module references in JS/TS source, excluding comments and strings that only look like imports. */
import ts from 'typescript';

export function importEdges(file, text) {
  const kind = /\.[jt]sx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const edges = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      edges.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
      const target = node.expression;
      if (target.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isPropertyAccessExpression(target) && target.name.text === 'glob' && ts.isMetaProperty(target.expression) && target.expression.keywordToken === ts.SyntaxKind.ImportKeyword)) {
        edges.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return edges;
}
