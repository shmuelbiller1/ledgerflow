import { useDialog } from '../../hooks/useDialog';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import React, { useState, useId } from 'react';
import FxRevaluationPanel from './FxRevaluationPanel';

import { useAuthStore } from '../../stores/useAuthStore';

interface CurrencyConverterProps {
  isOpen?: boolean;
  onClose?: () => void;
  baseCurrency?: string;
}

export default function CurrencyConverter({ isOpen, onClose }: CurrencyConverterProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(() => onClose?.(), !!isOpen);
  const formId = useId();

  const [amount, setAmount] = useState<number>(100);
  const [fromCurrency, setFromCurrency] = useState<string>('USD');
  const [toCurrency, setToCurrency] = useState<string>('EUR');
  // live rates only (they were preset to made-up numbers, which also ignored the "from" currency; L-187)
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [ratesError, setRatesError] = useState('');

  React.useEffect(() => {
    let cancelled = false;
    const fetchRates = async () => {
      try {
        const user = useAuthStore.getState().user;
        const token = user ? await user.getIdToken() : '';
        const response = await fetch(`/api/v1/fx/rates/${fromCurrency}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && data.rates) { setExchangeRates(data.rates); setRatesError(''); }
        else { setExchangeRates({}); setRatesError(data.error || 'Exchange rates are not available right now'); }
      } catch {
        if (!cancelled) { setExchangeRates({}); setRatesError('Exchange rates are not available right now'); }
      }
    };
    void fetchRates();
    return () => { cancelled = true; };
  }, [fromCurrency]);

  const calculateConversion = () => {
    const rate = fromCurrency === toCurrency ? 1 : exchangeRates[toCurrency];
    return rate ? (amount * rate).toFixed(2) : '—';
  };

  const innerContent = (
    <div className="p-6 w-full max-w-xl mx-auto bg-[var(--surface)] dark:bg-slate-900 border border-[var(--line)] dark:border-slate-800 rounded-xl shadow-sm hover:shadow-md transition-all duration-200">
      <h2 className="text-xl font-medium text-[var(--text)] dark:text-white mb-6">
        Currency Converter
      </h2>

      <div className="space-y-4">
        <div>
          <label htmlFor={`${formId}-amount`} className="block text-sm font-medium text-[var(--muted)] mb-1">
            Amount
          </label>
          <input
            id={`${formId}-amount`}
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${formId}-from`} className="block text-sm font-medium text-[var(--muted)] mb-1">
              From
            </label>
            <select
              id={`${formId}-from`}
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text)]"
            >
              {Object.keys(exchangeRates).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${formId}-to`} className="block text-sm font-medium text-[var(--muted)] mb-1">
              To
            </label>
            <select
              id={`${formId}-to`}
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text)]"
            >
              {Object.keys(exchangeRates).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--line)] mt-6">
          <p className="text-sm text-[var(--muted)] mb-1">
            Converted Amount
          </p>
          <div className="text-3xl font-medium text-[var(--text)]">
            {calculateConversion()} {toCurrency}
          </div>
          {ratesError && <p role="status" className="mt-2 text-xs text-[var(--muted)]">{ratesError}</p>}
        </div>
        <FxRevaluationPanel />

      </div>
    </div>
  );

  if (isOpen !== undefined) {
    if (!isOpen) return null;
    return (
      <div {...overlayDialogProps} className="fixed inset-0 z-[300] flex items-center justify-center p-4">
        <h2 id={overlayTitleId} className="sr-only">Currency converter</h2>
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-xl bg-[var(--surface)] dark:bg-slate-900 rounded-2xl shadow-xl border border-[var(--line)] dark:border-slate-800 overflow-hidden"
        >
          {onClose && (
            <button aria-label="Close" 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors z-10"
            ><X aria-hidden="true" size={20} /></button>
          )}
          {innerContent}
        </motion.div>
      </div>
    );
  }

  return innerContent;
}
