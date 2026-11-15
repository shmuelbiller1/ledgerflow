import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

/**
 * The unit tests a documentation-only pull request must still run (`.github/workflows/ci.yml`, job
 * `docs_checks`).
 *
 * Before this, the workflow pasted a text search into its shell:
 *
 *   grep -lE "docs/|[A-Za-z_]+\.md" src/tests/*.test.ts ...
 *
 * which has two failures a green run cannot show:
 *
 *   - it selected files that only mention a doc in a comment. Measured 15 Nov 2026: 18 files
 *     selected, 11 of them (all the `LF_TEST_DATABASE_URL` suites and `theme-contrast-pairs`)
 *     read no doc at all and contributed no assertion;
 *   - it missed a file that names the folder instead of the path — `fs.readFileSync(path.join(
 *     'docs', 'TRACKER.md'))` — so a doc change could break a test that the docs-only runner never
 *     started, and the pull request merged green.
 *
 * The selection is therefore made from the parsed source: string literals only (comments are not
 * literals), then either a path into the `docs/` or `audit/` tree, or a `*.md`/`*.txt`/`*.rst`
 * name that resolves to a file in the repository.
 */

export const UNIT_TEST_DIRS = ['src/tests', 'src/lib', 'src/server/utils'];
/**
 * This file needs a running database and asserts on the database, not on a document. The docs-only
 * runner has no PostgreSQL service, so it is named here rather than left to the text search. (It
 * fails on CI when the database is missing, which is the behaviour we want on the full runners.)
 */
export const EXCLUDED = ['src/tests/database-tests-notice.test.ts'];

// Anchored: `/api/v1/audit/jobs/...` is a route, not a document.
// Case-sensitive: the folders are `docs/` and `audit/`; a UI label like "Audit" is not a path.
const DOC_TREE = /^(?:\.{1,2}\/)*(?:docs|audit)(?:\/|$)/;
// Only prose extensions count by file name; a `.json`/`.csv` is documentation only inside the
// `docs/` or `audit/` tree above (`quality-baseline.json` at the root is not a document).
const DOC_FILE = /\.(?:md|mdx|txt|rst)$/i;

/** Literal strings in a JS/TS file; comments and regular expressions are not literals. */
export function stringLiterals(file, text) {
  const kind = /\.[jt]sx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const literals = [];
  const visit = node => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.push(node.text);
    // `docs/help/${slug}.md` keeps only the head, which still names the documentation tree.
    else if (ts.isTemplateExpression(node)) literals.push(node.head.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals;
}

export function referencesDocumentation(file, text, root = process.cwd()) {
  return stringLiterals(file, text).some(literal => {
    const clean = literal.split('?')[0].split('#')[0].replace(/\\/g, '/');
    if (!clean) return false;
    if (DOC_TREE.test(clean)) return true;
    if (!DOC_FILE.test(clean)) return false;
    // A root-relative or file-relative name that exists: `CURRENT_WORK.md`, `src/AGENTS.md`.
    return fs.existsSync(path.resolve(root, path.dirname(file), clean))
      || fs.existsSync(path.resolve(root, clean));
  });
}

/** Sorted repository paths of the unit tests that read a document. */
export function docReadingTests(root = process.cwd(), dirs = UNIT_TEST_DIRS) {
  const files = dirs.flatMap(dir => fs.readdirSync(path.resolve(root, dir))
    .filter(name => /\.test\.tsx?$/.test(name))
    .map(name => `${dir}/${name}`))
    .sort();
  return files.filter(file => !EXCLUDED.includes(file)
    && referencesDocumentation(file, fs.readFileSync(path.resolve(root, file), 'utf8'), root));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tests = docReadingTests();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(tests) + '\n');
  } else {
    if (!tests.length) {
      console.error('No unit test reads a document; refusing to report an empty docs-only run.');
      process.exit(1);
    }
    process.stdout.write(tests.join('\n') + '\n');
  }
}
