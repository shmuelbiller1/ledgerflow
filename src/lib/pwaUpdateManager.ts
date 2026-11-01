import type { RegisterSWOptions } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { safeConfirm } from './utils';

export type RegisterSWFn = (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

export interface PWAUpdateState {
  updateAvailable: boolean;
  offlineReady: boolean;
  updating: boolean;
}

type UnsavedWorkGuard = () => boolean;
type PWAUpdateListener = (state: PWAUpdateState) => void;

const unsavedGuards = new Set<UnsavedWorkGuard>();
const listeners = new Set<PWAUpdateListener>();
const dirtyInputRefs = new Set<WeakRef<Element>>();
const elementWeakRefs = new WeakMap<Element, WeakRef<Element>>();
const baselineValues = new WeakMap<Element, string>();
const instrumentedDocs = new WeakSet<Document>();

let state: PWAUpdateState = {
  updateAvailable: false,
  offlineReady: false,
  updating: false,
};

let applyServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;

function readControlSnapshot(el: Element): string {
  const control = el as HTMLElement & {
    value?: string;
    checked?: boolean;
    type?: string;
  };
  const tag = control.tagName.toLowerCase();
  if (tag === 'input' && (control.type === 'checkbox' || control.type === 'radio')) {
    return String(Boolean(control.checked));
  }
  if (typeof control.value === 'string') {
    return control.value;
  }
  return control.textContent ?? '';
}

function pruneDirtyInputRefs(): void {
  for (const ref of [...dirtyInputRefs]) {
    const el = ref.deref();
    if (!el || !el.isConnected) {
      dirtyInputRefs.delete(ref);
      continue;
    }
    if (baselineValues.has(el) && readControlSnapshot(el) === baselineValues.get(el)) {
      dirtyInputRefs.delete(ref);
    }
  }
}

function trackDirtyElement(el: Element): void {
  let ref = elementWeakRefs.get(el);
  if (!ref) {
    ref = new WeakRef(el);
    elementWeakRefs.set(el, ref);
  }
  dirtyInputRefs.add(ref);
}

function untrackDirtyElement(el: Element): void {
  const ref = elementWeakRefs.get(el);
  if (ref) {
    dirtyInputRefs.delete(ref);
  }
}

function isTrackableFormControl(target: EventTarget | null): target is HTMLElement & {
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
} {
  if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
  const el = target as HTMLElement & { type?: string; readOnly?: boolean; disabled?: boolean };
  if (el.disabled || el.readOnly || el.hasAttribute?.('data-pwa-ignore-dirty')) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    return type !== 'search' && type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'reset';
  }
  return Boolean(el.isContentEditable);
}

export function clearDirtyTracking(container: ParentNode | null): void {
  pruneDirtyInputRefs();
  if (!container || !('contains' in container)) return;
  for (const ref of [...dirtyInputRefs]) {
    const el = ref.deref();
    if (!el || !el.isConnected) {
      dirtyInputRefs.delete(ref);
      continue;
    }
    if ((container as Node).contains(el)) {
      baselineValues.set(el, readControlSnapshot(el));
      dirtyInputRefs.delete(ref);
    }
  }
}

export function attachDirtyTracking(doc: Document | null = typeof document !== 'undefined' ? document : null): void {
  if (!doc || instrumentedDocs.has(doc)) return;
  instrumentedDocs.add(doc);

  const captureBaseline = (event: Event) => {
    pruneDirtyInputRefs();
    if (isTrackableFormControl(event.target)) {
      const ref = elementWeakRefs.get(event.target);
      if ((!ref || !dirtyInputRefs.has(ref)) && !baselineValues.has(event.target)) {
        baselineValues.set(event.target, readControlSnapshot(event.target));
      }
    }
  };
  const markDirty = (event: Event) => {
    pruneDirtyInputRefs();
    if (!isTrackableFormControl(event.target)) return;
    const el = event.target;
    const baseline = baselineValues.get(el);
    const current = readControlSnapshot(el);
    if (baseline !== undefined && current === baseline) {
      untrackDirtyElement(el);
    } else {
      trackDirtyElement(el);
    }
  };
  const clearFormOnReset = (event: Event) => {
    pruneDirtyInputRefs();
    const form = event.target;
    if (form && typeof form === 'object' && 'contains' in form) {
      for (const ref of [...dirtyInputRefs]) {
        const el = ref.deref();
        if (el && (form as Node).contains(el)) {
          baselineValues.delete(el);
          dirtyInputRefs.delete(ref);
        }
      }
    }
  };

  doc.addEventListener('focusin', captureBaseline, true);
  doc.addEventListener('input', markDirty, true);
  doc.addEventListener('change', markDirty, true);
  doc.addEventListener('reset', clearFormOnReset, true);
}

