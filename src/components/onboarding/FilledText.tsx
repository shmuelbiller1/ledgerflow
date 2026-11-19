import { Fragment, type ReactNode } from 'react';

/**
 * AI12-N10-01 (#838): fills `{name}` placeholders in a translated sentence and keeps each value in
 * its own direction box, so a value the person typed — a business name, an account name, an email
 * address — or a number next to punctuation cannot reorder the words around it.
 *
 * `<bdi>` is used rather than invisible isolate characters inside a string: the element carries the
 * isolation, so the sentence's text is exactly the sentence (a screen reader, a find-in-page search
 * and a test all read "4 of 5 steps complete").
 */
export function FilledText({
  template,
  values,
}: {
  template: string;
  values: Readonly<Record<string, ReactNode>>;
}) {
  // A template repeats a value at most a few times, so the value name plus how many times it has been
  // seen is a stable key: it does not depend on where the part happens to land in the sentence.
  const seen = new Map<string, number>();
  const parts = template.split(/(\{\w+\})/g).filter(part => part !== '');
  return (
    <>
      {parts.map(part => {
        const occurrences = (seen.get(part) ?? 0) + 1;
        seen.set(part, occurrences);
        const key = `${part}#${occurrences}`;
        const match = /^\{(\w+)\}$/.exec(part);
        if (!match || !Object.hasOwn(values, match[1])) return <Fragment key={key}>{part}</Fragment>;
        return <bdi key={key}>{values[match[1]]}</bdi>;
      })}
    </>
  );
}
