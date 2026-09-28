// WHICH PIXELS a still is delivered from, for every host that delivers one
// into a FIXED frame (Trips' deck, a Studio variant). Port of
// `src/shared/develop/delivery-source.ts` (O2 of `docs/develop-originals.md`,
// R5 of `docs/capture-renditions.md`), with the part of
// `src/shared/develop/roll-export.ts` it stands on: `Auto`'s arithmetic
// (`choosePixels`), the headroom, the *Delivers* row's sentence and
// `fixedFrameDelivery`. The rest of `roll-export.ts` — the roll's CAPPED
// delivery (`rollOutputSize`, `cropZoneSize`, `deliveredLayout`,
// `deliverySummary`, `capFor`), `exportName` and `describeRun` — is not here:
// its port reuses these rather than writing them twice.
//
// The rules it carries (`renditions-build.md`, `develop-roll.md`):
// - an original is fetched only where the frame needs it — `Auto`, unnamed;
//   these hosts take no mode (`PixelsMode.proxies` is Develop's switch alone);
// - a fetched original is HELD for the session and never persisted, so a
//   second export of the same picture pays no fetch;
// - a RAW original is reached only through the render inside it, whose size is
//   read from a megabyte of the file's head and remembered — never assumed,
//   because a DJI's is 960 × 540 against a 2048 px proxy;
// - the *Delivers* row names an original by its FILE (`DJI_0101.JPG`,
//   `DJI_0101.DNG render`), the fidelity chip's own word;
// - a file the source never vouched for, or one that cannot be measured,
//   comes back as it went in: knowing nothing is no reason to refuse.
//
// The arithmetic takes `Size` (Doubles) for pictures and frames alike — the
// web's `{ width, height }` and `{ w, h }`. The I/O (`measurePicture`, the head
// fetch, the RAW probe, the original fetch) is injected; the session cache is
// `HeldOriginals` (`SensorSource.swift`).

import Foundation

// MARK: - the arithmetic (from roll-export.ts)

/// How a delivery weighs the original against the file in hand: `auto`
/// fetches it only where the file would upscale into the frame; `proxies`
/// never — the Develop editor's *Proxies only, for this run*.
public enum PixelsMode: String, CaseIterable, Sendable {
    case auto, proxies
}

/// What the *Delivers* row calls the pixels it is measuring. `viaRawPreview`
/// is the web's `DeliverySource.viaRawPreview`: the pixels are the render a
/// camera wrote inside a RAW — `File 8064 px` over a 960 × 540 render is the
/// one sentence the plan must never say.
public func sourceLabel(_ fileIsProxy: Bool, viaRawPreview: Bool = false) -> String {
    if fileIsProxy { return "Proxy" }
    return viaRawPreview ? "Camera render" : "File"
}

/// What a source says about the picture's original, when the file in hand is a proxy.
public struct OriginalInfo: Equatable, Sendable {
    /// The original's pixels as the source recorded them — the SENSOR's, for a RAW.
    public var width: Double?
    public var height: Double?
    /// The original's file name, for its extension.
    public var name: String?
    public var bytes: Int?
    /// For a RAW: the size of the RENDER inside it, read from its head, never
    /// assumed. Nil is "not read", or "read, and it carries none" — nothing is
    /// decided on a guess either way.
    public var render: Size?

    public init(width: Double?, height: Double?, name: String?, bytes: Int? = nil, render: Size? = nil) {
        self.width = width; self.height = height; self.name = name; self.bytes = bytes; self.render = render
    }
}

/// The pixels an original can really hand a delivery. For a RAW that is the
/// render inside it and nothing else — nil until its head says how big that
/// render is: a 74 MB fetch for 0.52 megapixels is what this refusal prevents.
public func originalPixels(_ original: OriginalInfo) -> Size? {
    if isRawImage(original.name ?? "") { return original.render }
    guard let w = original.width, let h = original.height, w != 0, h != 0 else { return nil }
    return Size(w, h)
}

/// Source pixels per output pixel across the frame under this crop: 1 is
/// exact, below 1 the export UPSCALES (a landscape proxy cropped to 4:5 at a
/// 1920 long edge is 0.8), above 1 there is detail to spare. Zoom and rotation
/// both eat into it, exactly as the transform that will draw it says.
public func pixelHeadroom(_ src: Size, _ framing: Framing?, _ out: Size) -> Double {
    let t = framingTransform(src.width, src.height, out.width, out.height, framing ?? .default)
    return t.scale > 0 ? 1 / t.scale : 0
}

/// The formats a renderer draws on its own; a RAW, HEIF or TIFF original is
/// delivered from its render. The list is `Assets.swift`'s — the same one that
/// says which half of a RAW + JPEG pair is shown.
public func decodableOriginal(_ name: String?) -> Bool {
    guard let name, !name.isEmpty, !isRawImage(name) else { return false }
    return isDrawableImage(name)
}

