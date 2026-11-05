import { useCallback, useEffect, useId, useRef } from 'react';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type FieldError = { node: HTMLParagraphElement; previousInvalid: string | null };
/** Distinguish native controls from forms and grouped radio lists. */
const isField = (target: unknown): target is Field => target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

/** Delegated native constraint errors, including dynamically added lines. The hook owns only
 * its error nodes and ARIA tokens; existing help survives edits, reset, close and unmount. */
export function useNativeFormErrors(active = true, context?: unknown) {
  const formRef = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const sequence = useRef(0);
  const errors = useRef(new Map<Field, FieldError>());
  const clear = useCallback((field: Field) => {
    const error = errors.current.get(field);
    if (!error) return;
    const described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.node.id);
    if (described.length) field.setAttribute('aria-describedby', described.join(' '));
    else field.removeAttribute('aria-describedby');
    if (error.previousInvalid === null) field.removeAttribute('aria-invalid');
    else field.setAttribute('aria-invalid', error.previousInvalid);
    error.node.remove();
    errors.current.delete(field);
  }, []);
  const show = useCallback((field: Field, message: string) => {
    let error = errors.current.get(field);
    if (!error) {
      const node = document.createElement('p');
      node.id = `${prefix}-field-error-${sequence.current++}`;
      node.setAttribute('role', 'alert');
      node.className = 'text-xs text-rose-600 dark:text-rose-400 mt-1';
      // Outside a wrapping label: the error must describe the field, not rename it.
      (field.closest('label') || field).insertAdjacentElement('afterend', node);
      error = { node, previousInvalid: field.getAttribute('aria-invalid') };
      errors.current.set(field, error);
    }
    error.node.textContent = message; // Never interpret validation text as HTML.
    field.setAttribute('aria-invalid', 'true');
    const described = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    described.add(error.node.id);
    field.setAttribute('aria-describedby', [...described].join(' '));
  }, [prefix]);
  useEffect(() => {
    const form = formRef.current;
    if (!active || !form) return;
    let focusQueued = false;
    let live = true;
    const invalid = (event: Event) => {
      if (!isField(event.target)) return;
      event.preventDefault();
      show(event.target, event.target.validationMessage);
      if (focusQueued) return;
      focusQueued = true;
      queueMicrotask(() => {
        focusQueued = false;
        if (!live || !form.isConnected) return;
        // Reading validity is side-effect free; checkValidity() would dispatch invalid again.
        const first = Array.from(form.elements).find((element): element is Field => isField(element) && !element.validity.valid);
        first?.focus();
      });
    };
    const input = (event: Event) => { if (isField(event.target)) clear(event.target); };
    const reset = () => { for (const field of errors.current.keys()) clear(field); };
    form.addEventListener('invalid', invalid, true);
    form.addEventListener('input', input, true);
    form.addEventListener('change', input, true);
    form.addEventListener('reset', reset);
    return () => {
      live = false;
      form.removeEventListener('invalid', invalid, true);
      form.removeEventListener('input', input, true);
      form.removeEventListener('change', input, true);
      form.removeEventListener('reset', reset);
      reset();
    };
  }, [active, context, clear, show]);
  const showFieldError = useCallback((nameOrId: string, message: string) => {
    const field = formRef.current?.elements.namedItem(nameOrId);
    if (isField(field)) { show(field, message); field.focus(); }
  }, [show]);
  // Dependent controls can invalidate the presentation without receiving an input event.
  const clearFieldError = useCallback((nameOrId: string) => {
    const field = formRef.current?.elements.namedItem(nameOrId);
    if (isField(field)) clear(field);
  }, [clear]);
  return { formRef, showFieldError, clearFieldError };
}
