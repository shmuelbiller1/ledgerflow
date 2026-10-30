/**
 * A request-supplied value made safe to write into a log line: control characters (line breaks above all) become
 * spaces so a caller cannot forge extra log lines, and the value is cut at `max` characters.
 */
const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;

export function logSafe(value: unknown, max = 500): string {
  let out = '';
  for (const ch of String(value ?? '').slice(0, max)) out += isControl(ch.charCodeAt(0)) ? ' ' : ch;
  return out;
}
