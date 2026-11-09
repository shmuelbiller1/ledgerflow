/**
 * Reads PDFKit and Chromium PDF text for tests: content streams are inflated, literal/hex strings
 * decoded with each font's codespace and ToUnicode table (simple WinAnsi fonts also work). Returns the text
 * runs in drawing order (one per word, as the PDF draws words one by one); right-to-left words come
 * out in display order, so tests compare them reversed.
 */
import zlib from 'node:zlib';

interface PdfObject { dict: string; stream?: Buffer }
interface PdfFont { glyphs?: Map<number, string>; bytes: number }

function objects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const out = new Map<number, PdfObject>();
  // Search each object marker once; retrying a greedy digit run at every digit is quadratic
  // on a malformed PDF containing a long number with no object marker.
  let cursor = 0;
  for (;;) {
    const marker = text.indexOf(' 0 obj', cursor);
    if (marker < 0) break;
    let idStart = marker;
    while (idStart > cursor && text[idStart - 1] >= '0' && text[idStart - 1] <= '9') idStart--;
    if (idStart === marker) { cursor = marker + 6; continue; }
    const objectId = Number(text.slice(idStart, marker));
    let bodyStart = marker + 6;
    while (bodyStart < text.length && /\s/.test(text[bodyStart])) bodyStart++;
    const endObject = text.indexOf('endobj', bodyStart);
    if (endObject < 0) break;
    const body = text.slice(bodyStart, endObject);
    cursor = endObject + 6;
    const s = body.indexOf('stream');
    if (s === -1) { out.set(objectId, { dict: body }); continue; }
    const dict = body.slice(0, s);
    const start = s + 'stream'.length + (body[s + 6] === '\r' ? 2 : 1);
    const end = body.lastIndexOf('endstream');
    let raw = Buffer.from(body.slice(start, end), 'latin1');
    if (/\/FlateDecode/.test(dict)) {
      try { raw = zlib.inflateSync(raw); } catch { raw = zlib.inflateSync(raw.subarray(0, raw.length - 1)); }
    }
    out.set(objectId, { dict, stream: raw });
  }
  return out;
}

const utf16 = (hex: string) => {
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  return s;
};

function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const line of block.split('\n')) {
      const arr = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/);
      if (arr) {
        const first = Number.parseInt(arr[1], 16);
        (arr[3].match(/<([0-9a-fA-F]+)>/g) || []).forEach((h, i) => map.set(first + i, utf16(h.slice(1, -1))));
        continue;
      }
      const seq = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (seq) {
        const [a, b, dst] = [Number.parseInt(seq[1], 16), Number.parseInt(seq[2], 16), Number.parseInt(seq[3], 16)];
        for (let g = a; g <= b; g++) map.set(g, String.fromCharCode(dst + g - a));
      }
    }
  }
  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const pair of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(Number.parseInt(pair[1], 16), utf16(pair[2]));
  }
  return map;
}

/** Scan the content operators used by this test helper without retrying a long
 * unterminated array/string at every opening delimiter. This is not a complete PDF parser. */
