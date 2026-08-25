import { useCallback, useEffect, useState } from 'react';
import { navigate } from '../../app/use-hash-route';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import { DEFAULT_GUIDES } from '../../shared/overlay/guides';
import { createProjectDoc, type ProjectDoc } from '../../shared/projects/project-types';
import { getProject, listProjects, putProject } from '../../shared/projects/project-store';
import {
  ctaOutro,
  hasHook,
  hookInjection,
  withCtaOutro,
  withHook,
  withoutCtaOutro,
  withoutHook,
} from '../../shared/roadtrip/hook-scene';
import type { CtaSlide } from '../../shared/roadtrip/cta-slide';
import type { Shade } from '../../shared/roadtrip/shades';
import type { TripPost } from '../../shared/roadtrip/trip-types';

interface StudioLinkProps {
  post: TripPost;
  /** The badge exactly as the stage draws it. */
  elements: OverlayElement[];
  shades: Shade[];
  /** The trip's closing call to action, sent as the project's outro. */
  cta: CtaSlide;
  /** The piece's frame ratio — the card is laid out for its own aspect. */
  aspect: number;
  /** The clip this piece is composed over, when it is loaded. */
  file: File | null;
  onChangePost: (post: TripPost) => void;
}

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const button =
  'px-2.5 py-1.5 rounded-paper border border-line-strong bg-paper text-[0.74rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-default';
const quiet =
  'px-2.5 py-1.5 rounded-paper border border-line bg-paper text-[0.74rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink';

/**
 * The bridge to the Studio.
 *
 * The workflow it closes: a clip is graded and given its telemetry overlay in
 * the Studio, the day badge is composed here, and the two used to leave as two
 * files to be joined on a phone. Linking a project lets the badge be SENT into
 * it as an intro scene, so one export carries the grade, the telemetry and the
 * hook (`hook-scene.ts` does the translation).
 *
 * Sending is explicit and repeatable: the badge keeps being edited here, and
 * each send replaces the last one in the project rather than stacking.
 */
