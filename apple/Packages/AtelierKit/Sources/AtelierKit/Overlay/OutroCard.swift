// The outro — a closing card appended AFTER the last frame of footage. Port
// of `src/shared/overlay/outro-card.ts`: the model, the seeding and stacking,
// the QR's resolution and the card's reader; the PAINT (`prepareOutro().draw`,
// `drawQr`) is the app's.
//
// The mirror of the intro, one level simpler: the intro is a scene played
// OVER the running picture, the outro a flat card the export keeps encoding
// once the footage has run out (`Media/ExportTail.swift` does the time
// arithmetic). A project is intro · footage · closing card; Road Trip's call
// to action reaches this slot as an injection.
//
// The card is ordinary overlay elements over a flat ground, plus an optional
// QR. Elements keep every engine capability (windows count from the card's
// own first frame), but the project THEME does not apply: the card stays
// legible whatever look the footage's titles wear, so its lines are PINNED.
//
// The QR is stored as the URL it encodes, never as a matrix: the matrix is
// derived deterministically (`Lib/QR.swift`), so the document stays readable
// and a changed link cannot drift from its code. A link too long to encode is
// refused with a sentence, never truncated into a code that scans to half a URL.

import Foundation

/// The QR square on a card: the link, and where the code sits.
public struct OutroQr: Equatable, Sendable {
    /// What the code encodes and nothing else. Empty = no QR.
    public var url: String
    /// Left edge as a fraction of the WIDTH, top edge of the HEIGHT.
    public var x: Double
    public var y: Double
    /// Side as a fraction of the frame's SHORTER side.
    public var sizeFrac: Double
    public var dark: String
    public var light: String

    public init(url: String, x: Double, y: Double, sizeFrac: Double, dark: String, light: String) {
        self.url = url; self.x = x; self.y = y; self.sizeFrac = sizeFrac; self.dark = dark; self.light = light
    }
}

public struct OutroCard: Equatable, Sendable {
    /// Seconds the card holds after the footage's last frame.
    public var seconds: Double
    /// The flat ground under everything.
    public var background: String
    /// Ordinary overlay elements; windows count from the card's own first
    /// frame, and the project theme is deliberately NOT applied.
    public var elements: [OverlayElement]
    public var qr: OutroQr?
    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(seconds: Double, background: String, elements: [OverlayElement], qr: OutroQr?) {
        self.seconds = seconds; self.background = background; self.elements = elements; self.qr = qr
    }
}

/// Where a QR square goes and what it says, encoded — the web's `QrDraw`
/// (`draw-qr.ts`). Fractions of the frame; the app snaps every module to a
/// whole pixel and draws the four-module quiet zone.
public struct QrDraw: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var sizeFrac: Double
    public var matrix: QrMatrix
    public var dark: String
    public var light: String
}

/// The web's `OUTRO_SECONDS_DEFAULT`.
public let outroSecondsDefault = 4.0

/// The ink a seeded card writes with, on the ground it seeds.
private let cardBackground = "#100f0d"
private let cardInk = "#f4f0e7"

/// One centred line of the card: no legibility box and no glow, pinned so no
/// theme can bring them back — the card's ink stays its own.
/// `color` nil is the card's own ink.
public func outroLine(_ text: String, _ y: Double, _ sizeFrac: Double, color: String? = nil, id: String? = nil) -> OverlayElement {
    var el = createTextElement(text, id: id)
    el.anchor = .topCenter
    el.x = 0.5
    el.y = y
    el.sizeFrac = sizeFrac
    el.color = color ?? cardInk
    el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0)", padFrac: 0)
    el.styleOverrides = [ThemableKey.color.rawValue, ThemableKey.legibility.rawValue, ThemableKey.glow.rawValue]
    el.glowAmount = 0
    return el
}

/// A fresh card: one editable headline, no QR — a starting point, not a look.
public func createOutroCard(_ headline: String) -> OutroCard {
    OutroCard(seconds: outroSecondsDefault, background: cardBackground, elements: [outroLine(headline, 0.42, 0.06)], qr: nil)
}

