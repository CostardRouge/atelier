// What a roll DELIVERS, decided before a pixel is read — the part of
// `src/shared/develop/roll-export.ts` that `DeliverySource.swift` left for
// this port: the roll's CAPPED delivery (`rollOutputSize`, `cropZoneSize`,
// `deliveredLayout`, `deliveryHeadroom`, `capFor`, `deliverySummary`), the
// file's name (`exportName`) and the run's sentence (`describeRun`).
// `choosePixels`, `originalPixels`, `pixelHeadroom`, `deliversLine`,
// `sourceLabel`, `originalLabel` and `DeliverySummary` are
// `DeliverySource.swift`'s and are reused here, never written twice.
//
// The rules it keeps (`develop-roll.md`, `develop-output.md`):
// - a size is a CAP read against the picture's own delivered frame, and a
//   picture is never upscaled to reach it;
// - a crop leaves at the source's OWN density — a zone of 1200 px on a
//   6000 px picture is 1200 px, never blown up to the aspect box — inside its
//   border, which the file counts;
// - the upscale question is asked against the frame the ORIGINAL could give,
//   which is what was asked for; a RAW original is weighed only through the
//   render inside it, once measured;
// - a delivered picture is named EXACTLY after the picture it came from
//   (`DJI_0101.JPG` → `DJI_0101.jpg`), no word added.
//
// The web's `{ w, h }` and `{ width, height }` are both the kernel's `Size`.

import Foundation

