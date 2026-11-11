// Architecture: Billing & Usage Metric Tracker
// Centralized service for tracking users, charging, and establishing feature gates.
// 5* Modularity: New features can ask BillingService if they are allowed to execute.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from '../../stores/useAuthStore';

export interface BillingState {
  currentPlan: 'free' | 'growth' | 'pro' | 'enterprise';
  transactionCount: number;
  userCount: number; // Tracks registered collaborative users
  freeWorkspaceTxCap: number;
  maxRegistrationLimit: number;
  totalSystemUsers: number;
  registrationAllowed: boolean;
  incrementTransaction: () => void;
  incrementUserCount: () => void;
  fetchSystemCaps: () => Promise<void>;
  checkQuota: (plan?: string, txCount?: number) => boolean; // UX-only helper for UI feedback
}

export const useBillingStore = create<BillingState>()(
  persist(
    (set, _get) => ({
      currentPlan: 'free',
      transactionCount: 0,
      userCount: 1,
      freeWorkspaceTxCap: 100,
      maxRegistrationLimit: 100,
      totalSystemUsers: 1,
      registrationAllowed: true,
      incrementTransaction: () => set((state) => ({ transactionCount: state.transactionCount + 1 })),
      incrementUserCount: () => set((state) => ({ userCount: state.userCount + 1 })),
      fetchSystemCaps: async () => {
        try {
          const res = await fetch('/api/v1/public/registration-status');
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'success') {
              set({
                freeWorkspaceTxCap: data.freeWorkspaceTxCap ?? 100,
                maxRegistrationLimit: data.maxRegistrationLimit ?? 100,
                totalSystemUsers: data.totalUsers ?? 1,
                registrationAllowed: data.registrationAllowed ?? true
              });
            }
          }
        } catch (e) {
          // Gracefully ignore aborted fetch on component unmount / dev reload
          if ((e as Error)?.name !== 'AbortError') {
            console.debug("Registration status offline fallback enabled:", (e as Error)?.message || e);
          }
        }
      },
      // NOTE: checkQuota is for UX/UI feedback ONLY (e.g., showing upgrade prompts or disabling buttons).
      // True security and plan capacity limits are enforced server-side in Firestore rules and API routes.
      // Strategy 7: Ledger entries are uncapped on standard plans so automation and bank feeds are never penalized.
      checkQuota: (_plan?: string, _txCount?: number) => {
        const ws = useAuthStore.getState().getCurrentWorkspace() as ({ apiQuotaMonthlyLimitCents?: number } | undefined);
        if (ws?.apiQuotaMonthlyLimitCents && _txCount !== undefined) {
          return _txCount < Math.floor(ws.apiQuotaMonthlyLimitCents / 100);
        }
        return true;
      }
    }),
    {
      name: 'ledgerflow-billing-storage'
    }
  )
);

export const BillingAPI = {
  // External API wrapper for Stripe/payment processing
  async chargeUser(amountCents: number, currency: string = 'USD') {
    // Integrate Stripe or equivalent here to process real logic
    console.debug(`Processing charge of ${amountCents} ${currency} for usage.`);
    return true; 
  }
};
