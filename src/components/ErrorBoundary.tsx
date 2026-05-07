import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
  /** Optional custom fallback. Receives the error + a reset callback. */
  fallback?: (err: Error, reset: () => void) => ReactNode
  /** Identifier used in the default fallback so the user can quote it. */
  scope?: string
}

interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions in its subtree so a single broken page
 * doesn't take down the whole app shell. Component-class form is required
 * because React's error boundary contract is class-only.
 *
 * Use one at the app root (around the router) and additional ones around
 * heavy/unstable subtrees (Monaco editor, 3D world view, third-party widgets).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console for now; structured logging hook can plug in here.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ""}]`, error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm font-semibold text-destructive">Something broke in the UI{this.props.scope ? ` (${this.props.scope})` : ""}.</p>
            <p className="text-xs text-muted-foreground mt-2 font-mono break-words">
              {this.state.error.message || "Unknown error"}
            </p>
            <div className="mt-4 flex gap-2 justify-center">
              <button
                onClick={this.reset}
                className="px-3 py-1.5 rounded-md bg-secondary text-sm hover:bg-secondary/80"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
