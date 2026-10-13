import React, { useEffect, useState } from 'react';
import { PLANS, planFor } from '../../../lib/plans';
import { useAuthStore } from '../../../stores/useAuthStore';
import { CreditCard, ChevronRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { auth } from '../../../firebase';
import { RequireRole } from '../../ui/RequireRole';
import UsagePanel from './UsagePanel';

export default function BillingSettings() {
  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspaces = useAuthStore(state => state.workspaces);
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const [billingStatus, setBillingStatus] = useState<{ plan?: string; paymentStatus?: string; stripeSubscriptionId?: string } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!currentWorkspace?.id || !auth.currentUser) return;

    const fetchStatus = async () => {
      try {
        const token = await auth.currentUser!.getIdToken();
        const res = await fetch(`/api/v1/billing/status?workspaceId=${currentWorkspace.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setBillingStatus(data);
      } catch {
        console.error("Failed to fetch billing status");
      }
    };
    
    const verifyCheckout = async () => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const checkoutStatus = params.get('checkout');
        const session_id = params.get('session_id');

        if (checkoutStatus === 'success' && session_id) {
          setIsVerifying(true);
          try {
            const token = await auth.currentUser!.getIdToken();
            const res = await fetch('/api/v1/billing/verify-session', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                workspaceId: currentWorkspace.id,
                session_id
              })
            });
            const data = await res.json();
            if (data.status === 'success') {
              toast.success("Subscription payment successfully processed. Thank you!");
              await fetchStatus();
            } else {
              toast.error("Subscription could not be verified", { description: data.message });
            }
          } catch (e) {
            toast.error("Verification failed", { description: (e as Error).message || String(e) });
          } finally {
            setIsVerifying(false);
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } else if (checkoutStatus === 'canceled') {
          toast.info("Checkout was canceled.");
          window.history.replaceState({}, document.title, window.location.pathname);
          await fetchStatus();
        } else {
          await fetchStatus();
        }
      }
    };

    verifyCheckout();
  }, [currentWorkspace?.id]);

  const handleCheckout = async (plan: string) => {
    if (!currentWorkspace?.id || !auth.currentUser) return;
    try {
      const toastId = toast.loading('Initiating secure checkout via Stripe...');
      const token = await auth.currentUser.getIdToken();
      
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workspaceId: currentWorkspace.id,
          plan: plan
        })
      });
      
      const data = await res.json();
      if (data.url) {
        toast.dismiss(toastId);
        window.location.assign(data.url);
      } else {
        throw new Error(data.message || 'Failed to create checkout session');
      }
    } catch (e) {
      toast.error('Checkout Error', { description: (e as Error).message || String(e) });
    }
  };

  const handleOpenPortal = async () => {
    if (!currentWorkspace?.id || !auth.currentUser) return;
    try {
      const toastId = toast.loading('Opening customer portal...');
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/v1/billing/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ workspaceId: currentWorkspace.id })
      });
      const data = await res.json();
      if (data.url) {
        toast.dismiss(toastId);
        window.location.assign(data.url);
      } else {
        throw new Error(data.message || 'Customer portal unavailable');
      }
    } catch (e) {
      toast.error('Portal Error', { description: (e as Error).message || String(e) });
    }
  };

  const activePlan = planFor(billingStatus?.plan || currentWorkspace?.plan).id;
  const isPastDue = billingStatus?.paymentStatus === 'past_due' || (currentWorkspace as typeof currentWorkspace & { paymentStatus?: string })?.paymentStatus === 'past_due';

  // the one plan table (src/lib/plans.ts), shared with the public pricing page and the checkout
  const plans = PLANS.map(p => ({
    id: p.id, name: p.name, price: `$${p.monthlyUsd}`, period: '/mo',
    ...(p.recommended ? { badge: 'Popular' } : {}),
    desc: p.description, features: p.features,
  }));

  return (
    <div className="space-y-8">
      <UsagePanel />
      {/* Payment Warning Banner */}
      {isPastDue && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-amber-900 shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-600 shrink-0" size={20} />
            <div>
              <h3 className="font-bold text-sm">Payment Past Due</h3>
              <p className="text-xs text-amber-700">Your last subscription payment failed. Please update your payment method to avoid service interruption.</p>
            </div>
          </div>
          <button
            onClick={handleOpenPortal}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shrink-0"
          >
            Update Payment Method
          </button>
        </div>
      )}

      {/* Main Container */}
      <div className="ledger-card p-6 md:p-10 bg-white border border-slate-200 rounded-3xl shadow-sm">
        <div className="flex flex-col md:flex-row gap-6 md:items-center justify-between mb-8 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <CreditCard size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Subscription & Plan Tiers</h2>
              <p className="text-xs text-[var(--muted)] font-medium">Manage workspace plan capacity, billing cycle, and billing portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[var(--muted)]">Current Plan:</span>
            <span className="px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold rounded-full uppercase tracking-wider">
              {activePlan}
            </span>
            {billingStatus?.stripeSubscriptionId && (
              <RequireRole requiredRole="owner" disableOnly tooltip="Only the workspace owner can manage billing">
                <button
                  onClick={handleOpenPortal}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <CheckCircle2 size={14} /> Manage Portal
                </button>
              </RequireRole>
            )}
          </div>
        </div>

        {isVerifying ? (
          <div className="p-12 text-center text-[var(--muted)] font-medium animate-pulse">
            Verifying secure checkout payment session...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map(p => {
              const isCurrent = activePlan === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-6 rounded-2xl border flex flex-col justify-between transition-all ${
                    isCurrent
                      ? 'border-indigo-600 bg-indigo-50/40 shadow-md relative'
                      : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm'
                  }`}
                >
                  {p.badge && !isCurrent && (
                    <div className="absolute -top-3 right-4 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm">
                      {p.badge}
                    </div>
                  )}

                  {isCurrent && (
                    <div className="absolute -top-3 right-4 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm">
                      Active
                    </div>
                  )}

                  <div>
                    <h3 className="text-base font-bold text-slate-900">{p.name}</h3>
                    <p className="text-xs text-[var(--muted)] mt-1 min-h-[32px]">{p.desc}</p>
                    <div className="mt-4 mb-6">
                      <span className="text-3xl font-extrabold text-slate-900">{p.price}</span>
                      <span className="text-xs text-[var(--muted)] font-medium">{p.period}</span>
                    </div>

                    <ul className="space-y-2.5 text-xs text-slate-600 mb-6">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <CheckCircle2 size={14} className="text-indigo-600 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full py-2.5 bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl cursor-default"
                    >
                      Current Plan
                    </button>
                  ) : p.id === 'free' ? (
                    <button
                      disabled
                      className="w-full py-2.5 bg-slate-100 text-[var(--muted)] font-semibold text-xs rounded-xl cursor-not-allowed"
                    >
                      Included
                    </button>
                  ) : (
                    <RequireRole requiredRole="owner" disableOnly tooltip="Only the workspace owner can upgrade plans">
                      <button
                        onClick={() => handleCheckout(p.id)}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        Upgrade to {p.name} <ChevronRight size={14} />
                      </button>
                    </RequireRole>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
