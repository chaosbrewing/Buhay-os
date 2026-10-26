import { useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour for a modal dialog: focus moves in when it opens and returns to whatever opened
 * it when it closes, Tab stays inside, and Escape closes it.
 */
export function useModalBehavior(ref: RefObject<HTMLElement | null>, onClose: () => void, initialFocus?: string) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const target = (initialFocus ? ref.current?.querySelector<HTMLElement>(initialFocus) : null)
      ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => opener?.focus?.();
    // Runs once per open: the dialog is mounted only while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, [ref, onClose]);
}
