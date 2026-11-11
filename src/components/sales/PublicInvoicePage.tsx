import React, { useEffect, useState } from 'react';
import { Invoice } from '../../types';
import { formatCurrency, formatDate } from '../../lib/utils';
import { CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTimeout } from '../../hooks/useTimeout';

import { BRAND_NAME } from '../../config/brand';
/** The invoice as the public link returns it, with what is still due. */
type PublicInvoice = Invoice & { remainingBalanceCents?: number };

export default function PublicInvoicePage() {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const { setSafeTimeout } = useTimeout();

  useEffect(() => {
    const token = window.location.pathname.split('/i/')[1];
    if (!token) {
      setSafeTimeout(() => setError('Invalid invoice link'), 0);
      setSafeTimeout(() => setLoading(false), 0);
      return;
    }

    fetch(`/api/v1/invoices/public/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setInvoice(data.invoice);
        }
      })
      .catch(err => {
        console.error(err);
        setError('Failed to load invoice');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [setSafeTimeout]);

  const handlePay = async (paymentMethod?: 'card' | 'us_bank_account') => {
    if (!invoice) return;
    setIsPaying(true);
    try {
      const res = await fetch(`/api/v1/invoices/public/${invoice.paymentToken}/pay`, {
        method: 'POST',
        ...(paymentMethod
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paymentMethod }),
            }
          : {}),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Failed to initiate payment');
        setIsPaying(false);
      }
    } catch (err) {
      console.error(err);
      toast.error('Payment error');
      setIsPaying(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50" role="status" aria-label="Loading the invoice"><div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" aria-hidden="true" /></div>;
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold mb-2">Unable to Load Invoice</h1>
          <p className="text-gray-600 mb-6">{error}</p>
        </div>
      </div>
    );
  }

  const currency = invoice.currency || 'USD';
  const dueCents = invoice.remainingBalanceCents ?? Math.max(0, invoice.amountCents - (invoice.depositCents || 0) - (invoice.amountPaidCents || 0));
  const isPaid = invoice.status === 'paid' || dueCents <= 0;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-900 text-white rounded-xl flex items-center justify-center">
              <Building2 size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Invoice {invoice.number}</h1>
              <p className="text-sm text-gray-500">Issued on {formatDate(invoice.date || '')}</p>
            </div>
          </div>
          
          <div className="flex gap-3">
            {isPaid ? (
              <div className="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-lg flex items-center gap-2 font-medium">
                <CheckCircle2 size={18} />
                Paid
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {currency.toUpperCase() === 'USD' && (
                  <button
                    type="button"
                    onClick={() => void handlePay('us_bank_account')}
                    disabled={isPaying}
                    className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 rounded-lg text-sm font-medium shadow-sm transition-all disabled:opacity-50"
                  >
                    Bank transfer (ACH)
                  </button>
                )}
                <button
                  onClick={() => void handlePay()}
                  disabled={isPaying}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium shadow-md transition-all flex items-center gap-2 disabled:opacity-50 tabular-nums"
                >
                  {isPaying ? 'Processing...' : `Pay ${formatCurrency(dueCents, currency)}`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Invoice Body */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-8 sm:p-12">
            <div className="flex flex-col sm:flex-row justify-between gap-8 mb-12">
              <div>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Billed To</h3>
                <p className="text-lg font-medium text-gray-900">{invoice.customerName}</p>
              </div>
              <div className="sm:text-right">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Total Amount</h3>
                <p className="text-4xl font-bold text-gray-900 tabular-nums">{formatCurrency(invoice.amountCents, currency)}</p>
                {(invoice.depositCents || 0) > 0 && (
                  <p className="text-sm text-gray-600 mt-1 tabular-nums">Deposit received: −{formatCurrency(invoice.depositCents || 0, currency)}</p>
                )}
                {(invoice.amountPaidCents || 0) > 0 && (
                  <p className="text-sm text-gray-600 mt-1 tabular-nums">Paid: −{formatCurrency(invoice.amountPaidCents || 0, currency)}</p>
                )}
                {!isPaid && (
                  <p className="text-sm text-gray-700 mt-1 tabular-nums">Amount due {formatCurrency(dueCents, currency)} by {formatDate(invoice.dueDate || '')}</p>
                )}
              </div>
            </div>

            <div className="mb-8">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Description</h3>
              <p className="text-gray-800">{invoice.metadata?.memo || 'Services rendered'}</p>
            </div>

          </div>
          <div className="bg-gray-50 p-6 border-t border-gray-100 flex justify-between items-center text-sm text-gray-500">
            <p>Powered by {BRAND_NAME}</p>
          </div>
        </div>

      </div>
    </div>
  );
}
