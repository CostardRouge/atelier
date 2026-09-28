// THE FILES ONE CAPTURE IS MADE OF, and what each of them can give — port of
// `src/shared/media/renditions.ts`.
//
// A photograph is rarely one file. A Sony writes `DSC08463.ARW` beside
// `DSC08463.HIF`; a DJI writes `DJI_0001.DNG` beside `DJI_0001.JPG`; a Winnow
// adds its own 2048 px proxy over whichever of those it ingested. Given what
// is known about a capture's files, this module says which RENDITIONS exist,
// what each one is FOR, how its pixels are reached, and which of them the
// caller can actually draw. It decides nothing about fetching, decoding or
// drawing: it is pure and does no I/O.
//
// Rules kept from `renditions.md`: a RAW yields TWO rows (its camera render,
// its sensor) because they differ by 8.4× on a DJI and 0.5 % on a Sony; roles
// never formats, with a separate `reach`; `canDraw` is INJECTED because the
// answer differs by renderer and must be probed; a blocked row is dropped
// only when the same capture already offers a drawable delivered row; an id
// is `proxy` or `<role>:<lowercased file name>`; `pixels` is nil until
// something MEASURED it; and an export of ours beside the capture
// (`Exif/SoftwareMark.swift`) is never one of its renditions.

import Foundation

public struct PixelSize: Equatable, Hashable, Sendable {
    public var width: Int
    public var height: Int
    public init(width: Int, height: Int) { self.width = width; self.height = height }
}

/// What a rendition is FOR — never what format it is in. Three roles answer
/// every camera in the house.
public enum RenditionRole: String, Codable, Sendable {
    /// A source's editing rendition: fast, small, where a picture opens.
    case proxy
    /// What the camera wrote for people to look at — a JPEG, a HEIF, the render inside a RAW.
    case delivered
    /// The sensor's own data, for a decoder to develop.
    case sensor

    fileprivate var order: Int {
        switch self {
        case .proxy: return 0
        case .delivered: return 1
        case .sensor: return 2
        }
    }
}

/// How a rendition's pixels are got.
public enum RenditionReach: String, Codable, Sendable {
    /// The renderer draws the file as it is.
    case file
    /// A render the camera wrote INSIDE the file.
    case embedded
    /// A decoder develops the sensor plane.
    case sensor
    /// A decoder this suite does not ship. Listed, never silently dropped.
    case decoder
}

/// One file of a capture, as a caller knows it.
public struct CaptureFile: Equatable, Sendable {
    /// The file's own name — the stable key, as everywhere else in the suite.
    public var name: String
    public var bytes: Int?
    /// True when the bytes are already in hand: no fetch, no permission prompt.
    /// Nil is "not said": read as false for a capture's file, true for a proxy.
    public var here: Bool?
    /// Where to fetch it from when it is not here — an instance's `<host>/<id>`.
    public var assetId: String?
    /// The pixels of the render INSIDE this file, where something has measured
    /// them. Three states, as the web's `undefined | null | size`: `nil` is
    /// "nobody looked", `.some(nil)` is "read, and it carries none" (a real
    /// case: some bodies write no render), `.some(size)` is measured. Never
    /// guessed: a DJI's is 960 × 540 and a Sony's is 7008 × 4672, and no rule
    /// predicts which.
    public var render: PixelSize??
    /// The sensor plane's own pixels, where they have been read.
    public var sensor: PixelSize?
    /// This file's own pixels, for one a renderer draws directly.
    public var pixels: PixelSize?
    /// The file's own `Software` tag, where its EXIF has been read. A file this
    /// suite WROTE is an export that happens to sit beside the capture and is
    /// never one of its renditions.
    public var software: String?

    public init(name: String, bytes: Int? = nil, here: Bool? = nil, assetId: String? = nil,
                render: PixelSize?? = nil, sensor: PixelSize? = nil, pixels: PixelSize? = nil, software: String? = nil) {
        self.name = name; self.bytes = bytes; self.here = here; self.assetId = assetId
        self.render = render; self.sensor = sensor; self.pixels = pixels; self.software = software
    }
}

