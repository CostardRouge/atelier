/**
 * Cloning a Studio project: the same document under another name, in any
 * source.
 *
 * Unlike a trip (which goes through its backup file because pictures and
 * thumbnails live outside the document), a project IS one self-contained
 * document — overlays, scenes, look, export matrix, the list of clips with
 * their trims, developments and renditions — so the copy is the document
 * itself with a new identity. Everything is deep-cloned except the two things
 * that are this device's and never plain data:
 *
 * - **the folder handle** is kept as the same handle: the clone points at the
 *   same footage, which is the point of cloning a project to try another cut.
 *   It never reaches an instance (`toWireDoc` strips it), so a clone kept
 *   elsewhere asks to be pointed at the footage on another device, like any
 *   project kept there;
 * - **the baked thumbnail** is the same Blob (immutable), so the card has its
 *   preview at once.
 *
 * What it does NOT carry: the id, the timestamps and the source (set here),
 * and any link from a Trips piece — a piece names the project it feeds by id,
 * so it keeps feeding the original.
 *
 * Pure and DOM-free.
 */

import type { ProjectDoc } from './project-types';

export function cloneProject(
  project: ProjectDoc,
  options: { name: string; sourceId: string; now?: number },
): ProjectDoc {
  const now = options.now ?? Date.now();
  const { thumbnail, media, ...rest } = project;
  const { dirHandle, ...mediaRest } = media;
  const copy = structuredClone({ ...rest, media: mediaRest });
  return {
    ...copy,
    id: crypto.randomUUID(),
    name: options.name.trim(),
    sourceId: options.sourceId,
    createdAt: now,
    updatedAt: now,
    media: { ...copy.media, dirHandle },
    thumbnail,
  };
}
