// The closing slide of a carousel — port of `src/shared/roadtrip/cta-slide.ts`:
// the record the trip stores and its reader, then (`MARK: - layout`) the card
// laid out for a frame as overlay elements plus a QR square.
//
// Rules kept:
// - It is edited ONCE on the trip and appended to every deck that asks for
//   it: a signature re-authored per post drifts, and nobody retypes the same
//   last slide 250 times.
// - An empty URL is no QR and no line; the card carries no photograph, so the
//   flat ground keeps the QR readable.
// - A line the author left empty takes no space; a sentence is WRAPPED here
//   (the engine never wraps), the block is centred whatever it holds, and
//   every line pins its own ink and flatness against the trip's title style.
// - A link too long for a QR is SAID (`qrProblem`), never a blank square.
// - Ids are deterministic, `cta:<role>:<line>`, like the badge's pieces.

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

// MARK: - layout

/// Where the QR sits, in fractions of the frame.
public struct QrPlacement: Equatable, Sendable {
    /// Left edge and top edge, as fractions of width and height.
    public var x: Double
    public var y: Double
    /// Side length as a fraction of the frame's SHORTER side.
    public var sizeFrac: Double
    public var matrix: QrMatrix

    public init(x: Double, y: Double, sizeFrac: Double, matrix: QrMatrix) {
        self.x = x; self.y = y; self.sizeFrac = sizeFrac; self.matrix = matrix
    }
}

public struct CtaLayout: Equatable, Sendable {
    public var elements: [OverlayElement]
    public var qr: QrPlacement?
    /// Why there is no QR, when the author asked for one.
    public var qrProblem: String?

    public init(elements: [OverlayElement], qr: QrPlacement?, qrProblem: String?) {
        self.elements = elements; self.qr = qr; self.qrProblem = qrProblem
    }
}

/// Sizes as fractions of the shorter side. The QR is the hero, so it is big.
private let ctaHeadlineSize = 0.075
private let ctaBodySize = 0.04
private let ctaUrlSize = 0.032
private let ctaQrSize = 0.4
/// Share of the frame's width a line may use, leaving a margin either side.
private let ctaTextWidth = 0.84
/// Line spacing as a multiple of the font size.
private let ctaLineHeight = 1.3

/// Wrap a sentence to the frame, in lines — in a frame of arbitrary pixel
/// size, only the ratio matters.
private func ctaWrap(_ text: String, _ sizeFrac: Double, _ aspect: Double) -> [String] {
    let w = aspect >= 1 ? 1000 : 1000 * aspect
    let h = aspect >= 1 ? 1000 / aspect : 1000
    let fontPx = sizeFrac * min(w, h)
    return wrapText(text, maxChars: charBudget(widthPx: w * ctaTextWidth, fontPx: fontPx))
}

/// The three things a closing card says, each possibly wrapped over lines.
public enum CtaRole: String, CaseIterable, Sendable {
    case headline, body, url
}

/// A card line an element id names.
public struct CtaLine: Equatable, Sendable {
    public var role: CtaRole
    public var line: Int

    public init(role: CtaRole, line: Int) { self.role = role; self.line = line }
}

private let ctaIdPrefix = "cta:"

/// A card line's element id: `cta:<role>:<line index>`.
public func ctaElementId(_ role: CtaRole, _ line: Int) -> String {
    "\(ctaIdPrefix)\(role.rawValue):\(line)"
}

/// The role and line an element id names, or nil for any other id. The
/// web's `split(':')` destructured into two, the index read by `Number()`.
public func ctaRoleFromElementId(_ id: String) -> CtaLine? {
    guard id.hasPrefix(ctaIdPrefix) else { return nil }
    let parts = id.dropFirst(ctaIdPrefix.count).split(separator: ":", omittingEmptySubsequences: false)
    guard let role = parts.first.flatMap({ CtaRole(rawValue: String($0)) }) else { return nil }
    let index: JSONValue? = parts.count > 1 ? .string(String(parts[1])) : nil
    let line = JSLoose.number(index)
    guard line.isFinite, line == line.rounded(), line >= 0, line < 9e15 else { return nil }
    return CtaLine(role: role, line: Int(line))
}