/// The card with one more line, under the lowest text it already holds (or
/// opening the card when it holds none), never past 0.92 of the height.
public func withOutroLine(_ card: OutroCard, _ text: String = "New line") -> OutroCard {
    var bottom = 0.36
    var size = 0.038
    for el in card.elements where el.kind == .text && el.y >= bottom {
        bottom = el.y
        size = el.sizeFrac
    }
    var out = card
    out.elements.append(outroLine(text, min(0.92, bottom + size * 1.6), 0.038))
    return out
}

/// A card resolved once (the QR encode is deterministic but not free). The
/// web's `PreparedOutro` minus its `draw`, which is the app's: paint the
/// ground, then the elements with NO cue and NO theme at the card's own time
/// (origin 0), then the QR.
public struct PreparedOutro: Equatable, Sendable {
    public var card: OutroCard
    /// The encoded code, ready to paint — or nil (no URL, or refused).
    public var qr: QrDraw?
    /// The sentence to show when a QR was asked for and cannot be drawn.
    public var qrProblem: String?
}

public func prepareOutro(_ card: OutroCard) -> PreparedOutro {
    var qr: QrDraw? = nil
    var qrProblem: String? = nil
    let url = card.qr?.url.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if let q = card.qr, !url.isEmpty {
        if !qrFits(url) {
            // `url.length` on the web counts UTF-16 units.
            qrProblem = "That link is too long to put in a QR code (\(url.utf16.count) characters; the limit is 213)."
        } else if let matrix = encodeQr(url) {
            qr = QrDraw(x: q.x, y: q.y, sizeFrac: q.sizeFrac, matrix: matrix, dark: q.dark, light: q.light)
        } else {
            qrProblem = "That link cannot be encoded as a QR code."
        }
    }
    return PreparedOutro(card: card, qr: qr, qrProblem: qrProblem)
}

// MARK: - JSON

private let outroKeys: Set<String> = ["seconds", "background", "elements", "qr"]

/// A stored QR read back — nil when it is not a record; a missing field takes
/// a centred, black-on-white code's value.
public func readOutroQr(_ v: JSONValue?) -> OutroQr? {
    guard let o = v?.objectValue else { return nil }
    typealias J = OverlayJSON
    return OutroQr(url: J.string(o, "url") ?? "", x: J.number(o, "x") ?? 0.35, y: J.number(o, "y") ?? 0.55,
                   sizeFrac: J.number(o, "sizeFrac") ?? 0.3, dark: J.string(o, "dark") ?? "#000000",
                   light: J.string(o, "light") ?? "#ffffff")
}

/// A stored card read back — nil when it is not a record (the web's
/// `isRecord(raw.outro) ? raw.outro : null`). A missing field takes a seeded
/// card's value; unreadable elements are left out.
public func readOutroCard(_ v: JSONValue?) -> OutroCard? {
    guard let o = v?.objectValue else { return nil }
    var card = OutroCard(
        seconds: OverlayJSON.number(o, "seconds") ?? outroSecondsDefault,
        background: OverlayJSON.string(o, "background") ?? cardBackground,
        elements: readOverlayElements(o["elements"]),
        qr: readOutroQr(o["qr"])
    )
    card.carried = o.filter { !outroKeys.contains($0.key) }
    return card
}

extension OutroQr {
    public var json: JSONValue {
        .object([
            "url": .string(url), "x": .number(x), "y": .number(y), "sizeFrac": .number(sizeFrac),
            "dark": .string(dark), "light": .string(light),
        ])
    }
}

extension OutroCard {
    /// `qr` is written `null` when there is none, as the web writes it.
    public var json: JSONValue {
        var o = carried
        o["seconds"] = .number(seconds)
        o["background"] = .string(background)
        o["elements"] = .array(elements.map(\.json))
        o["qr"] = qr?.json ?? .null
        return .object(o)
    }
}
