// The badge's elements at a moment, for a hook that rewrites its text. Port
// of `src/shared/roadtrip/hooks/hook-elements.ts`.
//
// Elements are normally built once per edit and held: the badge does not
// change as the clock runs. A variant that steps the numeral changes that, and
// the answer is NOT a time dependency in the view's state — which would
// rebuild every element sixty times a second for every piece, rewriting or
// not. It is a function of `t` handed to the renderer, built only when some
// layer actually rewrites (`ResolvedHook.rewrites`), and called at paint time.
// The ids stay deterministic (`piece:<key>`), so a tap on the stage still
// lands on the numeral while it is counting.
//
// The web builds the elements with `badgeElements(content, layout, aspect,
// styles, durationSeconds, cascade)`. That builder is `badge-layout.ts`'s
// behaviour, not ported yet (`BadgeLayout.swift` holds its stored half), so
// the builder is INJECTED here: the caller hands the one it has. When
// `badgeElements` lands, the web's own signature is one line beside it —
// `hookElementsAt(hook, content) { badgeElements($0, layout, aspect, styles,
// durationSeconds, cascade) }`.

import Foundation

/// The badge's elements at `t` seconds into the hook.
public typealias ElementsAt = (_ tSeconds: Double) -> [OverlayElement]

/// A per-frame element builder, or nil when nothing rewrites the badge — the
/// caller then keeps the static elements it already has.
public func hookElementsAt(_ hook: ResolvedHook?, _ content: BadgeContent?,
                           elements build: @escaping (BadgeContent) -> [OverlayElement]) -> ElementsAt? {
    guard let hook, hook.rewrites, let content else { return nil }
    return { t in
        guard let at = hook.contentAt(content, t) else { return [] }
        return build(at)
    }
}
