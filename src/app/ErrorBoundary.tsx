import { Component, type ReactNode } from 'react';
import { REPO_URL } from './site';

interface Props {
  /**
   * When this value changes the boundary clears any caught error — wired to the
   * route so navigating away from a crashed tool mounts the next one fresh
   * rather than leaving it stuck on the fallback.
   */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render/runtime error thrown inside the active tool so a single
 * tool crash shows a recoverable panel instead of blanking the whole suite.
 * Resets automatically on {@link Props.resetKey} change (route change), and
 * offers a manual retry and a full reload. Nothing is reported off-machine —
 * the error is only logged to the console, in keeping with the local-first
 * promise.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error) {
    console.error('Atelier: a tool crashed —', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex-1 min-h-0 flex items-center justify-center p-8"
      >
        <div className="max-w-[48ch] text-center">
          <p className="m-0 mb-3 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-accent-ink">
            Something went wrong
          </p>
          <h2 className="m-0 mb-3 font-serif font-normal text-[clamp(1.8rem,5vw,2.4rem)] leading-tight tracking-[-0.01em]">
            This tool hit an error.
          </h2>
          <p className="m-0 mb-5 text-ink-soft text-[0.95rem] leading-[1.6]">
            Your files are untouched — nothing was uploaded or changed. Try
            again, reload the page, or switch to another tool. If it keeps
            happening, please report it.
          </p>
          {error.message && (
            <pre className="m-0 mb-5 px-4 py-3 text-left overflow-auto rounded-paper border border-line bg-surface font-mono text-[0.78rem] leading-[1.5] text-ink-soft">
              {error.message}
            </pre>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center px-4 py-2 rounded-paper border border-line-strong bg-surface text-[0.85rem] font-semibold text-ink transition-[border-color,transform] duration-200 ease-paper hover:border-accent hover:-translate-y-px"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => location.reload()}
              className="inline-flex items-center px-4 py-2 rounded-paper border border-line text-[0.85rem] font-semibold text-muted transition-colors duration-200 ease-paper hover:text-accent hover:border-accent"
            >
              Reload
            </button>
            <a
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-[0.85rem] font-semibold text-accent-ink underline underline-offset-[3px] hover:text-accent"
            >
              Report
            </a>
          </div>
        </div>
      </div>
    );
  }
}