public enum PixelsFrom: String, CaseIterable, Sendable {
    case file, original
}

public struct PixelsChoice: Equatable, Sendable {
    public var from: PixelsFrom
    /// Why, in the words the panel says; nil when there was nothing to decide.
    public var reason: String?
    public init(from: PixelsFrom, reason: String?) { self.from = from; self.reason = reason }
}

/// Which pixels a picture is delivered from. `auto` fetches the original only
/// where the file in hand would upscale; `proxies` never. A file that IS the
/// original has nothing to choose. Against a RAW the rule is the LARGER of the
/// proxy and the render inside the RAW, measured and named — and where the
/// render's size has not been read, the proxy delivers.
public func choosePixels(_ mode: PixelsMode, _ fileHeadroom: Double, _ original: OriginalInfo?, _ file: Size? = nil) -> PixelsChoice {
    guard let original else { return PixelsChoice(from: .file, reason: nil) }
    if isRawImage(original.name ?? "") { return chooseAgainstRaw(mode, fileHeadroom, original, file) }
    if !decodableOriginal(original.name) {
        let what = original.name.map { formatLabelOf($0) } ?? "a format this browser does not decode"
        return PixelsChoice(from: .file, reason: "its original is \(what) — delivered from the render you developed")
    }
    if mode == .proxies { return PixelsChoice(from: .file, reason: "proxies only") }
    return fileHeadroom < 1
        ? PixelsChoice(from: .original, reason: "the proxy would be upscaled ×\(deliveryFixed(1 / fileHeadroom, 2))")
        : PixelsChoice(from: .file, reason: "the proxy has the pixels this frame needs")
}

private func chooseAgainstRaw(_ mode: PixelsMode, _ fileHeadroom: Double, _ original: OriginalInfo, _ file: Size?) -> PixelsChoice {
    guard let render = originalPixels(original) else {
        return PixelsChoice(
            from: .file,
            reason: "its original is a RAW: only the render inside it is decodable, and this proxy was built from that render — its size is read from the file’s head at export, and the larger of the two delivers"
        )
    }
    let fileLong = file.map { max($0.width, $0.height) } ?? 0
    let rawLong = max(render.width, render.height)
    if rawLong <= fileLong * 1.005 {
        return PixelsChoice(
            from: .file,
            reason: "its original is a RAW whose own render is \(deliveryNumber(rawLong)) px against the proxy’s \(deliveryNumber(fileLong)) — the proxy is what leaves"
        )
    }
    if mode == .proxies { return PixelsChoice(from: .file, reason: "proxies only") }
    if fileHeadroom >= 1 {
        return PixelsChoice(
            from: .file,
            reason: "the proxy has the pixels this frame needs — the \(deliveryNumber(rawLong)) px render inside its RAW would buy nothing here"
        )
    }
    return PixelsChoice(
        from: .original,
        reason: "its original is a RAW, and the \(deliveryNumber(rawLong)) px render inside it is larger than the \(deliveryNumber(fileLong)) px proxy"
    )
}

/// `a RAW`, `a HEIC`, … — a format by its extension.
private func formatLabelOf(_ name: String) -> String {
    if isRawImage(name) { return "a RAW" }
    guard let dot = name.lastIndex(of: ".") else { return "a format this browser does not decode" }
    let ext = name[name.index(after: dot)...].uppercased()
    return ext.isEmpty ? "a format this browser does not decode" : "a \(ext)"
}

/// What the *Delivers* row calls an original it will fetch: the FILE's name,
/// and `render` after a RAW's, since only the render inside it is ever
/// delivered. `Original` is the fallback for a source that vouched for no name.
public func originalLabel(_ original: OriginalInfo?) -> String {
    guard let name = original?.name, !name.isEmpty else { return "Original" }
    return isRawImage(name) ? "\(name) render" : name
}

/// `Proxy 1536 px → 1920 · ×1.25 upscaled` — the calculator in one sentence.
/// `askedLong` is the long edge the export WANTED when the frame fell short
/// of it, said as such; `cropLong` the crop's own long edge in the source, said
/// when a border makes the file larger than the crop.
public func deliversLine(_ label: String, _ out: Size, _ headroom: Double, _ askedLong: Double? = nil, _ cropLong: Double? = nil) -> String {
    let outLong = max(out.width, out.height)
    let srcLong = cropLong.map { deliveryRound($0) } ?? deliveryRound(outLong * headroom)
    let verdict: String
    if headroom <= 0 {
        verdict = "nothing to draw"
    } else if headroom < 0.995 {
        verdict = "×\(deliveryFixed(1 / headroom, 2)) upscaled"
    } else if headroom < 1.005 {
        verdict = "exact"
    } else {
        verdict = "×\(deliveryFixed(headroom, 2)) to spare"
    }
    var asked = ""
    if let askedLong, askedLong > outLong { asked = " · asked \(deliveryNumber(askedLong))" }
    return "\(label) \(deliveryNumber(srcLong)) px → \(deliveryNumber(outLong)) · \(verdict)\(asked)"
}

