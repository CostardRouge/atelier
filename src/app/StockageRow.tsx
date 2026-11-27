import { useEffect, useState, useSyncExternalStore } from 'react';
import { STOCKAGE_SOURCE_ID } from '../shared/sources/stockage/config';
import {
  getSesameSession,
  sesameProblem,
  signInWithSesame,
  signOutOfSesame,
  subscribeSesameSession,
} from '../shared/sources/stockage/session';
import { refreshStockageSheet, stockageSheet } from '../shared/sources/stockage/store';
import { Fact, SourceRow, ghost, pill, solid } from './source-row';

/**
 * Sources › *Your storage*: the person's shared storage, where documents
 * kept on a Winnow move to (CostardRouge/stockage). Signing in with Sésame
 * is the act that adds it as a source; every gallery then offers it beside
 * this browser and any Winnow, and a document moves there with the
 * gallery's own *Move to*. Opening this page re-asks what it keeps.
 */
export default function StockageRow() {
  const session = useSyncExternalStore(subscribeSesameSession, getSesameSession);
  const [state, setState] = useState<'asking' | 'ok' | 'down'>('asking');
  const [error, setError] = useState<string | null>(sesameProblem());

  useEffect(() => {
    if (!session) return;
    let alive = true;
    setState('asking');
    refreshStockageSheet().then(
      () => alive && setState('ok'),
      () => alive && setState('down'),
    );
    return () => {
      alive = false;
    };
  }, [session?.sub]);

  const dot = 'w-[7px] h-[7px] rounded-full block';
  if (!session) {
    return (
      <SourceRow
        glyph="ST"
        remote
        name="Your storage"
        aside="your documents on every device, through Sésame"
        dim
        pill={<span className={`${pill} border-line-strong bg-surface text-ink-soft`}>signed out</span>}
        actions={
          <button
            type="button"
            className={solid}
            onClick={() => {
              setError(null);
              void signInWithSesame('#/sources').catch((err: unknown) =>
                setError(err instanceof Error ? err.message : String(err)),
              );
            }}
          >
            Sign in with Sésame
          </button>
        }
        facts={<Fact label="address" value={STOCKAGE_SOURCE_ID} />}
        note={
          error && (
            <p className="m-0 mt-1.5 text-xs text-danger leading-snug" role="alert">
              {error}
            </p>
          )
        }
      />
    );
  }

  const sheet = stockageSheet();
  return (
    <SourceRow
      glyph="ST"
      remote
      name={STOCKAGE_SOURCE_ID}
      aside="your storage"
      pill={
        state === 'ok' ? (
          <span className={`${pill} border-ok-line bg-ok-wash text-ok`}>
            <i className={`${dot} bg-ok`} />
            reachable
          </span>
        ) : state === 'asking' ? (
          <span className={`${pill} border-line-strong bg-surface text-ink-soft`}>
            <i className={`${dot} bg-faint animate-pulse-dot`} />
            asking…
          </span>
        ) : (
          <span className={`${pill} border-danger-line bg-accent-wash text-accent-ink`}>unreachable</span>
        )
      }
      actions={
        <button type="button" className={ghost} onClick={() => void signOutOfSesame()}>
          Sign out
        </button>
      }
      facts={
        <>
          <Fact label="signed in as" value={session.name ?? session.sub} />
          <Fact label="keeps" value={sheet.documents.openKinds ? 'every document' : (sheet.documents.kinds ?? []).join(', ')} />
          {sheet.version && <Fact label="version" value={sheet.version} />}
        </>
      }
      note={
        <p className="m-0 mt-1.5 text-xs text-muted leading-snug">
          A document moves here from a Winnow with its gallery&apos;s <b className="font-medium text-ink-soft">Move to</b>.
        </p>
      }
    />
  );
}
