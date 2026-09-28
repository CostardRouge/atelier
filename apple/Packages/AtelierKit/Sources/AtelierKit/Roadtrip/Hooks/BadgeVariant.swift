// The badge variant — the hook every piece has always had, expressed against
// the engine's own contract. Port of the variant in
// `src/shared/roadtrip/hooks/badge.tsx` (its picker `Sketch` — a word, a
// numeral that dominates, a place under it — is the app's SwiftUI view).
//
// It draws nothing of its own and rewrites nothing: the six text pieces are
// built by the badge's element builder and painted by the overlay engine
// exactly as before, so adopting the engine changes no pixel. That is the
// point — a seam is only known to be right once something ordinary passes
// through it unharmed. It has no options either, so it has no panel.

import Foundation

/// The web's `badgeVariant`.
public let badgeVariant = HookVariant(
    id: defaultHookId,
    name: "Badge",
    tagline: "The counter, the place and the day — nothing behind them",
    defaults: [:],
    needs: HookNeeds(),
    owns: .layer,
    prepare: { _, _ in HookRender(seconds: 0) }
)