public struct CaptureInput {
    /// The file the tool is holding right now.
    public var open: CaptureFile
    /// True when `open` is a source's editing rendition rather than a capture's own file.
    public var openIsProxy: Bool
    /// The capture's other files: a folder's siblings, an instance's companion.
    public var others: [CaptureFile]
    /// Whether this renderer draws a file of that name on its own. Injected
    /// because the answer differs by renderer and must be PROBED, never
    /// assumed: Chrome 152 refuses HEIC, HEIF and TIFF where WebKit — and
    /// ImageIO — draw all three. Nil is the browser-neutral list, `isDrawableImage`.
    public var canDraw: ((String) -> Bool)?

    public init(open: CaptureFile, openIsProxy: Bool = false, others: [CaptureFile] = [], canDraw: ((String) -> Bool)? = nil) {
        self.open = open; self.openIsProxy = openIsProxy; self.others = others; self.canDraw = canDraw
    }
}

public struct Rendition: Equatable, Sendable {
    /// Stable and storable. `proxy`, else `<role>:<lowercased file name>` — the
    /// name being what identifies a capture's file across devices.
    public var id: String
    public var role: RenditionRole
    public var reach: RenditionReach
    /// The file these pixels come out of; the proxy's own name for a source's proxy.
    public var name: String
    public var bytes: Int?
    /// What this rendition delivers, where it has been MEASURED. Nil is "nobody looked".
    public var pixels: PixelSize?
    /// True when the bytes are in hand.
    public var here: Bool
    public var assetId: String?
    /// Why it cannot be used, in the words a person reads, or nil.
    public var blocked: String?

    public init(id: String, role: RenditionRole, reach: RenditionReach, name: String, bytes: Int? = nil,
                pixels: PixelSize? = nil, here: Bool, assetId: String? = nil, blocked: String? = nil) {
        self.id = id; self.role = role; self.reach = reach; self.name = name; self.bytes = bytes
        self.pixels = pixels; self.here = here; self.assetId = assetId; self.blocked = blocked
    }
}

private func extOf(_ name: String) -> String {
    guard let dot = name.lastIndex(of: "."), dot != name.startIndex else { return "" }
    return name[name.index(after: dot)...].lowercased()
}

private func idFor(_ role: RenditionRole, _ name: String) -> String {
    role == .proxy ? "proxy" : "\(role.rawValue):\(name.lowercased())"
}

private func area(_ size: PixelSize?) -> Int {
    guard let size else { return 0 }
    return size.width * size.height
}

/// The rows one capture file contributes.
///
/// A RAW contributes TWO — the render its camera wrote, and the sensor plane
/// — and that is the whole reason this is a list rather than a ladder:
/// measured on the maintainer's own bodies, those two differ by 8.4× on a DJI
/// (960 × 540 against 8064 × 4536) and by 0.5 % on a Sony A7C II (7008 × 4672
/// against 7040 × 4688). One row could not say that.
private func rowsFor(_ file: CaptureFile, _ canDraw: (String) -> Bool) -> [Rendition] {
    let here = file.here ?? false
    if isRawImage(file.name) {
        let render: PixelSize?
        let blocked: String?
        switch file.render {
        case .none:
            render = nil; blocked = nil
        case .some(.none):
            // A RAW with no embedded render at all is a real case (some bodies
            // write none); the caller finds out when it probes, and the row
            // says so rather than vanishing.
            render = nil; blocked = "this file carries no render a browser can draw"
        case .some(.some(let measured)):
            render = measured; blocked = nil
        }
        let delivered = Rendition(id: idFor(.delivered, file.name), role: .delivered, reach: .embedded, name: file.name,
                                  bytes: file.bytes, pixels: render, here: here, assetId: file.assetId, blocked: blocked)
        let sensor = Rendition(id: idFor(.sensor, file.name), role: .sensor, reach: .sensor, name: file.name,
                               bytes: file.bytes, pixels: file.sensor, here: here, assetId: file.assetId, blocked: nil)
        return [delivered, sensor]
    }
    let drawable = canDraw(file.name)
    let format = extOf(file.name).uppercased()
    let blocked: String? = drawable ? nil : "this browser does not draw \(format.isEmpty ? "this format" : format)"
    return [
        Rendition(id: idFor(.delivered, file.name), role: .delivered, reach: drawable ? .file : .decoder, name: file.name,
                  bytes: file.bytes, pixels: file.pixels, here: here, assetId: file.assetId, blocked: blocked),
    ]
}

