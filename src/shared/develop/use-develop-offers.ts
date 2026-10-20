import { useEffect, useMemo, useState } from 'react';
import type { SavedMediaRef } from '../projects/media-ref';
import { carriedIsStale, carriedOn, carriedSource, offersFor, type CarriedEdit, type EditOffer } from './carried-edit';
import { listRolls } from './roll-store';
import type { RollDoc } from './roll-types';

export interface DevelopOffers {
  /** The roll pictures that hold this file with an edit, the latest roll first. */
  offers: EditOffer[];
  /** The edit the host holds, when it was made on this file. */
  held: CarriedEdit | null;
  /** The held edit's picture changed in Develop since it was taken — what an update would take. */
  update: EditOffer | null;
  /** The held edit's roll is not in this browser any more (deleted, or kept elsewhere). */
  orphan: boolean;
}

/**
 * What Develop offers the picture a host shows (item 34 of
 * `docs/lightroom-gaps.md`): the rolls of this browser are read when the
 * picture changes and again whenever the tab comes back — an edit made in
 * Develop in another tab is offered on return, never pushed.
 */
export function useDevelopOffers(media: SavedMediaRef | null, edit: CarriedEdit | null | undefined): DevelopOffers {
  const [rolls, setRolls] = useState<RollDoc[] | null>(null);
  const key = media ? JSON.stringify([media.name, media.size, media.assetId ?? '', media.hash ?? '']) : '';
  const wanted = Boolean(media);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    // A tab return fires `visibilitychange` AND `focus`: one read, not two —
    // each is a clone and a migration of every roll.
    let reading = false;
    const load = () => {
      if (reading) return;
      reading = true;
      void listRolls()
        .then((all) => {
          if (live) setRolls(all);
        })
        .finally(() => {
          reading = false;
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Not on every slide's `key`: the list of rolls does not depend on which
    // picture is open (the memo below filters it), and paging slides re-read
    // the whole roll store each time.
  }, [wanted]);

  return useMemo(() => {
    const held = carriedOn(edit, media);
    if (!media || !rolls) return { offers: [], held, update: null, orphan: false };
    const source = carriedSource(rolls, held);
    const update =
      held && source && carriedIsStale(held, source.roll, source.picture)
        ? (offersFor([source.roll], media).find((o) => o.picture.id === source.picture.id) ?? null)
        : null;
    return { offers: offersFor(rolls, media), held, update, orphan: Boolean(held && !source) };
    // `key` stands for `media`, whose object a host rebuilds per render.
  }, [rolls, key, edit]);
}
