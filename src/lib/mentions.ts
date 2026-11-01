/**
 * @mentions (BG-01): writing @dana (the part of their email before the @, or the whole email) in a
 * question about an entry, an answer, or a task tells that person. Only people in the workspace are
 * found, the writer is never told about their own words, and nothing else changes.
 */
const MENTION = /(^|[^\p{L}\p{N}._%+-])@([\p{L}\p{N}._%+-]+(?:@[\p{L}\p{N}.-]+\.[\p{L}]{2,})?)/gu;

export interface Mentionable { uid: string; email?: string }

/** The people named with @ in the text, in the order first named. */
export function mentionedPeople(text: string, people: Mentionable[], writer?: string): string[] {
  const found: string[] = [];
  for (const match of String(text || '').matchAll(MENTION)) {
    const name = match[2].replace(/(?<![.])[.]+$/, '').toLocaleLowerCase();
    const person = people.find(p => {
      const email = (p.email || '').toLocaleLowerCase();
      return Boolean(email) && (email === name || email.split('@')[0] === name);
    });
    if (person && person.uid !== writer && !found.includes(person.uid)) found.push(person.uid);
  }
  return found;
}
