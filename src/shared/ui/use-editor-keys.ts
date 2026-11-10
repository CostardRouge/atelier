import { useEffect, useRef } from 'react';
import { describeKeyTarget } from '../media/transport-keys';
import { editorKeyOf, type EditorKey } from './editor-keys';

/**
 * An editor's keys, bound once on `window` (`editor-keys.ts` decides who owns
 * a press). The handler answers `true` when it ACTED: the press is then
 * `preventDefault`ed, so the page does not scroll under Space or an arrow and
 * a button a click left focused is not pressed again by Enter. Anything else
 * leaves the press to the browser.
 *
 * It stands down while a modal sheet is up (`aria-modal`): the sheet's own
 * keys (`use-dialog-keys.ts`) are the only ones then — this listener was
 * bound first, so it would otherwise answer the press BEFORE the sheet and
 * play, deselect or delete behind it.
 *
 * The handler is read through a ref: a host whose handler closes over its
 * state does not re-bind the listener on every render.
 */
export default function useEditorKeys(handler: (key: EditorKey, event: KeyboardEvent) => boolean | void, enabled = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const key = editorKeyOf({
        key: e.key,
        repeat: e.repeat,
        defaultPrevented: e.defaultPrevented,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: describeKeyTarget(e.target),
      });
      if (!key) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (latest.current(key, e) === true) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
