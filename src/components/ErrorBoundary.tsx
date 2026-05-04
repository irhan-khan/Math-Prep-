import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#141414] p-12 shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
            <h1 className="font-serif italic text-3xl mb-4">Something went wrong</h1>
            <p className="text-sm text-[#8E9299] mb-8 leading-relaxed">
              An unexpected error occurred. This might be due to a connection issue or a temporary service interruption.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-[#141414] text-white py-4 font-bold uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all duration-300 flex items-center justify-center gap-3"
            >
              <RefreshCcw className="w-5 h-5" />
              Reload Application
            </button>
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-8 p-4 bg-red-50 border border-red-100 text-left overflow-auto max-h-40">
                <p className="text-[10px] font-mono text-red-700">{this.state.error?.message}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