/// Which delivered rows are worth showing.
///
/// A row this renderer cannot draw is dropped when the SAME capture already
/// offers a delivered row it can — the measured case being a Sony `.HIF`,
/// whose picture is a grid of six HEVC tiles, beside an `.ARW` whose own
/// embedded render is the very same 7008 × 4672 photograph. Where nothing
/// else is drawable it STAYS, blocked and saying why, because then it is the
/// only thing standing between the person and their picture. Pixels decide it
/// where both are known; where the blocked row's are not, the available row
/// wins — the honest reading of "nobody measured it".
private func pruneUndrawable(_ rows: [Rendition]) -> [Rendition] {
    let available = rows.filter { $0.role == .delivered && $0.blocked == nil }
    if available.isEmpty { return rows }
    let best = available.map { area($0.pixels) }.max() ?? 0
    let known = available.contains { $0.pixels != nil }
    return rows.filter { r in
        if r.role != .delivered || r.blocked == nil { return true }
        guard let pixels = r.pixels else { return false }
        return known && area(pixels) > best
    }
}

/// Every rendition of one capture, ordered the way the pill reads it: the
/// proxy, then what the camera delivered, then the sensor.
///
/// Within a role the smaller comes first, so the list climbs; a rendition
/// nobody has measured sits last of its role rather than claiming a place it
/// cannot justify.
public func renditionsOf(_ input: CaptureInput) -> [Rendition] {
    let canDraw = input.canDraw ?? isDrawableImage
    var rows: [Rendition] = []
    if input.openIsProxy {
        rows.append(Rendition(id: "proxy", role: .proxy, reach: .file, name: input.open.name, bytes: input.open.bytes,
                              pixels: input.open.pixels, here: input.open.here ?? true, assetId: input.open.assetId, blocked: nil))
    } else {
        rows.append(contentsOf: rowsFor(input.open, canDraw))
    }
    var seen = Set(rows.map { $0.id })
    for other in input.others {
        // An export of ours beside the capture is not the camera's file. The
        // OPEN file is never dropped: it is what the person chose to work on.
        if isAtelierMade(other.software) { continue }
        for row in rowsFor(other, canDraw) {
            if seen.contains(row.id) { continue }
            seen.insert(row.id)
            rows.append(row)
        }
    }
    // A stable sort, as `Array.prototype.sort` is.
    let indexed = pruneUndrawable(rows).enumerated().map { ($0.offset, $0.element) }
    return indexed.sorted { a, b in
        let role = a.1.role.order - b.1.role.order
        if role != 0 { return role < 0 }
        let known = (a.1.pixels == nil ? 1 : 0) - (b.1.pixels == nil ? 1 : 0)
        if known != 0 { return known < 0 }
        let byArea = area(a.1.pixels) - area(b.1.pixels)
        if byArea != 0 { return byArea < 0 }
        return a.0 < b.0
    }.map { $0.1 }
}

/// The rendition a stored id names, or nil when this capture no longer has it.
public func renditionById(_ rows: [Rendition], _ id: String?) -> Rendition? {
    guard let id, !id.isEmpty else { return nil }
    return rows.first { $0.id == id }
}

/// Where a picture OPENS: the cheapest rendition that can actually be drawn —
/// the proxy when there is one, else the smallest delivered row in hand.
/// The maintainer's own rule: the proxy is for performance — where a picture
/// opens, and never where it is trapped.
public func openingRendition(_ rows: [Rendition]) -> Rendition? {
    let usable = rows.filter { $0.blocked == nil && $0.role != .sensor }
    let here = usable.filter { $0.here }
    return here.first ?? usable.first
}

/// `7008 × 4672 · 2.7 MB`, or as much of it as was measured.
public func renditionFacts(_ row: Rendition, formatBytes format: (Int) -> String = { formatBytes($0) }) -> String {
    var parts: [String] = []
    if let pixels = row.pixels { parts.append("\(pixels.width) × \(pixels.height)") }
    if let bytes = row.bytes { parts.append(format(bytes)) }
    return parts.joined(separator: " · ")
}
