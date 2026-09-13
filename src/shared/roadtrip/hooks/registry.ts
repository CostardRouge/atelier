/**
 * The hook registry — the one list a variant is added to.
 *
 * Same shape as the shell's tool registry: one entry drives the picker card,
 * the options panel, the paint and (later) the sound. A tool imports THIS, not
 * a variant, so adding one touches two files.
 */

import { badgeVariant } from './badge';
import { scrubVariant } from './scrub';
import { routeVariant } from './route';
import {
  DEFAULT_HOOK_ID,
  defaultHookLayers,
  foldHook,
  type HookContext,
  type HookLayer,
  type HookRender,
  type HookVariant,
  type ResolvedHook,
} from './hook-variant';

export const HOOK_VARIANTS: readonly HookVariant[] = [badgeVariant, scrubVariant, routeVariant];

export function hookVariantById(id: string): HookVariant | undefined {
  return HOOK_VARIANTS.find((variant) => variant.id === id);
}

/**
 * Prepare a piece's layers.
 *
 * An **unknown id is skipped**: a trip written by a newer build must open here
 * and lose its opener, never fail to open. If nothing resolves — an empty list,
 * or only ids this build does not have — the default badge stands in, so a
 * piece can never be left with no hook at all.
 *
 * A `frame` owner replaces the picture. Several is a conflict only a stack can
 * produce, and it resolves to the LAST one, the rule `stageAt` already uses for
 * overlapping legs.
 */
export function resolveHook(
  layers: readonly HookLayer[] | undefined,
  ctx: HookContext,
): ResolvedHook {
  const resolved: { variant: HookVariant; layer: HookLayer }[] = [];
  for (const layer of layers ?? []) {
    const variant = hookVariantById(layer.id);
    if (variant) resolved.push({ variant, layer });
  }
  if (resolved.length === 0) {
    const fallback = hookVariantById(DEFAULT_HOOK_ID);
    if (fallback) {
      resolved.push({ variant: fallback, layer: defaultHookLayers()[0] });
    }
  }

  const renders: HookRender[] = resolved.map(({ variant, layer }) =>
    variant.prepare(layer.options ?? {}, ctx),
  );
  const ownsFrame = resolved.some(({ variant }) => variant.owns === 'frame');
  return foldHook(renders, ownsFrame);
}

/** Why a variant cannot run on this piece, or null. Drives the picker's cards. */
export function hookUnmet(variant: HookVariant, ctx: HookContext): string | null {
  return variant.unmet?.(ctx) ?? null;
}