export default function StudioLink({
  post,
  elements,
  shades,
  cta,
  aspect,
  file,
  onChangePost,
}: StudioLinkProps) {
  const [projects, setProjects] = useState<ProjectDoc[] | null>(null);
  const [linked, setLinked] = useState<ProjectDoc | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await listProjects();
    setProjects(all);
    setLinked(post.projectId ? (all.find((p) => p.id === post.projectId) ?? null) : null);
  }, [post.projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Write the badge into the project as its intro scene. */
  async function send(openAfter: boolean) {
    if (!post.projectId) return;
    setNote(null);
    setBusy('Sending…');
    try {
      const doc = await getProject(post.projectId);
      if (!doc) {
        setNote('That project is gone from this browser. Link another one.');
        onChangePost({ ...post, projectId: null });
        return;
      }
      let next = withHook(
        doc,
        hookInjection(elements, post.badge.durationSeconds, shades, post.title || 'Road Trip hook'),
      );
      // The closing card goes with the hook — into the project's outro slot —
      // when the piece closes with the CTA. Unticked, a previously sent card
      // is taken back out. An outro the author composed THEMSELVES in the
      // Studio is never overwritten; it is reported instead.
      const card = post.includeCta ? ctaOutro(cta, aspect) : null;
      const applied = withCtaOutro(next, card);
      let ctaHeld: string | null = null;
      if (applied === null) {
        ctaHeld =
          'The closing card stayed here: the project already has an outro of its own.';
      } else {
        next = applied;
      }
      const ok = await putProject(next);
      if (!ok) {
        setNote('The browser refused to save the project.');
        return;
      }
      setLinked(next);
      if (openAfter) navigate(`/studio/open/${encodeURIComponent(next.id)}`);
      else setNote(ctaHeld ? `Sent. ${ctaHeld}` : 'Sent. Open the Studio to export.');
    } finally {
      setBusy(null);
    }
  }

  /** A project around this piece's clip, ready to grade. */
  async function create() {
    setNote(null);
    setBusy('Creating…');
    try {
      const name = post.title.trim() || file?.name.replace(/\.[^.]+$/, '') || `Day ${post.date}`;
      const doc = createProjectDoc(name, post.badge.aspectId, [], DEFAULT_GUIDES);
      // No folder handle, and no remembered media: the clip is already in the
      // shared Library, and asking for a directory here would be a second
      // permission prompt for a file just picked. Recording the ref WITHOUT a
      // folder is worse than recording nothing — the Studio reconciles it
      // against an empty listing and greets a brand-new project with "1 media
      // file not in this folder". The Studio adds the clip from the Library,
      // which is where Road Trip has already pointed it.
      doc.media = { dirHandle: null, files: [], activeId: null, trims: {} };
      const ok = await putProject(doc);
      if (!ok) {
        setNote('The browser refused to save a new project.');
        return;
      }
      onChangePost({ ...post, projectId: doc.id });
      setLinked(doc);
      setNote(
        file
          ? `Project created. Add ${file.name} to it from the Library, grade it, and send the hook when the badge is right.`
          : 'Project created. Send the hook when the badge is right.',
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function unlink() {
    if (post.projectId) {
      const doc = await getProject(post.projectId);
      // Leave the project as it was before the badge arrived — a link that is
      // dropped should not leave a hook (or a sent closing card) nobody can
      // edit any more. The author's own outro survives.
      if (doc) await putProject(withoutCtaOutro(withoutHook(doc)));
    }
    onChangePost({ ...post, projectId: null });
    setLinked(null);
    setNote(null);
  }

  const candidates = projects ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[0.78rem] text-ink-soft">
        Link the Studio project this clip is graded in and the badge can be sent
        there as an intro scene — with the trip's closing card as the
        project's outro when this piece closes on it. One export then carries
        the grade, the telemetry, the hook and the end card — nothing left to
        join afterwards.
      </p>

      {linked ? (
        <>
          <div className="flex items-center gap-2">
            <span className={`${legend} flex-1 truncate`} title={linked.name}>
              {linked.name}
            </span>
            <span className="font-mono text-[0.66rem] text-faint">
              {hasHook(linked) ? 'hook sent' : 'no hook yet'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={button}
              disabled={busy !== null || !elements.length}
              onClick={() => void send(true)}
            >
              {busy ?? '→ Send the hook and open the Studio'}
            </button>
            <button
              type="button"
              className={quiet}
              disabled={busy !== null || !elements.length}
              onClick={() => void send(false)}
            >
              Send only
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => navigate(`/studio/open/${encodeURIComponent(linked.id)}`)}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => void unlink()}
              className="p-0 border-0 bg-transparent text-[0.74rem] text-faint cursor-pointer underline underline-offset-[3px] hover:text-[#9a3a23]"
            >
              Unlink
            </button>
          </div>
          {!elements.length && (
            <span className="text-[0.7rem] text-faint">
              There is no badge to send — the trip's dates cannot be read.
            </span>
          )}
          <span className="text-[0.7rem] text-faint">
            The shades stay here: a Studio scene has one flat scrim, not a
            gradient, so the strongest shade's colour and strength go over as
            that veil and the shape does not.
          </span>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className={legend}>Link an existing project</span>
            <select
              value=""
              disabled={busy !== null || candidates.length === 0}
              onChange={(e) => {
                if (!e.target.value) return;
                onChangePost({ ...post, projectId: e.target.value });
              }}
              className="font-sans text-[0.78rem] px-2 py-1.5 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="">
                {projects === null
                  ? 'Looking…'
                  : candidates.length
                    ? 'Pick a project…'
                    : 'No projects in this browser yet'}
              </option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={button}
            disabled={busy !== null}
            onClick={() => void create()}
          >
            {busy ?? '+ Create a project for this clip'}
          </button>
        </>
      )}

      {note && (
        <p className="m-0 px-2.5 py-2 rounded-paper border border-line bg-paper text-[0.75rem] text-ink-soft">
          {note}
        </p>
      )}
    </div>
  );
}