function emitState(next: Partial<PWAUpdateState>) {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener(state);
  }
}

export function getPWAUpdateState(): PWAUpdateState {
  return { ...state };
}

export function subscribePWAUpdate(listener: PWAUpdateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerUnsavedWorkGuard(guard: UnsavedWorkGuard): () => void {
  unsavedGuards.add(guard);
  return () => {
    unsavedGuards.delete(guard);
  };
}

/**
 * Detects whether the current browser tab has open modal editors, explicit dirty markers,
 * or active editable form fields so a service-worker update never discards in-progress work.
 */
export function hasUnsavedDocumentWork(doc: Document | null = typeof document !== 'undefined' ? document : null): boolean {
  for (const guard of unsavedGuards) {
    try {
      if (guard()) return true;
    } catch {
      // Ignore faulty guard and continue checking DOM state.
    }
  }
  if (!doc) return false;

  if (doc.querySelector('[data-unsaved-changes="true"]')) {
    return true;
  }

  pruneDirtyInputRefs();
  for (const ref of dirtyInputRefs) {
    const el = ref.deref();
    if (el && el.isConnected && el.ownerDocument === doc) {
      return true;
    }
  }

  // Open modal dialogs containing editable controls (journal entry, invoice, reconciliation, settings forms)
  const openModal = doc.querySelector('[aria-modal="true"]');
  if (openModal && openModal.querySelector('input:not([type="hidden"]):not([type="search"]):not([readonly]), textarea:not([readonly]), select:not([disabled]), [contenteditable="true"]')) {
    return true;
  }

  // Active focused input/textarea with non-empty user content inside a form
  const active = doc.activeElement as (HTMLElement & { value?: string; readOnly?: boolean; type?: string }) | null;
  if (active && active !== doc.body) {
    const tag = active.tagName.toLowerCase();
    if ((tag === 'textarea' || (tag === 'input' && active.type !== 'search' && active.type !== 'checkbox' && active.type !== 'radio')) && !active.readOnly) {
      if (typeof active.value === 'string' && active.value.trim().length > 0) {
        return true;
      }
    }
    if (active.isContentEditable) {
      return true;
    }
  }

  return false;
}

/**
 * Applies a waiting service worker update only on explicit user action, confirming first
 * if open dialogs or form fields indicate unsaved financial edits.
 */
export async function requestSafePWAUpdate(options?: {
  confirmFn?: (message: string) => boolean;
  doc?: Document | null;
}): Promise<boolean> {
  if (!applyServiceWorkerUpdate || !state.updateAvailable || state.updating) {
    return false;
  }
  const confirmFn = options?.confirmFn ?? safeConfirm;
  const doc = options?.doc === undefined ? (typeof document !== 'undefined' ? document : null) : options.doc;

  if (hasUnsavedDocumentWork(doc)) {
    const proceed = confirmFn('You have an open editor or unsaved changes in this tab. Reload now to finish updating LedgerFlow?');
    if (!proceed) {
      return false;
    }
  }

  emitState({ updating: true });
  try {
    await applyServiceWorkerUpdate(true);
    emitState({ updateAvailable: false, updating: false });
    return true;
  } catch {
    emitState({ updating: false });
    return false;
  }
}

/**
 * Registers the PWA service worker in safe prompt mode: new versions wait in the background
 * without forcing mid-session reloads until the user chooses to update.
 */
export function initPWAUpdateManager(
  registerFn: RegisterSWFn,
  options?: { notify?: (onAccept: () => void) => void }
): () => Promise<boolean> {
  attachDirtyTracking();

  const notify = options?.notify ?? ((onAccept: () => void) => {
    toast.info('A new version of LedgerFlow is ready.', {
      id: 'ledgerflow-pwa-update',
      duration: Infinity,
      description: 'Save any open work, then update when convenient.',
      action: {
        label: 'Update now',
        onClick: (event) => {
          event.preventDefault();
          onAccept();
        },
      },
    });
  });

  const showUpdatePrompt = () => {
    notify(() => {
      void requestSafePWAUpdate().then((applied) => {
        if (!applied && state.updateAvailable) {
          showUpdatePrompt();
        }
      });
    });
  };

  const updateSW = registerFn({
    immediate: true,
    onNeedRefresh() {
      emitState({ updateAvailable: true });
      showUpdatePrompt();
    },
    onOfflineReady() {
      emitState({ offlineReady: true });
    },
  });

  applyServiceWorkerUpdate = updateSW;
  return () => requestSafePWAUpdate();
}

export function resetPWAUpdateManagerForTests(): void {
  unsavedGuards.clear();
  listeners.clear();
  dirtyInputRefs.clear();
  applyServiceWorkerUpdate = null;
  state = {
    updateAvailable: false,
    offlineReady: false,
    updating: false,
  };
}