/// One line of the card: centred, its own ink, no panel and no glow, pinned
/// so no title style can bring them back.
private func ctaLine(_ text: String, _ id: String, _ y: Double, _ sizeFrac: Double, _ color: String,
                     _ anchor: OverlayAnchor = .topCenter) -> OverlayElement {
    var el = createTextElement(text, id: id)
    el.anchor = anchor
    el.x = 0.5
    el.y = y
    el.sizeFrac = sizeFrac
    el.color = color
    el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0)", padFrac: 0)
    el.styleOverrides = ["color", "legibility", "glow"]
    el.glowAmount = 0
    return el
}

/// The closing slide for a frame of the given aspect. Lines the author left
/// empty are skipped entirely rather than reserving space.
public func ctaLayout(_ cta: CtaSlide, _ aspect: Double) -> CtaLayout {
    var elements: [OverlayElement] = []
    let toHeight = { (frac: Double) in frac * min(aspect, 1) }
    let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }

    let headline = ctaWrap(trim(cta.headline), ctaHeadlineSize, aspect).filter { !$0.isEmpty }
    let body = ctaWrap(trim(cta.body), ctaBodySize, aspect).filter { !$0.isEmpty }
    let url = trim(cta.url)
    let qrSide = toHeight(ctaQrSize)

    var matrix: QrMatrix? = nil
    var qrProblem: String? = nil
    if cta.showQr && !url.isEmpty {
        if !qrFits(url) {
            qrProblem = "That link is too long to put in a QR code (\(url.utf16.count) characters; the limit is 213)."
        } else if let encoded = encodeQr(url) {
            matrix = encoded
        } else {
            qrProblem = "That link cannot be encoded as a QR code."
        }
    }

    /// A stacked group of lines: its height.
    let groupHeight = { (lines: [String], sizeFrac: Double) in
        lines.isEmpty ? 0 : toHeight(sizeFrac) * ctaLineHeight * Double(lines.count)
    }

    let gap = 0.045
    var blockHeight = groupHeight(headline, ctaHeadlineSize)
    blockHeight += headline.isEmpty ? 0 : gap
    blockHeight += matrix != nil ? qrSide + gap : 0
    blockHeight += groupHeight(body, ctaBodySize)
    blockHeight += body.isEmpty ? 0 : gap * 0.6
    blockHeight += url.isEmpty ? 0 : toHeight(ctaUrlSize) * ctaLineHeight

    var cursor = 0.5 - blockHeight / 2

    func place(_ lines: [String], _ role: CtaRole, _ sizeFrac: Double) {
        for (i, text) in lines.enumerated() {
            elements.append(ctaLine(text, ctaElementId(role, i), cursor, sizeFrac, cta.ink))
            cursor += toHeight(sizeFrac) * ctaLineHeight
        }
    }

    place(headline, .headline, ctaHeadlineSize)
    if !headline.isEmpty { cursor += gap }

    var qr: QrPlacement? = nil
    if let matrix {
        // x is a fraction of the WIDTH, so the square's own width has to be
        // converted back out of the shorter side to centre it.
        let widthFrac = ctaQrSize * min(1 / aspect, 1)
        qr = QrPlacement(x: 0.5 - widthFrac / 2, y: cursor, sizeFrac: ctaQrSize, matrix: matrix)
        cursor += qrSide + gap
    }

    place(body, .body, ctaBodySize)
    if !body.isEmpty { cursor += gap * 0.6 }
    if !url.isEmpty { place([url], .url, ctaUrlSize) }

    return CtaLayout(elements: elements, qr: qr, qrProblem: qrProblem)
}
