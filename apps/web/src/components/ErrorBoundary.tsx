import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  readonly hasError: boolean;
}

/**
 * ErrorBoundary — catches render errors in child trees.
 *
 * A crash in one screen never blanks the whole app.
 * Logs the error via console.error, then shows a minimal locked fallback.
 * No router coupling; just wrap any subtree.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            color: "#566273",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 12,
          }}
        >
          Something broke on this screen — reload.
        </div>
      );
    }
    return this.props.children;
  }
}
