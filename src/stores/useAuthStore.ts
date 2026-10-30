import { create } from 'zustand';
import { User as FirebaseUser } from '../lib/db/auth';
import { Workspace, User as UserProfile } from '../types';
import { useLedgerStore } from './useLedgerStore';
import { useSavedViewsStore } from './useSavedViewsStore';
import { registerBrowserWorkspacePrefs } from '../lib/workspacePrefs';

export const isSystemAdminEmail = (_email?: string | null): boolean => {
  return false;
};

interface AuthState {
  user: FirebaseUser | null;
  isGuest: boolean;
  userProfile: UserProfile | null;
  isAdmin: boolean;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  currentProjectId: string | null;
  
  // Actions
  setUser: (user: FirebaseUser | null) => void;
  setIsGuest: (val: boolean) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  checkTokenAdminClaim: () => Promise<boolean>;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setCurrentWorkspaceId: (id: string | null) => void;
  setCurrentProjectId: (id: string | null) => void;
  updateGeminiApiKey: (key: string) => Promise<void>;
  updateUserRole: (role: 'admin' | 'client') => Promise<void>;
  
  // Helpers
  getCurrentWorkspace: () => Workspace | undefined;
}

/** AUD-13: one number per sign-in (setUser call); an answer started under an older one is dropped, even for the same account. */
let authSession = 0;
/** The signed-in account and its sign-in, for checks after an await (identityScope); null when nobody is signed in. */
export const currentIdentity = () => {
  const uid = useAuthStore.getState().user?.uid;
  return uid ? `${uid}#${authSession}` : null;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isGuest: typeof localStorage !== "undefined" ? localStorage.getItem("isGuest") === "true" : false,
  userProfile: null,
  isAdmin: false,
  workspaces: [],
  currentWorkspaceId: typeof localStorage !== "undefined" ? localStorage.getItem('ledgerflow_current_workspace') : null,
  currentProjectId: null,

  setUser: (user) => {
    // AUD-13: another account (or none) is a new identity: what the previous one could see goes with it, and an answer
    // still on its way for the previous one is dropped (the uid checks below)
    const before = get().user?.uid ?? null;
    const session = ++authSession;
    if ((user?.uid ?? null) !== before) {
      set({ isAdmin: false, userProfile: null, workspaces: [], currentProjectId: null });
      // the previous account's books (the open workspace and its cached lists) go too; a first sign-in keeps the
      // remembered workspace
      if (before) get().setCurrentWorkspaceId(null);
    }
    set({ user });
    if (user) {
      user.getIdTokenResult().then((res) => {
        if (authSession !== session) return;
        const tokenIsAdmin = Boolean(res.claims.admin || res.claims.role === 'admin');
        set({ isAdmin: tokenIsAdmin });
      }).catch((err) => {
        console.error(err);
      });
    }
  },
  setIsGuest: (isGuest) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("isGuest", isGuest ? "true" : "false");
    }
    set({ isGuest });
  },
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  checkTokenAdminClaim: async () => {
    const { user } = get();
    if (!user) {
      set({ isAdmin: false });
      return false;
    }
    const session = authSession;
    try {
      let res = await user.getIdTokenResult();
      let tokenIsAdmin = Boolean(res.claims.admin || res.claims.role === 'admin');
      if (!tokenIsAdmin) {
        // Force refresh to grab newly granted custom claim
        await user.getIdToken(true);
        res = await user.getIdTokenResult();
        tokenIsAdmin = Boolean(res.claims.admin || res.claims.role === 'admin');
      }
      // AUD-13: the answer is the user's who asked; another account signed in meanwhile keeps its own
      if (authSession !== session) return false;
      set({ isAdmin: tokenIsAdmin });
      return tokenIsAdmin;
    } catch (err) {
      console.warn("Failed to check token admin claim:", err);
      return false;
    }
  },
  setUserProfile: (userProfile) => {
    // AUD-13: a profile read for an account that is no longer the signed-in one is not shown or used
    const current = get().user?.uid;
    if (userProfile && (!current || (userProfile.uid && userProfile.uid !== current))) return;
    set({ userProfile });
    const { user, isAdmin } = get();
    const profileIsAdmin = userProfile?.role === 'admin';
    if (profileIsAdmin) {
      set({ isAdmin: true });
    } else if (user && !isAdmin) {
      get().checkTokenAdminClaim().catch(console.error);
    }
  },
  setWorkspaces: (workspaces) => set({ workspaces }),
  setCurrentWorkspaceId: (currentWorkspaceId) => {
    if (typeof localStorage !== "undefined") {
      if (currentWorkspaceId) {
        localStorage.setItem('ledgerflow_current_workspace', currentWorkspaceId);
      } else {
        localStorage.removeItem('ledgerflow_current_workspace');
      }
    }
    
    // Clear ledger store data immediately to prevent ghosting between workspaces
    if (get().currentWorkspaceId !== currentWorkspaceId) {
      useLedgerStore.getState().resetStore();
      useSavedViewsStore.getState().loadViewsForWorkspace(currentWorkspaceId);
    }
    
    set({ currentWorkspaceId });
  },
  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),
  
  updateGeminiApiKey: async (key: string) => {
    const { user, userProfile } = get();
    if (!user) return;

    if (userProfile) {
      set({ userProfile: { ...userProfile, geminiApiKey: key } });
    } else {
      set({ 
        userProfile: { 
          uid: user.uid, 
          email: user.email || '', 
          role: 'client', 
          geminiApiKey: key 
        } as UserProfile 
      });
    }
  },

  updateUserRole: async (role: 'admin' | 'client') => {
    const { user, userProfile } = get();
    if (!user) {
      if (userProfile) {
        set({ userProfile: { ...userProfile, role } });
      }
      return;
    }

    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/v1/admin/users/${user.uid}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role })
      });

      if (res.ok) {
        await user.getIdToken(true);
        if (userProfile) {
          set({ userProfile: { ...userProfile, role } });
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server rejected role update: ${res.statusText}`);
      }
    } catch (error) {
      console.error("Failed to update user role:", error);
      throw error;
    }
  },
  
  getCurrentWorkspace: () => {
    const { workspaces, currentWorkspaceId } = get();
    return workspaces.find(w => w.id === currentWorkspaceId);
  }
}));

registerBrowserWorkspacePrefs(() => {
  const state = useAuthStore.getState();
  const ws = state?.workspaces?.find((w) => w.id === state?.currentWorkspaceId);
  if (!ws) return undefined;
  return {
    timezone: ws.timezone,
    currency: ws.currency,
    moneyDisplay: ws.moneyDisplay,
  };
});
