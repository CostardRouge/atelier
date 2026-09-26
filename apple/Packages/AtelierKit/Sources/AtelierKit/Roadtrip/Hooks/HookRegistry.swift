// The hook registry — the one list a variant is added to. Port of
// `src/shared/roadtrip/hooks/registry.ts`.
//
// Same shape as the shell's tool registry: one entry drives the picker card,
// the options panel, the paint and the sound. A screen reads THIS, not a
// variant, so adding one touches two files.
//
// The web registers four: the badge, Défilé (the scrub), Virée (the drive)
// and the Itinerary (the map). The kernel registers the variants whose PLANS
// it holds — the badge, Défilé and the Itinerary (`MapVariant.swift`). Virée
// joins the list when `drive-plan.ts` lands; until then a trip holding one
// opens here and plays the badge in its place, by the same rule that lets a
// trip from a newer build open: an id this build does not know is skipped,
// never fatal.

import Foundation

/// Every variant this build can play, in the web's picker order.
public let hookVariants: [HookVariant] = [
    badgeVariant,
    scrubVariant,
    // driveVariant — Virée, when `drive-plan.ts` lands (`DrivePlan.swift`).
    mapVariant,
]

public func hookVariantById(_ id: String) -> HookVariant? {
    hookVariants.first { $0.id == id }
}

/// Prepare a piece's layers.
///
/// An **unknown id is skipped**: a trip written by a newer build must open here
/// and lose its opener, never fail to open. If nothing resolves — an empty
/// list, or only ids this build does not have — the default badge stands in,
/// so a piece can never be left with no hook at all.
///
/// A `frame` owner replaces the picture. Several is a conflict only a stack can
/// produce, and it resolves to the LAST one, the rule `stageAt` already uses
/// for overlapping legs.
public func resolveHook(_ layers: [HookLayer]?, _ ctx: HookContext) -> ResolvedHook {
    var resolved: [(variant: HookVariant, layer: HookLayer)] = []
    for layer in layers ?? [] {
        if let variant = hookVariantById(layer.id) { resolved.append((variant, layer)) }
    }
    if resolved.isEmpty, let fallback = hookVariantById(defaultHookId), let layer = defaultHookLayers().first {
        resolved.append((fallback, layer))
    }
    let renders = resolved.map { $0.variant.prepare($0.layer.options, ctx) }
    let ownsFrame = resolved.contains { $0.variant.owns == .frame }
    return foldHook(renders, ownsFrame)
}

/// Why a variant cannot run on this piece, or nil. Drives the picker's cards.
public func hookUnmet(_ variant: HookVariant, _ ctx: HookContext) -> String? {
    variant.unmet?(ctx) ?? nil
}
