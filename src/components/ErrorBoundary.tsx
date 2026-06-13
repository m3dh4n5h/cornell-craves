import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Cornell Craves page crashed:", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-20 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/20">
            <RefreshCw className="size-6 text-primary-dark" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-xl font-bold">Something broke on our end</h2>
          <p className="mt-2 text-sm text-ink-muted">
            The page hit an unexpected error. A refresh usually fixes it.
          </p>
          <Button onClick={this.handleRetry} className="mt-6">
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
