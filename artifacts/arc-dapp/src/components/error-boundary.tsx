import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message ?? "Unknown error" };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="text-muted-foreground text-sm font-mono break-all">{this.state.message}</p>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
              onClick={() => this.setState({ hasError: false, message: "" })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
