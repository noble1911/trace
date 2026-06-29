import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Names the view that crashed, shown in the fallback header. */
  label?: string;
  /** Optional escape hatch (e.g. close the detail overlay) rendered as a button. */
  onBack?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

// React has no hook equivalent for error boundaries, so this is intentionally a
// class component — the one allowed exception to the "function components only"
// rule. Its job: stop a single view's render-time throw from unmounting the whole
// React tree to a blank screen, and surface the message + component stack in place
// so the failure is diagnosable instead of silent. (React also logs the error to
// the devtools console in dev.)
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const trace = error.stack ?? `${error.name}: ${error.message}`;
    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <div className="error-boundary-title">{this.props.label ?? "This view crashed"}</div>
          <div className="error-boundary-msg">{error.message || String(error)}</div>
          <pre className="error-boundary-stack">
            {trace}
            {componentStack ?? ""}
          </pre>
          {this.props.onBack && (
            <button type="button" className="btn" onClick={this.props.onBack}>
              Go back
            </button>
          )}
        </div>
      </div>
    );
  }
}
