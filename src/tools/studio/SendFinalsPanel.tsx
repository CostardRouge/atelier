import { useMemo, useState } from 'react';
import {
  WinnowClient,
  WinnowError,
  canWriteBack,
} from '../../shared/sources/winnow/client';
import { finalsPlan } from '../../shared/sources/winnow/finals';
import { getWinnowConnection } from '../../shared/sources/winnow/store';
import { formatBytes } from '../../shared/lib/format';

interface SendFinalsPanelProps {
  /** The deliverables the last export run produced, in order. */
  files: readonly File[];
  /** The instance the source clip came from. */
  sourceId: string;
  /** The clip's identity as that instance vouched for it — `"<host>/<id>"`. */
  assetId: string | null;
}

type Sending =
  | { state: 'idle' }
  | { state: 'sending'; index: number }
  | { state: 'done'; sent: number }
  | { state: 'failed'; message: string; login?: string; sent: number };

/**
 * After an export whose clip came from a Winnow: send the finals HOME, so
 * the instance's lineage (`original_asset_id`, `has_edit`, the exports of an
 * asset) records that this capture has been told. Bridge phase 2, scoped
 * by the timeline's chapter when one is known (§6).
 *
 * Opt-in, one click, and it says exactly what will leave: the files, their
 * weight, the host. It refuses before a byte moves when the plan is unsound
 * — a clip from another instance, a file over the upload limit, a read-only
 * account — because failing at 90 % of a 400 MB upload through a tunnel is
 * the worst way to learn any of that. Files go one request at a time (the
 * body limit is per request), then one `/api/reconcile` links them.
 *
 * This is the third network exception, and the first WRITE: only ever to an
 * instance the user connected on `#/connect`, only what they just rendered.
 */
export default function SendFinalsPanel({ files, sourceId, assetId }: SendFinalsPanelProps) {
  const connection = getWinnowConnection(sourceId);
  const [sending, setSending] = useState<Sending>({ state: 'idle' });

  const plan = useMemo(
    () =>
      finalsPlan({
        files: files.map((f) => ({ name: f.name, size: f.size })),
        assetId,
        targetSourceId: sourceId,
        // The Studio does not know which chapter a clip belongs to: the asset
        // row carries no chapter today. Finals land at the root, and Winnow's
        // own reconcile places them by lineage.
        chapterId: null,
        maxUploadBytes: connection?.capabilities?.limits?.maxUploadBytes ?? null,
      }),
    [files, assetId, sourceId, connection],
  );

  if (!connection) {
    return (
      <p className="m-0 text-[0.78rem] text-muted">
        This clip came from {sourceId}, which is not connected here any more — reconnect it to send the finals back.
      </p>
    );
  }
  const writable = canWriteBack(connection.capabilities);

  async function send() {
    if (!connection || plan.problems.length || !writable) return;
    const client = new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth });
    let sent = 0;
    try {
      for (const [i, item] of plan.items.entries()) {
        setSending({ state: 'sending', index: i });
        await client.upload([{ file: files[i], path: item.path }], {
          originalAssetId: plan.originalAssetId,
          chapterId: plan.chapterId,
        });
        sent += 1;
      }
      await client.reconcile();
      setSending({ state: 'done', sent });
    } catch (err) {
      const login =
        err instanceof WinnowError && err.kind === 'unauthenticated' ? client.loginUrl() : undefined;
      setSending({
        state: 'failed',
        sent,
        message: err instanceof Error ? err.message : String(err),
        login,
      });
    }
  }

  const busy = sending.state === 'sending';
  const label = `Send ${plan.items.length} file${plan.items.length === 1 ? '' : 's'} to ${sourceId} · ${formatBytes(plan.totalBytes)}`;

  return (
    <div className="flex flex-col gap-2 px-2.5 py-2 rounded-paper bg-surface border border-line" role="group" aria-label={`Send to ${sourceId}`}>
      <span className="font-mono text-[0.66rem] tracking-[0.1em] uppercase text-muted">
        back to {sourceId}
      </span>
      {!writable ? (
        <p className="m-0 text-[0.78rem] text-muted">
          Your account on {sourceId} is a viewer; it cannot receive files. Sign in there as an editor and reconnect.
        </p>
      ) : (
        <>
          <ul className="m-0 pl-4 font-mono text-[0.68rem] text-ink-soft tabular-nums">
            {plan.items.map((item) => (
              <li key={item.path}>
                {item.path} · {formatBytes(item.bytes)}
              </li>
            ))}
          </ul>
          {plan.problems.map((p) => (
            <p key={p} className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
              {p}
            </p>
          ))}
          {plan.notes.map((n) => (
            <p key={n} className="m-0 text-[0.74rem] text-faint">
              {n}
            </p>
          ))}
          {sending.state === 'done' ? (
            <p className="m-0 text-[0.78rem] text-[#3f6b3f]" role="status">
              ✓ {sending.sent} file{sending.sent === 1 ? '' : 's'} sent and linked
              {plan.originalAssetId !== null ? ` to capture #${plan.originalAssetId}` : ''} on {sourceId}.
            </p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || plan.problems.length > 0}
                className="px-3.5 py-[0.45rem] inline-flex items-center border border-line-strong rounded-full bg-paper text-ink-soft cursor-pointer text-[0.78rem] font-semibold hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-default"
                title="Upload the finals into this Winnow's finals root and link them to the capture"
              >
                {busy ? `Sending ${sending.index + 1}/${plan.items.length}…` : label}
              </button>
              {sending.state === 'failed' && (
                <span className="text-[0.78rem] text-[#9a3a23]" role="alert">
                  {sending.sent > 0 && `${sending.sent} sent, then: `}
                  {sending.message}{' '}
                  {sending.login && (
                    <a className="font-semibold underline underline-offset-[3px]" href={sending.login} target="_blank" rel="noreferrer">
                      Sign in there
                    </a>
                  )}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
