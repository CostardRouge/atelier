import { useEffect } from 'react';
import { REPO_URL } from './app/site';
import { DEFAULT_TOOL, TOOLS, toolForPath } from './app/tools';
import { navigate, useHashRoute } from './app/use-hash-route';

/**
 * App shell for the Atelier suite: a masthead whose nav + active tool both
 * derive from the {@link TOOLS} registry, the active tool rendered in `<main>`,
 * and a shared footer. Adding a tool never touches this file — it's all driven
 * by the registry and the hash route.
 */
export default function App() {
  const path = useHashRoute();
  const tool = toolForPath(path) ?? DEFAULT_TOOL;

  // Reflect the default tool in the address bar on first load / unknown route,
  // so the URL always names the tool you're looking at.
  useEffect(() => {
    if (!toolForPath(path)) navigate(DEFAULT_TOOL.path);
  }, [path]);

  const Active = tool.Component;

  return (
    <div className={`app${tool.fullHeight ? ' app-full' : ''}`}>
      <header className="masthead">
        <span className="wordmark">
          <b>Atelier</b>
        </span>
        <div className="masthead-right">
          <nav className="nav" aria-label="Tools">
            {TOOLS.map((t) => (
              <a
                key={t.id}
                href={`#${t.path}`}
                className={t.id === tool.id ? 'active' : undefined}
                aria-current={t.id === tool.id ? 'page' : undefined}
              >
                {t.label}
              </a>
            ))}
          </nav>
          {tool.subtitle && <span className="edition">{tool.subtitle}</span>}
          <a
            className="gh-link"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
            title="View source on GitHub"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
          </a>
        </div>
      </header>

      <main className="tool-root">
        <Active />
      </main>

      <footer>
        <span className="dot" />
        Runs entirely in your browser — files are never uploaded.
        <span className="dot" />
        Everything stays on your machine — no account, no server.
        <span className="dot" />
        <a className="foot-link" href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
