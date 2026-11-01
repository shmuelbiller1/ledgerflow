import { toast } from 'sonner';
import { safeConfirm } from './utils';

export type RegisterSWFn = (options?: {
  immediate?: boolean;
  onNeedReload?: () => void;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}) => (reloadPage?: boolean) => Promise<void>;

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
const instrumentedDocs = new WeakSet<Document>();

let state: PWAUpdateState = {
  updateAvailable: false,
  offlineReady: false,
  updating: false,
};

let applyServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let reloadActivePage: () => void = () => {
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
};
let approvedReloadInThisTab = false;
let deferredControllerReload = false;

/** Prunes garbage-collected or disconnected form controls from the tracked WeakRef set. */
function pruneDirtyInputRefs(): void {
  for (const ref of [...dirtyInputRefs]) {
    const el = ref.deref();
    if (!el || !el.isConnected) {
      dirtyInputRefs.delete(ref);
    }
  }
}

/** Weakly records a form control as having unsaved edits without pinning detached DOM nodes. */
function trackDirtyElement(el: Element): void {
  let ref = elementWeakRefs.get(el);
  if (!ref) {
    ref = new WeakRef(el);
    elementWeakRefs.set(el, ref);
  }
  dirtyInputRefs.add(ref);
}

/** Checks whether an event target is an editable user form control eligible for dirty tracking. */
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

/** Clears dirty tracking strictly for controls contained within the saved panel `container`. */
export function clearDirtyTracking(container: ParentNode | null): void {
  pruneDirtyInputRefs();
  if (!container || !('contains' in container)) return;
  for (const ref of [...dirtyInputRefs]) {
    const el = ref.deref();
    if (!el || !el.isConnected || (container as Node).contains(el)) {
      dirtyInputRefs.delete(ref);
    }
  }
}

/** Attaches focus-independent input/change/reset listeners to detect unsaved page form edits. */
export function attachDirtyTracking(doc: Document | null = typeof document !== 'undefined' ? document : null): void {
  if (!doc || instrumentedDocs.has(doc)) return;
  instrumentedDocs.add(doc);

  const markDirty = (event: Event) => {
    pruneDirtyInputRefs();
    if (isTrackableFormControl(event.target)) {
      trackDirtyElement(event.target);
    }
  };
  const clearFormOnReset = (event: Event) => {
    pruneDirtyInputRefs();
    const form = event.target;
    if (form && typeof form === 'object' && 'contains' in form) {
      for (const ref of [...dirtyInputRefs]) {
        const el = ref.deref();
        if (el && (form as Node).contains(el)) {
          dirtyInputRefs.delete(ref);
        }
      }
    }
  };

  doc.addEventListener('input', markDirty, true);
  doc.addEventListener('change', markDirty, true);
  doc.addEventListener('reset', clearFormOnReset, true);
}

/** Updates internal PWA state and notifies subscribed listeners. */
function emitState(next: Partial<PWAUpdateState>) {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener(state);
  }
}

/** Returns a shallow snapshot of the current PWA service-worker update state. */
export function getPWAUpdateState(): PWAUpdateState {
  return { ...state };
}

/** Subscribes to PWA service-worker update state transitions; returns an unsubscribe callback. */
export function subscribePWAUpdate(listener: PWAUpdateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Registers a callback that returns `true` while a component holds unsaved draft work. */
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
  if ((!applyServiceWorkerUpdate && !deferredControllerReload) || !state.updateAvailable || state.updating) {
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

  if (deferredControllerReload) {
    deferredControllerReload = false;
    approvedReloadInThisTab = false;
    emitState({ updateAvailable: false, updating: false });
    reloadActivePage();
    return true;
  }

  if (!applyServiceWorkerUpdate) {
    return false;
  }

  approvedReloadInThisTab = true;
  emitState({ updating: true });
  try {
    await applyServiceWorkerUpdate(true);
    emitState({ updateAvailable: false, updating: false });
    return true;
  } catch {
    approvedReloadInThisTab = false;
    emitState({ updating: false });
    return false;
  }
}

/**
 * Registers the PWA service worker in safe prompt mode: new versions wait in the background
 * without forcing mid-session reloads, and updates accepted in one tab defer reloading sibling
 * tabs that hold unsaved work.
 */
export function initPWAUpdateManager(
  registerFn: RegisterSWFn,
  options?: {
    notify?: (onAccept: () => void) => void;
    reload?: () => void;
    doc?: Document | null;
  }
): () => Promise<boolean> {
  const targetDoc = options?.doc === undefined ? (typeof document !== 'undefined' ? document : null) : options.doc;
  attachDirtyTracking(targetDoc);
  reloadActivePage =
    options?.reload ??
    (() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    });

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
      void requestSafePWAUpdate({ doc: targetDoc }).then((applied) => {
        if (!applied && state.updateAvailable) {
          showUpdatePrompt();
        }
      });
    });
  };

  const updateSW = registerFn({
    immediate: true,
    onNeedReload() {
      if (approvedReloadInThisTab) {
        approvedReloadInThisTab = false;
        deferredControllerReload = false;
        reloadActivePage();
        return;
      }
      if (hasUnsavedDocumentWork(targetDoc)) {
        deferredControllerReload = true;
        emitState({ updateAvailable: true, updating: false });
        showUpdatePrompt();
        return;
      }
      deferredControllerReload = false;
      emitState({ updateAvailable: false, updating: false });
      reloadActivePage();
    },
    onNeedRefresh() {
      emitState({ updateAvailable: true });
      showUpdatePrompt();
    },
    onOfflineReady() {
      emitState({ offlineReady: true });
    },
  });

  applyServiceWorkerUpdate = updateSW;
  return () => requestSafePWAUpdate({ doc: targetDoc });
}

/** Resets module-level PWA update state and registered guards between unit tests. */
export function resetPWAUpdateManagerForTests(): void {
  unsavedGuards.clear();
  listeners.clear();
  dirtyInputRefs.clear();
  state = {
    updateAvailable: false,
    offlineReady: false,
    updating: false,
  };
  applyServiceWorkerUpdate = null;
  approvedReloadInThisTab = false;
  deferredControllerReload = false;
  reloadActivePage = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };
}
