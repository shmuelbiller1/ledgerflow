import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { reportClientError } from '../lib/errorTracker';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class FallbackBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    console.debug("CRASH_DUMP:", error.stack || error.message);
    reportClientError(error, {
      severity: 'fatal',
      componentStack: errorInfo.componentStack || undefined
    }).catch((reportErr) => { console.warn('[FallbackBoundary] Telemetry delivery skipped:', reportErr); });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--ink)] p-6">
          <div className="bg-[var(--surface)] p-4 md:p-8 rounded-[32px] border border-rose-100 shadow-sm max-w-xl w-full text-center space-y-6">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-[32px] mx-auto flex items-center justify-center">
              <AlertCircle size={32} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-[var(--text)] tracking-tight font-display">System Exception Detected</h1>
              <p className="text-sm font-medium text-[var(--muted)]">
                The application encountered an unexpected error. Please reload the interface.
              </p>
            </div>

            <div className="p-4 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] text-left overflow-auto max-h-40">
              <code className="text-xs font-mono text-rose-600 break-words">
                {this.state.error?.message || "Unknown rendering exception"}
              </code>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="btn-primary flex items-center justify-center gap-2 w-full active:scale-[0.98]"
            >
              <RefreshCw size={16} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
