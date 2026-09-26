// The closing slide of a carousel, as the trip document stores it — port of
// the stored half of `src/shared/roadtrip/cta-slide.ts`.
//
// Types + reader only; the behaviour of `cta-slide.ts` (the layout of its
// lines and its QR square for a frame, the deterministic element ids) is
// ported later INTO THIS FILE.
//
// Rules kept:
// - It is edited ONCE on the trip and appended to every deck that asks for
//   it: a signature re-authored per post drifts, and nobody retypes the same
//   last slide 250 times.
// - An empty URL is no QR and no line; the card carries no photograph, so the
//   flat ground keeps the QR readable.

import Foundation

public struct CtaSlide: Equatable, Sendable {
    public var headline: String
    public var body: String
    /// What the QR encodes and the slide prints. Empty = no QR, no line.
    public var url: String
    public var showQr: Bool
    public var background: String
    public var ink: String

    public init(headline: String, body: String, url: String, showQr: Bool, background: String, ink: String) {
        self.headline = headline; self.body = body; self.url = url; self.showQr = showQr
        self.background = background; self.ink = ink
    }

    public var json: JSONValue {
        .object([
            "headline": .string(headline), "body": .string(body), "url": .string(url),
            "showQr": .bool(showQr), "background": .string(background), "ink": .string(ink),
        ])
    }
}

/// The web's `DEFAULT_CTA`.
public let defaultCta = CtaSlide(
    headline: "Made with Atelier",
    body: "Free and open source. Runs in your browser — your photos never leave your machine.",
    url: "https://atelier.steeve.website",
    showQr: true,
    background: "#100f0d",
    ink: "#f4f0e7"
)

/// A stored closing card read back; a missing or junk field takes the default's.
public func readCtaSlide(_ raw: JSONValue?) -> CtaSlide {
    let o = raw?.objectValue ?? [:]
    let d = defaultCta
    return CtaSlide(
        headline: o["headline"]?.stringValue ?? d.headline,
        body: o["body"]?.stringValue ?? d.body,
        url: o["url"]?.stringValue ?? d.url,
        showQr: o["showQr"]?.boolValue ?? d.showQr,
        background: o["background"]?.stringValue ?? d.background,
        ink: o["ink"]?.stringValue ?? d.ink
    )
}