public struct DeliverySummary: Equatable, Sendable {
    public var from: PixelsFrom
    /// The frame the export will write.
    public var out: Size
    public var headroom: Double
    public var line: String
    /// Why these pixels, or nil when there was nothing to decide.
    public var reason: String?

    public init(from: PixelsFrom, out: Size, headroom: Double, line: String, reason: String?) {
        self.from = from; self.out = out; self.headroom = headroom; self.line = line; self.reason = reason
    }
}

/// The decision where the output frame is FIXED rather than capped — Trips'
/// deck (1920 on the long edge, whatever the picture gives) and a Studio
/// variant, both of which will upscale rather than deliver less. The question
/// is simply whether the pixels in hand fill the frame. These hosts have no
/// mode: `auto` is what they do, unnamed.
public func fixedFrameDelivery(
    _ file: Size,
    _ fileIsProxy: Bool,
    _ original: OriginalInfo?,
    _ framing: Framing?,
    _ out: Size,
    viaRawPreview: Bool = false
) -> DeliverySummary {
    let fileHeadroom = pixelHeadroom(file, framing, out)
    let choice = choosePixels(.auto, fileHeadroom, fileIsProxy ? original : nil, file)
    let best = fileIsProxy ? original.flatMap(originalPixels) : nil
    if choice.from == .original, let best {
        let headroom = pixelHeadroom(best, framing, out)
        return DeliverySummary(from: .original, out: out, headroom: headroom,
                               line: deliversLine(originalLabel(original), out, headroom), reason: choice.reason)
    }
    return DeliverySummary(
        from: .file, out: out, headroom: fileHeadroom,
        line: deliversLine(sourceLabel(fileIsProxy, viaRawPreview: viaRawPreview), out, fileHeadroom),
        reason: choice.from == .original ? "the original will be measured once fetched" : choice.reason
    )
}

// MARK: - the seam (delivery-source.ts)

/// What a source says of the original behind a proxy, for the arithmetic; nil
/// for a file that IS its capture, or one no source vouched for.
public func originalOf(_ origin: MediaOrigin?, _ render: PixelSize? = nil) -> OriginalInfo? {
    guard let origin, origin.fidelity == .proxy else { return nil }
    return OriginalInfo(
        width: origin.width.map(Double.init),
        height: origin.height.map(Double.init),
        name: origin.name,
        bytes: origin.bytes,
        render: render.map { Size(Double($0.width), Double($0.height)) }
    )
}

/// True when the file in hand is a proxy whose original is a RAW.
public func isProxyOverRaw(_ origin: MediaOrigin?) -> Bool {
    guard let origin, origin.fidelity == .proxy, let name = origin.name, !name.isEmpty else { return false }
    return isRawImage(name)
}

/// How much of a RAW's head is read to find the render inside it — the web's
/// `RAW_PROBE_BYTES`, a megabyte (`raw-probe.ts`'s, whose port owns the name).
private let deliveryHeadBytes = 1024 * 1024

/// How big the render inside a RAW the session can reach really is — a
/// proxy's own original, or a capture's companion — read from that file's HEAD
/// and remembered for the session under `key` (the web's `rawRenderFrom`;
/// `rawRenderOf` is this with the origin's head fetch). A file already held
/// is measured from its own head (`readHead`); a render read once is never
/// read again; a head that cannot be fetched is remembered as "none".
///
/// `probe` is `raw-probe.ts`'s `rawSizesFrom(head).render`. `head` comes back
/// only when this call is what fetched it, so a caller that also needs the
/// original's EXIF pays for one read and not two.
public func rawRenderFrom(
    _ fetchHead: ((Int) async throws -> Data)?,
    _ key: String?,
    held: HeldOriginals,
    readHead: (SavedMediaRef) async -> Data?,
    probe: (Data) -> PixelSize?
) async -> (render: PixelSize?, head: Data?) {
    if let key, let file = held.heldOriginal(key) {
        let head = await readHead(file)
        let render = head.flatMap(probe)
        held.holdRawRender(key, render)
        return (render, nil)
    }
    if let key, let known = held.heldRawRender(key) {
        return (known, nil)
    }
    guard let fetchHead else { return (nil, nil) }
    do {
        let head = try await fetchHead(deliveryHeadBytes)
        let render = probe(head)
        if let key { held.holdRawRender(key, render) }
        return (render, head)
    } catch {
        if let key { held.holdRawRender(key, nil) }
        return (nil, nil)
    }
}

