/**
 * Icon Button Accessibility Guard (D-91 / P2-51):
 * Every icon-only button must have an accessible name for screen readers
 * (aria-label, aria-labelledby, title, or sr-only text child).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function walkTsx(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'tests') {
        files.push(...walkTsx(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

export interface ParsedButton {
  attributes: string;
  children: string;
  line: number;
}

/**
 * Parses JSX button elements by properly tracking brace depth `{...}` and quotes
 * so inline arrow functions (e.g. `onClick={() => deleteItem()}`) do not prematurely terminate the tag.
 */
export function parseJsxButtons(code: string): ParsedButton[] {
  const buttons: ParsedButton[] = [];
  const buttonStartRegex = /<button(?=[\s>])/g;
  let match: RegExpExecArray | null;

  while ((match = buttonStartRegex.exec(code)) !== null) {
    const startIndex = match.index;
    const line = code.slice(0, startIndex).split('\n').length;

    let idx = startIndex + '<button'.length;
    let braceDepth = 0;
    let inQuote: string | null = null;
    let tagClosed = false;

    // Scan opening tag until matching '>' at braceDepth === 0 and not in quotes
    while (idx < code.length) {
      const ch = code[idx];

      if (inQuote) {
        if (ch === inQuote && code[idx - 1] !== '\\') {
          inQuote = null;
        }
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inQuote = ch;
      } else if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      } else if (ch === '>' && braceDepth === 0) {
        tagClosed = true;
        break;
      }

      idx++;
    }

    if (!tagClosed) continue;

    const attributes = code.slice(startIndex + '<button'.length, idx).trim();
    const childrenStartIndex = idx + 1;

    // Find closing </button>
    const closeIndex = code.indexOf('</button>', childrenStartIndex);
    if (closeIndex === -1) continue;

    const children = code.slice(childrenStartIndex, closeIndex).trim();
    buttons.push({ attributes, children, line });
  }

  return buttons;
}

/**
 * Checks whether a button is an icon-only button and lacks an accessible name.
 */
export function isUnlabeledIconButton(btn: ParsedButton): boolean {
  const hasAriaName =
    btn.attributes.includes('aria-label') ||
    btn.attributes.includes('aria-labelledby') ||
    btn.attributes.includes('title=');

  if (hasAriaName) return false;

  // If the button has an sr-only element, it has an accessible name
  if (btn.children.includes('sr-only')) return false;

  // Strip JSX icon tags e.g. <Trash2 ... />, <Plus ... />, <X className="..." />
  const withoutIcons = btn.children
    .replace(/<[A-Z][a-zA-Z0-9]*(?:Icon)?\b[^>]*\/>/g, '')
    .replace(/<[A-Z][a-zA-Z0-9]*(?:Icon)?\b[^>]*>[\s\S]*?<\/[A-Z][a-zA-Z0-9]*(?:Icon)?>/g, '')
    // Strip empty HTML wrappers e.g. <span className="..."></span>
    .replace(/<span\b[^>]*>\s*<\/span>/g, '')
    .replace(/<div\b[^>]*>\s*<\/div>/g, '')
    .trim();

  // If there is nothing left after stripping icons and empty wrappers, it is strictly an icon-only button
  if (withoutIcons.length === 0) {
    return true;
  }

  // If remaining content contains letters/words/Hebrew/expressions e.g. "Save", "{label}", "{title}"
  const hasRemainingTextOrExpression = /[a-zA-Z0-9\u0590-\u05FF]/.test(withoutIcons);
  if (hasRemainingTextOrExpression) {
    return false;
  }

  return true;
}

describe('Icon Button Accessibility Guard (D-91)', () => {
  const componentsDir = path.join(process.cwd(), 'src/components');
  const files = walkTsx(componentsDir);

  it('rejects an unlabeled icon button even with inline arrow function handlers (negative test fixture)', () => {
    const sampleWithArrowHandler = `<button type="button" onClick={() => removeItem(id)} className="p-1"><Trash2 className="w-4 h-4" /></button>`;
    const parsed = parseJsxButtons(sampleWithArrowHandler);
    assert.equal(parsed.length, 1);
    assert.equal(isUnlabeledIconButton(parsed[0]), true, 'Must correctly identify unlabeled icon button with inline arrow handler');

    const sampleWithAriaLabel = `<button type="button" onClick={() => removeItem(id)} aria-label="Delete item" className="p-1"><Trash2 className="w-4 h-4" /></button>`;
    const parsedValid = parseJsxButtons(sampleWithAriaLabel);
    assert.equal(parsedValid.length, 1);
    assert.equal(isUnlabeledIconButton(parsedValid[0]), false, 'Must accept icon button with aria-label');

    const sampleWithAriaDescribedByOnly = `<button type="button" onClick={() => removeItem(id)} aria-describedby="tooltip-1" className="p-1"><Trash2 className="w-4 h-4" /></button>`;
    const parsedDescribedBy = parseJsxButtons(sampleWithAriaDescribedByOnly);
    assert.equal(parsedDescribedBy.length, 1);
    assert.equal(isUnlabeledIconButton(parsedDescribedBy[0]), true, 'Must reject icon button having only aria-describedby without an accessible name');

    const sampleWithText = `<button type="button" onClick={() => removeItem(id)} className="p-1"><Trash2 className="w-4 h-4" /> Delete</button>`;
    const parsedText = parseJsxButtons(sampleWithText);
    assert.equal(parsedText.length, 1);
    assert.equal(isUnlabeledIconButton(parsedText[0]), false, 'Must accept button with visible text');
  });

  it('scans all React components and verifies icon-only buttons provide accessible names', () => {
    assert.ok(files.length > 50, 'Should find component files in src/components');

    const unlabeledButtons: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const buttons = parseJsxButtons(content);

      for (const btn of buttons) {
        if (isUnlabeledIconButton(btn)) {
          const relPath = path.relative(process.cwd(), file);
          unlabeledButtons.push({
            file: relPath,
            line: btn.line,
            snippet: `<button ${btn.attributes}>${btn.children.slice(0, 40)}...</button>`,
          });
        }
      }
    }

    assert.equal(
      unlabeledButtons.length,
      0,
      `Found unlabeled icon buttons without aria-label or title: \n${unlabeledButtons.map(u => `  ${u.file}:${u.line} -> ${u.snippet}`).join('\n')}`,
    );
  });
});
