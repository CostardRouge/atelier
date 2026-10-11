import { CommandError, type CommandSpec } from '../shared/commands/registry';
import type { AssetLibrary } from '../shared/library/AssetLibraryContext';
import { assetRemoteId, assetSourceId } from '../shared/library/asset-source';
import { fileBaseName, type Asset } from '../shared/library/assets';
import type { MediaActions } from '../shared/sources/media-scope';
import type { WinnowClient } from '../shared/sources/winnow/client';
import type { WinnowConnection } from '../shared/sources/winnow/store';
import { materialize } from '../shared/sources/winnow/materialize';

/** How many Winnow media one call may fetch into the Library: each is a download. */
const MAX_FETCH = 40;

/** An asset as an agent reads it. */
function assetSummary(a: Asset, lib: AssetLibrary) {
  return {
    id: a.id,
    name: a.baseName,
    kind: a.kind,
    files: [a.parts.image, a.parts.video, a.parts.srt, ...(a.parts.siblings ?? [])].filter(Boolean).map((f) => (f as File).name),
    source: assetSourceId(a),
    winnow: assetRemoteId(a),
    active: lib.activeId === a.id,
    selected: lib.selection.has(a.id),
  };
}

export interface LibraryCommandDeps {
  lib: () => AssetLibrary;
  winnow: () => { client: WinnowClient | null; connection: WinnowConnection | null };
  actions: () => MediaActions | null;
}

/**
 * The LIBRARY's commands (`shared/commands/`) — the shared pool every tool
 * reads its media from, registered by the shell for the whole session: what
 * it holds, fetching an instance's media into it, which one is active, and
 * the verbs the open tool offers on a picture (`MediaActions` — Trips'
 * Reel / Carousel / Photo, Develop's new roll), run exactly as the sheet's
 * buttons run them: with the media already in the Library and ACTIVE.
 */
export function libraryCommands(deps: LibraryCommandDeps): CommandSpec[] {
  const find = (id: string): Asset => {
    const lib = deps.lib();
    const a = lib.assets.find((x) => x.id === id.toLowerCase() || x.baseName === id);
    if (!a) throw new CommandError('invalid', `the Library holds no "${id}" — library.assets lists it`);
    return a;
  };
  return [
    {
      id: 'library.assets',
      title: 'What the Library holds',
      description: 'The media of the shared Library (in this tab, not saved): id, name, kind, its files, where it came from (local, or a Winnow host and asset id), whether it is active or selected.',
      run: () => {
        const lib = deps.lib();
        return { active: lib.activeId, assets: lib.assets.map((a) => assetSummary(a, lib)) };
      },
    },
    {
      id: 'library.addFromWinnow',
      title: 'Fetch Winnow media into the Library',
      description: `Download media of the connected Winnow (ids from winnow.assets) into the Library, as their proxy (default) or their original, so any tool can use them — Trips' pieces and the Studio read the Library. At most ${MAX_FETCH} a call. A media already there is not fetched again. The last one becomes active.`,
      params: {
        ids: { type: 'numbers', description: 'Winnow asset ids.', maxItems: MAX_FETCH },
        fidelity: { type: 'string', description: 'proxy (light, the default) or original (the camera file).', enum: ['proxy', 'original'], optional: true },
      },
      available: () => (deps.winnow().client ? true : 'no Winnow is connected — connect one on #/sources'),
      run: async (p) => {
        const { client, connection } = deps.winnow();
        if (!client || !connection) throw new CommandError('unavailable', 'no Winnow is connected');
        const ids = p.ids as number[];
        const held = new Map(deps.lib().assets.flatMap((a) => {
          const remote = assetRemoteId(a);
          return remote ? [[remote, a.id] as const] : [];
        }));
        const rows = await client.assetsByIds(ids);
        const missing = ids.filter((id) => !rows.some((r) => r.id === id));
        const added: string[] = [];
        const already: string[] = [];
        const files: File[] = [];
        for (const row of rows) {
          const have = held.get(`${connection.id}/${row.id}`);
          if (have) {
            already.push(have);
            continue;
          }
          const got = await materialize(client, connection.id, row, { fidelity: p.fidelity === 'original' ? 'original' : 'proxy' });
          if (!got.length) continue;
          files.push(...got);
          added.push(fileBaseName(got[0].name).toLowerCase());
        }
        const lib = deps.lib();
        if (files.length) lib.addFiles(files);
        const last = added[added.length - 1] ?? already[already.length - 1] ?? null;
        if (last) lib.setActive(last);
        return { added, alreadyInLibrary: already, ...(missing.length ? { notFound: missing } : {}), active: last };
      },
    },
    {
      id: 'library.activate',
      title: 'Make a media active',
      description: 'Make a Library media the active one — what the open tool shows or takes (a Trips slide, the Studio’s clip) and what library.runAction acts on.',
      params: { asset: { type: 'string', description: 'The asset id or name, from library.assets.' } },
      run: (p) => {
        const a = find(p.asset as string);
        deps.lib().setActive(a.id);
        return { active: a.id };
      },
    },
    {
      id: 'library.actions',
      title: 'What the open tool makes from a picture',
      description: 'The verbs the open tool offers on a picture (e.g. Trips on a day: Reel, Carousel, Photo, Locate; Develop: a new roll) — what the buttons under a picture looked at large do. Empty when the open screen offers none.',
      run: () => {
        const a = deps.actions();
        return a ? { heading: a.heading, actions: a.actions.map((x) => ({ id: x.id, label: x.label, hint: x.hint ?? null })) } : { heading: null, actions: [] };
      },
    },
    {
      id: 'library.runAction',
      title: 'Make something from a picture',
      description: 'Run one of library.actions on a Library media (the active one unless named): it is made active first, then the verb runs exactly as its button would. Follow with the tool’s own commands, or app.status to see where it went.',
      params: {
        action: { type: 'string', description: 'The action id, from library.actions.' },
        asset: { type: 'string', description: 'The asset id or name; the active one when absent.', optional: true },
      },
      available: () => (deps.actions()?.actions.length ? true : 'the open screen offers nothing to make from a picture'),
      run: async (p) => {
        const actions = deps.actions();
        const action = actions?.actions.find((x) => x.id === p.action);
        if (!action) throw new CommandError('invalid', `no action "${String(p.action)}" — the open screen offers ${actions?.actions.map((x) => x.id).join(', ') || 'none'}`);
        const lib = deps.lib();
        const asset = typeof p.asset === 'string' ? find(p.asset) : lib.assets.find((x) => x.id === lib.activeId);
        if (!asset) throw new CommandError('invalid', 'no media is active — name one with asset');
        lib.setActive(asset.id);
        // `run` reads the active media after the render the activation causes,
        // as the sheet's own buttons do (it is called in the same tick there).
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        action.run();
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        return { ran: action.id, on: asset.id, route: window.location.hash.slice(1) || '/' };
      },
    },
  ];
}
