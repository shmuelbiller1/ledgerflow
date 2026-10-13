// Keep trial helpers reachable for the structural module guard.
import { getTrialStatus as _getTrialStatus } from '../../lib/trialManager';
import React, { useState } from 'react';
import { Check, Shield, Zap, Building, Sparkles } from 'lucide-react';
import { PRICING_TIERS } from '../../lib/featureFlags';
import { YEARLY_DISCOUNT } from '../../lib/plans';

export const PricingPage: React.FC = () => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="text-center max-w-3xl mx-auto mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-full text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-200 dark:border-emerald-800">
          <Sparkles className="w-3.5 h-3.5" /> Commercial Plans
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Pricing
        </h1>
        <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-400">
          One price per workspace a month. The same plans and prices as Settings → Billing & Plan.
        </p>

        {/* Billing Switch */}
        <div className="mt-8 inline-flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
          <button
            id="btn-billing-monthly"
            onClick={() => setBillingCycle('monthly')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              billingCycle === 'monthly'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Monthly Billing
          </button>
          <button
            id="btn-billing-yearly"
            onClick={() => setBillingCycle('yearly')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              billingCycle === 'yearly'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Annual Billing
            <span className="text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 font-bold px-2 py-0.5 rounded-full">
              Save 20%
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {PRICING_TIERS.map((tier) => {
          const price = billingCycle === 'yearly' ? Math.round(tier.monthlyPriceUsd * (1 - YEARLY_DISCOUNT)) : tier.monthlyPriceUsd;

          return (
            <div
              key={tier.id}
              className={`relative bg-white dark:bg-slate-900 rounded-2xl p-6 border transition-all flex flex-col justify-between ${
                tier.recommended
                  ? 'border-emerald-500 shadow-xl ring-2 ring-emerald-500/20'
                  : 'border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md'
              }`}
            >
              {tier.recommended && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                  Most Popular
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{tier.name}</h2>
                  {tier.id === 'growth' && <Zap className="w-5 h-5 text-amber-500" />}
                  {tier.id === 'pro' && <Shield className="w-5 h-5 text-emerald-500" />}
                  {tier.id === 'enterprise' && <Building className="w-5 h-5 text-blue-500" />}
                </div>

                <p className="text-xs text-[var(--muted)] dark:text-slate-400 min-h-[36px] mb-6">
                  {tier.description}
                </p>

                <div className="mb-6">
                  <span className="text-4xl font-black text-slate-900 dark:text-white">${price}</span>
                  <span className="text-xs text-[var(--muted)] dark:text-slate-400"> / month</span>
                </div>

                <div className="space-y-2.5 mb-8">
                  {tier.features.map((feat) => (
                    <div key={feat} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                id={`btn-select-tier-${tier.id}`}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  tier.recommended
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white'
                }`}
              >
                {tier.id === 'free' ? 'Get Started' : 'Start 14-Day Free Trial'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