export function pdfTextOperators(content: string): Array<{ font?: string; array?: string; scalar?: string }> {
  const n = content.length;
  const nextNonSpace = new Int32Array(n + 1);
  const literalEnd = new Int32Array(n + 2).fill(-1);
  const hexEnd = new Int32Array(n + 1).fill(-1);
  const arrayClose = new Int32Array(n + 1).fill(-1);
  nextNonSpace[n] = n;
  // Each table gives the end of a valid suffix in constant time. LiteralEnd
  // describes the inside of a literal, while arrayClose describes array contents.
  for (let i = n - 1; i >= 0; i--) {
    const c = content[i];
    nextNonSpace[i] = /\s/.test(c) ? nextNonSpace[i + 1] : i;
    literalEnd[i] = c === ')' ? i + 1 : c === '(' ? -1
      : c === '\\' ? (i + 1 < n ? literalEnd[i + 2] : -1) : literalEnd[i + 1];
    hexEnd[i] = c === '>' ? i + 1 : /[0-9a-fA-F\s]/.test(c) ? hexEnd[i + 1] : -1;
    if (c === ']') {
      const op = nextNonSpace[i + 1];
      arrayClose[i] = content.startsWith('TJ', op) ? i : -1;
    } else if (c === '(') {
      const end = literalEnd[i + 1];
      arrayClose[i] = end < 0 ? -1 : arrayClose[end];
    } else {
      arrayClose[i] = c === ')' ? -1 : arrayClose[i + 1];
    }
  }
  const result: Array<{ font?: string; array?: string; scalar?: string }> = [];
  const font = /\/(F\d+)\s+[-\d.]+\s+Tf/y;
  for (let i = 0; i < n;) {
    if (content[i] === '/') {
      font.lastIndex = i;
      const match = font.exec(content);
      if (match) { result.push({ font: match[1] }); i = font.lastIndex; continue; }
    }
    if (content[i] === '[') {
      const close = arrayClose[i + 1];
      if (close >= 0) {
        result.push({ array: content.slice(i + 1, close) });
        i = nextNonSpace[close + 1] + 2;
        continue;
      }
    }
    if (content[i] === '<' || content[i] === '(') {
      const end = content[i] === '<' ? hexEnd[i + 1] : literalEnd[i + 1];
      if (end >= 0) {
        const op = nextNonSpace[end];
        if (content.startsWith('Tj', op)) {
          result.push({ scalar: content.slice(i, end) });
          i = op + 2;
          continue;
        }
      }
    }
    i++;
  }
  return result;
}

export function pdfTextRuns(pdf: Buffer): string[] {
  const objs = objects(pdf);
  // font resource name (F1, F2…) → glyph map
  const fontMaps = new Map<string, PdfFont>();
  for (const obj of objs.values()) {
    for (const ref of obj.dict.matchAll(/\/(F\d+)\s+(\d+) 0 R/g)) {
      const font = objs.get(Number(ref[2]));
      const toUnicode = font?.dict.match(/\/ToUnicode (\d+) 0 R/);
      const cmap = toUnicode ? objs.get(Number(toUnicode[1]))?.stream : undefined;
      const cmapText = cmap?.toString('latin1');
      const codeSpace = cmapText?.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
      fontMaps.set(ref[1], {
        glyphs: cmapText ? parseCmap(cmapText) : undefined,
        bytes: codeSpace ? codeSpace[1].length / 2 : /\/Subtype\s*\/Type0\b/.test(font?.dict || '') ? 2 : 1,
      });
    }
  }
  const runs: string[] = [];
  for (const obj of objs.values()) {
    const content = obj.stream?.toString('latin1');
    if (!content || !/ Tf\b/.test(content)) continue;
    let font: PdfFont | undefined;
    // Chromium may write simple-font ASCII as literal strings, while Hebrew is
    // encoded using a composite font's hex glyphs. Both are valid text operators.
    const strings = /<[0-9a-fA-F\s]*>|\((?:\\[\s\S]|[^\\()])*\)/g;
    for (const op of pdfTextOperators(content)) {
      if (op.font) { font = fontMaps.get(op.font); continue; }
      const encoded = op.array !== undefined ? [...op.array.matchAll(strings)].map(match => match[0]) : [op.scalar!];
      let run = '';
      for (const token of encoded) {
        const raw = token.startsWith('<') ? Buffer.from(token.slice(1, -1).replace(/\s/g, ''), 'hex') : literalBytes(token);
        if (!font?.glyphs) { run += new TextDecoder('windows-1252').decode(raw); continue; }
        for (let i = 0; i + font.bytes <= raw.length; i += font.bytes) {
          run += font.glyphs.get(raw.readUIntBE(i, font.bytes)) ?? '?';
        }
      }
      if (run) runs.push(run);
    }
  }
  return runs;
}

/** PDF literal strings escape delimiters, octal bytes and continued lines. */
function literalBytes(token: string): Buffer {
  const chars = token.slice(1, -1).replace(/\\(?:\r\n|[\r\n]|[0-7]{1,3}|[\s\S])/g, escape => {
    const value = escape.slice(1);
    if (/^[0-7]/.test(value)) return String.fromCharCode(Number.parseInt(value, 8));
    if (/^[\r\n]/.test(value)) return '';
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[value] ?? value;
  });
  return Buffer.from(chars, 'latin1');
}

/** All the text, words separated by spaces. */
export const pdfText = (pdf: Buffer) => pdfTextRuns(pdf).join(' ');

/** How many pages the PDF has. */
export const pdfPageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
