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
  const re = /(\d+) 0 obj\s*([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[2];
    const s = body.indexOf('stream');
    if (s === -1) { out.set(Number(m[1]), { dict: body }); continue; }
    const dict = body.slice(0, s);
    const start = s + 'stream'.length + (body[s + 6] === '\r' ? 2 : 1);
    const end = body.lastIndexOf('endstream');
    let raw = Buffer.from(body.slice(start, end), 'latin1');
    if (/\/FlateDecode/.test(dict)) {
      try { raw = zlib.inflateSync(raw); } catch { raw = zlib.inflateSync(raw.subarray(0, raw.length - 1)); }
    }
    out.set(Number(m[1]), { dict, stream: raw });
  }
  return out;
}

const utf16 = (hex: string) => {
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return s;
};

function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const line of block.split('\n')) {
      const arr = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/);
      if (arr) {
        const first = parseInt(arr[1], 16);
        (arr[3].match(/<([0-9a-fA-F]+)>/g) || []).forEach((h, i) => map.set(first + i, utf16(h.slice(1, -1))));
        continue;
      }
      const seq = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (seq) {
        const [a, b, dst] = [parseInt(seq[1], 16), parseInt(seq[2], 16), parseInt(seq[3], 16)];
        for (let g = a; g <= b; g++) map.set(g, String.fromCharCode(dst + g - a));
      }
    }
  }
  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const pair of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(pair[1], 16), utf16(pair[2]));
  }
  return map;
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
    for (const op of content.matchAll(/\/(F\d+)\s+[-\d.]+\s+Tf|\[((?:\((?:\\[\s\S]|[^\\()])*\)|[^\]])*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\((?:\\[\s\S]|[^\\()])*\))\s*Tj/g)) {
      if (op[1]) { font = fontMaps.get(op[1]); continue; }
      const encoded = op[2] !== undefined ? [...op[2].matchAll(strings)].map(match => match[0]) : [op[3]];
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
    if (/^[0-7]/.test(value)) return String.fromCharCode(parseInt(value, 8));
    if (/^[\r\n]/.test(value)) return '';
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[value] ?? value;
  });
  return Buffer.from(chars, 'latin1');
}

/** All the text, words separated by spaces. */
export const pdfText = (pdf: Buffer) => pdfTextRuns(pdf).join(' ');

/** How many pages the PDF has. */
export const pdfPageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