/// `Math.round`: the nearest integer, a half going UP.
private func rollExportRound(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

/// The frame a picture delivers into: the box of `aspectRatio` the source
/// covers at its own density (a ratio of 0 or less is the source's own),
/// capped to `longEdge` — never upscaled, so a small file asked for 4096
/// delivers what it has.
public func rollOutputSize(_ src: Size, _ aspectRatio: Double, _ longEdge: Double?) -> Size {
    if src.width <= 0 || src.height <= 0 { return .zero }
    let ratio = aspectRatio > 0 ? aspectRatio : src.width / src.height
    var w = src.width
    var h = src.width / ratio
    if h > src.height {
        h = src.height
        w = src.height * ratio
    }
    let long = max(w, h)
    let cap: Double
    if let longEdge, longEdge > 0 { cap = min(longEdge, long) } else { cap = long }
    let k = cap / long
    return Size(max(1, rollExportRound(w * k)), max(1, rollExportRound(h * k)))
}

/// The crop's own size in the source's pixels — the zone the crop stage drew,
/// read through the renderer's transform so a clamped pan or a turned picture
/// gives what will really be cut. A legacy Whole framing (`contain`) has no
/// zone: its crop is the aspect box it letterboxes into.
public func cropZoneSize(_ src: Size, _ aspectRatio: Double, _ framing: Framing?) -> Size {
    let box = rollOutputSize(src, aspectRatio, nil)
    guard let framing, framing.fit != .contain, box.width > 0 else { return box }
    let t = framingTransform(src.width, src.height, box.width, box.height, framing)
    return t.scale > 0 ? Size(box.width / t.scale, box.height / t.scale) : box
}

/// What a picture delivers: the canvas (capped), where the crop sits in it,
/// and the crop's own size.
public struct DeliveredLayout: Equatable, Sendable {
    /// The file's pixels.
    public var out: Size
    /// The canvas and the crop's rectangle, in OUTPUT pixels (unrounded).
    public var layout: BorderLayout
    /// The crop in the source's pixels.
    public var zone: Size

    public init(out: Size, layout: BorderLayout, zone: Size) {
        self.out = out; self.layout = layout; self.zone = zone
    }
}

/// The file a picture becomes: its crop at the source's OWN density, inside
/// its border, capped to `longEdge` — never upscaled.
public func deliveredLayout(_ src: Size, _ aspectRatio: Double, _ framing: Framing?, _ border: RollBorder?, _ longEdge: Double?) -> DeliveredLayout {
    let zone = cropZoneSize(src, aspectRatio, framing)
    let full = borderLayout(zone.width, zone.height, border)
    let long = max(full.w, full.h)
    if !(long > 0) { return DeliveredLayout(out: .zero, layout: full, zone: zone) }
    var k = 1.0
    if let longEdge, longEdge > 0 { k = min(1, longEdge / long) }
    let out = Size(max(1, rollExportRound(full.w * k)), max(1, rollExportRound(full.h * k)))
    // Scaled onto the ROUNDED canvas, so the rectangle and the file agree.
    let layout = scaleLayout(full, out.width / full.w)
    return DeliveredLayout(out: out, layout: layout, zone: zone)
}

/// Source pixels per output pixel for this delivery — 1 exact, below 1 upscaled.
public func deliveryHeadroom(_ src: Size, _ aspectRatio: Double, _ framing: Framing?, _ d: DeliveredLayout) -> Double {
    if framing?.fit == .contain { return pixelHeadroom(src, framing, Size(d.layout.pw, d.layout.ph)) }
    let zone = cropZoneSize(src, aspectRatio, framing)
    return d.layout.pw > 0 ? zone.width / d.layout.pw : 0
}

/// What ONE delivery is decided against: the size its target asks, and the
/// door's mode for this run. A size is resolved against EACH source it is
/// weighed on (`longEdgeFor`), since a short edge, an area or a percentage
/// means a different long edge on the proxy and on the original; a plain
/// `longEdge` is the same cap everywhere. The web tells the two apart by
/// whether `size` is present at all; here by the initialiser used.
public struct DeliverySettings: Equatable, Sendable {
    public var longEdge: Double?
    public var size: ExportSize?
    /// True when `size` decides (the web's `size !== undefined`), even a nil one — full size.
    public var sized: Bool
    public var pixels: PixelsMode

    /// A plain long edge, the same cap on every source.
    public init(longEdge: Double?, pixels: PixelsMode) {
        self.longEdge = longEdge; self.size = nil; self.sized = false; self.pixels = pixels
    }

    /// A target's size — nil is the picture's own — read against each source.
    public init(size: ExportSize?, pixels: PixelsMode) {
        self.longEdge = nil; self.size = size; self.sized = true; self.pixels = pixels
    }
}

/// The long edge `settings` caps a delivery of `src` at — the target's size
/// read against the picture's own frame.
public func capFor(_ settings: DeliverySettings, _ src: Size, _ aspectRatio: Double, _ framing: Framing?, _ border: RollBorder?) -> Double? {
    if !settings.sized { return settings.longEdge }
    let frame = deliveredLayout(src, aspectRatio, framing, border, nil).out
    return longEdgeFor(settings.size, width: frame.width, height: frame.height).map(Double.init)
}

/// Everything the Export tab says about ONE picture, and everything the
/// renderer needs to know before fetching: the frame, from which pixels, and
/// the sentence. `fileIsProxy` says whether the file in hand is a source's
/// editing rendition (its original is then `original`); `viaRawPreview` that
/// its pixels are the render a camera wrote inside a RAW.
///
/// The size is a CAP that never upscales, so the frame a proxy gives on its
/// own is always exact — the upscale question is asked against the frame the
/// ORIGINAL could give, which is what the person asked for.
public func deliverySummary(
    _ file: Size,
    _ fileIsProxy: Bool,
    _ original: OriginalInfo?,
    _ framing: Framing?,
    _ aspectRatio: Double,
    _ border: RollBorder?,
    _ settings: DeliverySettings,
    viaRawPreview: Bool = false
) -> DeliverySummary {
    // What the original could really hand over — for a RAW, the render inside
    // it, and only once its head has said how big that render is.
    let known = fileIsProxy ? original.flatMap(originalPixels) : nil
    let best = known ?? file
    let asked = deliveredLayout(best, aspectRatio, framing, border, capFor(settings, best, aspectRatio, framing, border))
    let bordered = border != nil
    let fileHeadroom = deliveryHeadroom(file, aspectRatio, framing, asked)
    let choice = choosePixels(settings.pixels, fileHeadroom, fileIsProxy ? original : nil, file)
    if choice.from == .original, let known {
        let headroom = deliveryHeadroom(known, aspectRatio, framing, asked)
        // A RAW's original is reached only through the render inside it, and
        // the row says so rather than letting the file's name suggest the sensor.
        let cropLong: Double? = bordered ? max(asked.zone.width, asked.zone.height) : nil
        return DeliverySummary(from: .original, out: asked.out, headroom: headroom,
                               line: deliversLine(originalLabel(original), asked.out, headroom, nil, cropLong),
                               reason: choice.reason)
    }
    let own = deliveredLayout(file, aspectRatio, framing, border, capFor(settings, file, aspectRatio, framing, border))
    let headroom = deliveryHeadroom(file, aspectRatio, framing, own)
    let label = sourceLabel(fileIsProxy, viaRawPreview: viaRawPreview)
    let askedLong = max(asked.out.width, asked.out.height)
    let cropLong: Double? = bordered ? max(own.zone.width, own.zone.height) : nil
    return DeliverySummary(
        from: choice.from,
        out: own.out,
        headroom: headroom,
        line: deliversLine(label, own.out, headroom, askedLong, cropLong),
        reason: choice.from == .original ? "the original will be measured once fetched" : choice.reason
    )
}

/// `DJI_0101.JPG` → `DJI_0101.jpg`: EXACTLY the picture's own name, with the
/// extension a JPEG deserves. Nothing is added — an added word breaks the
/// pairing of his two folders by name; two deliveries that then want one name
/// are numbered where they meet (`UniqueName.swift`).
public func exportName(_ refName: String) -> String {
    // The web's `replace(/\.[^.]+$/, '')`: the last dot and at least one
    // character after it, none of them a dot.
    var base = refName
    if let dot = refName.lastIndex(of: "."), refName.index(after: dot) < refName.endIndex {
        base = String(refName[..<dot])
    }
    return "\(base.isEmpty ? "picture" : base).jpg"
}

/// Where a run's files went: a folder, one by one to the downloads (the
/// web's fallback), or — the native app's own — into the photo library.
public enum DeliveryMethod: String, CaseIterable, Sendable {
    case folder, download, photos
}

/// The run's outcome in one sentence: what was written, what was numbered
/// around a file already there, and what could not be written at all.
/// `run` — several targets — makes `written` count FILES, and the sentence
/// says how many pictures they are.
public func describeRun(
    _ written: Int,
    _ method: DeliveryMethod,
    _ failures: [String],
    _ renamed: Int = 0,
    run: (pictures: Int, targets: Int)? = nil
) -> String {
    let verb: String
    switch method {
    case .folder: verb = "written"
    case .download: verb = "downloaded"
    case .photos: verb = "saved to Photos"
    }
    let head: String
    if written == 0 {
        head = "Nothing was written"
    } else if let run, run.targets > 1 {
        head = "\(run.pictures) picture\(run.pictures == 1 ? "" : "s") × \(run.targets) targets — \(written) file\(written == 1 ? "" : "s") \(verb)"
    } else {
        head = "\(written) picture\(written == 1 ? "" : "s") \(verb)"
    }
    let kept = renamed > 0
        ? " · \(renamed) numbered, the folder already held \(renamed == 1 ? "that name" : "those names")"
        : ""
    guard let first = failures.first else { return "\(head)\(kept)" }
    let more = failures.count > 1 ? " (+\(failures.count - 1) more)" : ""
    return "\(head)\(kept) — \(first)\(more)"
}
