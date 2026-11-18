import { useEffect, useId, useRef } from 'react';

/** Detail pages replace their list, so the original opener unmounts. Focus its new DOM node on Back. */
export function useDetailReturnFocus(selectedId: string | null) {
  const prefix = useId();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId === null && previous.current !== null) {
      document.getElementById(`${prefix}-${previous.current}`)?.focus();
    }
    previous.current = selectedId;
  }, [selectedId, prefix]);
  return (recordId: string) => `${prefix}-${recordId}`;
}
