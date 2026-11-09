import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';
import { reportClientError } from '../../lib/errorTracker';

interface Props {
  children: ReactNode;
  viewName?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ViewErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ViewErrorBoundary] Error captured in ${this.props.viewName || 'view'}:`, error, errorInfo);
    // a crash inside a screen is caught here, so the global error listener never sees it (L-14)
    reportClientError(error, { severity: 'error', componentStack: errorInfo.componentStack || undefined, metadata: { view: this.props.viewName || 'view' } }).catch(() => {});
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto my-12 bg-[var(--surface)] border border-rose-500/30 rounded-[32px] shadow-2xl space-y-6 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600">
            <AlertTriangle size={32} />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-black text-[var(--text)] tracking-tight">
              View Render Error {this.props.viewName ? `(${this.props.viewName})` : ''}
            </h2>
            <p className="text-xs text-[var(--muted)] max-w-md mx-auto leading-relaxed">
              An unexpected exception occurred while rendering this module. Your ledger data remains safe and intact.
            </p>
          </div>

          {this.state.error && (
            <div className="p-4 bg-[var(--ink)]/40 border border-[var(--line)] rounded-2xl text-left overflow-x-auto text-[11px] font-mono text-rose-400 max-h-36">
              {this.state.error.message || 'Unknown render error'}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={this.handleRetry}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
            >
              <RefreshCw size={14} />
              <span>Retry Rendering</span>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-[var(--ink)] hover:bg-[var(--line)] text-[var(--text)] font-bold text-xs rounded-xl border border-[var(--line)] transition-all"
            >
              Reload Page
            </button>
            <button
              onClick={() => { window.location.hash = '#dashboard'; window.location.reload(); }}
              className="px-5 py-2.5 bg-[var(--surface)] hover:bg-[var(--ink)] text-[var(--muted)] hover:text-[var(--text)] font-semibold text-xs rounded-xl border border-[var(--line)] flex items-center gap-2 transition-all"
            >
              <LayoutDashboard size={14} />
              <span>Dashboard</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
