/**
 * AI #10 — a stored file's address is untrusted input (issue #915).
 *
 * `documents` rows are writable by every workspace member (including a viewer), so `fileUrl` can be
 * anything: `javascript:`, a `data:text/html` page, an `http:` tracker, a session-scoped `blob:`,
 * or a value that is not a URL at all. The screens that paint or fetch it (Documents/Vault, the
 * item image, the attachments panel) must narrow it first — these tests pin the rule and the call
 * sites, so a new `<img src={file.fileUrl}>` cannot quietly come back.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safeDownloadDocumentUrl, safeEmbeddedDocumentUrl, EMBEDDABLE_DATA_TYPES } from '../lib/documentUrl';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const WEBP = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4';

describe('safeEmbeddedDocumentUrl — what a preview, an <img> or a fetch may use', () => {
  it('accepts the four stored formats the upload paths write', () => {
    for (const url of [PDF, PNG, JPEG, WEBP]) assert.equal(safeEmbeddedDocumentUrl(url), url, url.slice(0, 40));
    assert.deepEqual([...EMBEDDABLE_DATA_TYPES].sort(), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  });

  it('accepts an https link and trims surrounding whitespace', () => {
    const link = 'https://files.example.com/invoice-12.pdf';
    assert.equal(safeEmbeddedDocumentUrl(link), link);
    assert.equal(safeEmbeddedDocumentUrl(`  ${link}  `), link);
    assert.equal(safeEmbeddedDocumentUrl(` ${PDF} `), PDF);
  });

  it('refuses scripts, markup and every other scheme', () => {
    const refused = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:text/html,<script>alert(1)</script>',
      'data:application/pdf,not-base64-payload',
      'data:application/pdf;base64,',
      'blob:https://app.example.com/1234',
      'http://files.example.com/invoice.pdf',
      'file:///etc/passwd',
      '//evil.example.com/x.png',
      '#anchor',
      '',
      '   ',
    ];
    for (const value of refused) assert.equal(safeEmbeddedDocumentUrl(value), null, value);
  });

  it('refuses a non-string or a missing value', () => {
    for (const value of [undefined, null, 42, {}, ['data:application/pdf;base64,AA=='], true]) {
      assert.equal(safeEmbeddedDocumentUrl(value), null, String(value));
    }
  });
});

describe('safeDownloadDocumentUrl — what an open/download link may use', () => {
  it('accepts a base64 file of a non-executable type and an https link', () => {
    const csv = 'data:text/csv;base64,YW1vdW50CjEwMAo=';
    const docx = 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBBQ=';
    assert.equal(safeDownloadDocumentUrl(csv), csv);
    assert.equal(safeDownloadDocumentUrl(docx), docx);
    assert.equal(safeDownloadDocumentUrl(PDF), PDF);
    assert.equal(safeDownloadDocumentUrl('https://files.example.com/x.xlsx'), 'https://files.example.com/x.xlsx');
  });

  it('refuses pages a browser can run and everything outside data:/https:', () => {
    const refused = [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:application/xhtml+xml;base64,PHNjcmlwdC8+',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:application/javascript;base64,YWxlcnQoMSk=',
      'data:text/plain,hello',
      'http://files.example.com/x.csv',
      'blob:https://app.example.com/1234',
      'ftp://files.example.com/x.csv',
      '',
      null,
      undefined,
    ];
    for (const value of refused) assert.equal(safeDownloadDocumentUrl(value), null, String(value));
  });
});

describe('the screens that paint a stored file use the shared rule', () => {
  const screens = {
    'src/components/forensics/Vault.tsx': [
      // the image preview, both open links and the OCR fetch
      /\{embedUrl && selectedDoc\.mimeType\.startsWith/,
          /src=\{embedUrl\}/,
      /href=\{downloadUrl\}/,
      /const response = await fetch\(sourceUrl\);/,
    ],
    'src/components/inventory/ItemImagePanel.tsx': [
      /safeEmbeddedDocumentUrl\(image\.fileUrl\)/,
    ],
    'src/components/common/AttachmentsPanel.tsx': [
      /safeDownloadDocumentUrl\(file\.fileUrl\)/,
    ],
    'src/components/forensics/DocumentEntanglement.tsx': [
      /safeEmbeddedDocumentUrl\(receiptUrl\)/,
      /src=\{safeReceiptUrl\}/,
    ],
    'src/components/transactions/TransactionEditModalView.tsx': [
      /safeEmbeddedDocumentUrl\(url\)/,
      /src=\{safeImageSrc\}/,
    ],
  };

  for (const [file, patterns] of Object.entries(screens)) {
    it(`${file} narrows the address before using it`, () => {
      const source = read(file);
      assert.match(source, /from '(\.\.\/)+lib\/documentUrl'/, `${file} must import the shared rule`);
      for (const pattern of patterns) assert.match(source, pattern, `${file} is missing ${pattern}`);
    });
  }

  it('no component paints a raw stored fileUrl or receiptUrl into src or href', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(full);
      }
    };
    walk(path.join(root, 'src/components'));
    const offenders = files.filter(file => /(src|href)=\{[^}]*((\.|\.\?\.)fileUrl|receiptUrl)\}/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(root, file));
    assert.deepEqual(offenders, [], `these components paint an unchecked fileUrl/receiptUrl: ${offenders.join(', ')}`);
  });
});