/// What a host got back — the web's `DeliverySource` of `delivery-source.ts`
/// (renamed here: `roll-export.ts` uses that name for a measured size).
public struct DeliveryOutcome: Equatable, Sendable {
    /// The file to draw from — the one handed in, or the original that was fetched.
    public var file: SavedMediaRef
    /// What it will deliver into the frame asked for, and why those pixels.
    public var summary: DeliverySummary?
    /// True when an original was pulled for this delivery.
    public var fetched: Bool

    public init(file: SavedMediaRef, summary: DeliverySummary?, fetched: Bool) {
        self.file = file; self.summary = summary; self.fetched = fetched
    }
}

/// `deliveryFor`'s pure half: the decision from what has been measured. Nil
/// when the file could not be measured — the host then delivers it as it is.
/// `render` is the render inside the proxy's RAW original, where it was read;
/// it is weighed only for a proxy over a RAW.
public func deliveryDecision(
    measured: Size?,
    viaRawPreview: Bool = false,
    origin: MediaOrigin?,
    render: PixelSize?,
    framing: Framing?,
    out: Size
) -> DeliverySummary? {
    guard let measured else { return nil }
    let raw = isProxyOverRaw(origin) ? render : nil
    return fixedFrameDelivery(measured, origin?.fidelity == .proxy, originalOf(origin, raw), framing, out, viaRawPreview: viaRawPreview)
}

/// Decide, and fetch if the decision says so, for ONE picture delivered into a
/// FIXED frame `out` under `framing`. Everything the web reads off module
/// state is handed in: `measured` is `measurePicture(file)`, `origin` and
/// `assetId` are what the source registered for the file, `held` the session
/// cache, `fetchOriginalHead` / `readHead` / `probe` how a RAW original's
/// render is measured (`rawRenderFrom`), and `fetchOriginal` the fetch — on the
/// web a task of its own, named, cancellable. A fetch that fails (a cancel
/// included) costs the extra pixels, never the delivery.
public func deliveryFor(
    _ file: SavedMediaRef,
    _ framing: Framing?,
    _ out: Size,
    measured: Size?,
    viaRawPreview: Bool = false,
    origin: MediaOrigin?,
    assetId: String?,
    held: HeldOriginals,
    fetchOriginalHead: ((Int) async throws -> Data)? = nil,
    readHead: (SavedMediaRef) async -> Data? = { _ in nil },
    probe: (Data) -> PixelSize? = { _ in nil },
    fetchOriginal: (() async throws -> SavedMediaRef)? = nil,
    onProgress: ((String) -> Void)? = nil
) async -> DeliveryOutcome {
    guard measured != nil else { return DeliveryOutcome(file: file, summary: nil, fetched: false) }
    var render: PixelSize? = nil
    if isProxyOverRaw(origin) {
        render = await rawRenderFrom(fetchOriginalHead, assetId, held: held, readHead: readHead, probe: probe).render
    }
    guard var summary = deliveryDecision(measured: measured, viaRawPreview: viaRawPreview, origin: origin,
                                         render: render, framing: framing, out: out) else {
        return DeliveryOutcome(file: file, summary: nil, fetched: false)
    }
    guard summary.from == .original, let fetchOriginal else {
        return DeliveryOutcome(file: file, summary: summary, fetched: false)
    }
    if let assetId, let heldCopy = held.heldOriginal(assetId) {
        return DeliveryOutcome(file: heldCopy, summary: summary, fetched: false)
    }
    do {
        onProgress?("Fetching the original…")
        let fetched = try await fetchOriginal()
        if let assetId { held.holdOriginal(assetId, fetched) }
        return DeliveryOutcome(file: fetched, summary: summary, fetched: true)
    } catch {
        summary.from = .file
        return DeliveryOutcome(file: file, summary: summary, fetched: false)
    }
}

// MARK: - numbers, as JavaScript writes them

/// `Math.round`: a half goes UP.
private func deliveryRound(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

/// `${n}`: an integer-valued number prints without `.0`.
private func deliveryNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// `toFixed` on a non-negative value: the nearest `digits`-place number, a half going UP.
private func deliveryFixed(_ x: Double, _ digits: Int) -> String {
    // `(1 / 0).toFixed(2)` is `Infinity` on the web; past 1e15 it would print
    // exponents, which no frame here comes near.
    if !x.isFinite || x >= 1e15 { return x.isNaN ? "NaN" : "Infinity" }
    let scale = pow(10.0, Double(digits))
    let n = (x * scale).rounded(.toNearestOrAwayFromZero)
    if digits == 0 { return String(Int64(n)) }
    let whole = Int64(n) / Int64(scale)
    let frac = Int64(n) % Int64(scale)
    let fracText = String(frac)
    return "\(whole).\(String(repeating: "0", count: digits - fracText.count))\(fracText)"
}
