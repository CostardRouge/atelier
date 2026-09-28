// What the Develop workbench KNOWS about the files of the picture it holds,
// turned into the input `Media/Renditions.swift` lists from. Port of
// `src/shared/develop/capture-files.ts`.
//
// The workbench holds one file and a few facts gathered around it — where a
// source says it came from (`MediaOrigin`), what its pixels measured, the
// sensor plane a RAW's head stated, whether the proxy's original is already
// held for the session, and the capture's other files a folder listed beside
// it (`AssetParts.siblings`). This is the one place those facts become
// `CaptureFile`s, so the list is built the same way on every render.
//
// Rules kept (`renditions-build.md`, R3a): nothing here fetches, probes or
// decodes; a fact that has not been measured is passed as "not measured",
// never guessed — a source states the CAPTURE's pixels, the SENSOR's for a
// RAW, which say nothing about the render inside it; a sibling is listed only
// once its head was read (the caller hands no facts before); and a RAW's
// render is "none" only when a probe said so, never from here.

import Foundation

/// What has been read of a sibling file's head — nothing is listed before this is known.
public struct SiblingFacts: Equatable, Sendable {
    /// Its `Software` tag, or nil when it carries none (`Exif/SoftwareMark.swift`).
    public var software: String?
    /// For a RAW: the render inside it — `nil` not read, `.some(nil)` it carries none.
    public var render: PixelSize??
    public var sensor: PixelSize?
    /// For a drawable file: its own pixels, where something measured them.
    public var pixels: PixelSize?

    public init(software: String?, render: PixelSize?? = nil, sensor: PixelSize? = nil, pixels: PixelSize? = nil) {
        self.software = software; self.render = render; self.sensor = sensor; self.pixels = pixels
    }
}

public struct CaptureFacts {
    /// The proxy's original: its asset id, whether it is held already, and —
    /// for a RAW — its render's size once read (`nil` not yet, `.some(nil)` none).
    public struct Original: Equatable, Sendable {
        public var assetId: String?
        public var held: Bool
        public var render: PixelSize??
        public init(assetId: String?, held: Bool, render: PixelSize?? = nil) {
            self.assetId = assetId; self.held = held; self.render = render
        }
    }

    /// The capture's other file on its instance: held already? and, for a RAW,
    /// its render's size once its head was read. Its name, weight and sensor
    /// plane come from the origin itself.
    public struct Companion: Equatable, Sendable {
        public var held: Bool
        public var render: PixelSize??
        public init(held: Bool, render: PixelSize?? = nil) { self.held = held; self.render = render }
    }

    /// A file a folder listed beside the one in hand, with what its head said.
    public struct Sibling: Equatable, Sendable {
        public var file: SavedMediaRef
        public var facts: SiblingFacts
        public init(file: SavedMediaRef, facts: SiblingFacts) { self.file = file; self.facts = facts }
    }

    /// The file in hand.
    public var file: SavedMediaRef
    /// Where a source says it came from; nil for a file opened from a disk.
    public var origin: MediaOrigin?
    /// The pixels the stage measured of `file` — the file's own, or the render inside a RAW.
    public var measured: PixelSize?
    /// A RAW in hand: its sensor plane, read from its head.
    public var sensor: PixelSize?
    public var original: Original?
    public var companion: Companion?
    /// The capture's other files a folder listed beside `file`, once their heads were read.
    public var siblings: [Sibling]
    public var canDraw: ((String) -> Bool)?

    public init(file: SavedMediaRef, origin: MediaOrigin? = nil, measured: PixelSize? = nil, sensor: PixelSize? = nil,
                original: Original? = nil, companion: Companion? = nil, siblings: [Sibling] = [], canDraw: ((String) -> Bool)? = nil) {
        self.file = file; self.origin = origin; self.measured = measured; self.sensor = sensor
        self.original = original; self.companion = companion; self.siblings = siblings; self.canDraw = canDraw
    }
}

/// A size a source stated, or nil when it stated none worth the name.
private func statedSize(_ width: Int?, _ height: Int?) -> PixelSize? {
    guard let width, let height, width > 0, height > 0 else { return nil }
    return PixelSize(width: width, height: height)
}

/// The list `renditionsOf` reads, from what the workbench has in hand.
public func captureInput(_ facts: CaptureFacts) -> CaptureInput {
    let file = facts.file
    let origin = facts.origin
    let openIsProxy = origin?.fidelity == .proxy
    let open: CaptureFile
    if isRawImage(file.name) {
        // Measured through the render inside it, or not measured at all —
        // never "none" from here: only a probe can say a RAW carries no render.
        var render: PixelSize?? = nil
        if let measured = facts.measured { render = .some(measured) }
        open = CaptureFile(name: file.name, bytes: file.size, here: true, render: render, sensor: facts.sensor)
    } else {
        open = CaptureFile(name: file.name, bytes: file.size, here: true, pixels: facts.measured)
    }

    var others: [CaptureFile] = []
    if openIsProxy, let origin, let name = origin.name, !name.isEmpty {
        var row = CaptureFile(name: name, bytes: origin.bytes, here: facts.original?.held ?? false, assetId: facts.original?.assetId)
        if row.assetId?.isEmpty == true { row.assetId = nil }
        // A source states the CAPTURE's pixels — the sensor's, for a RAW,
        // which says nothing about the render inside it; that one is read from the head.
        if isRawImage(name) {
            // Three states pass through as they are: not read, read and none, measured.
            if let original = facts.original { row.render = original.render }
            row.sensor = statedSize(origin.width, origin.height)
        } else {
            row.pixels = statedSize(origin.width, origin.height)
        }
        others.append(row)
    }
    if let companion = origin?.companion, let known = facts.companion {
        var row = CaptureFile(name: companion.name, bytes: companion.bytes, here: known.held, assetId: companion.assetId)
        if isRawImage(companion.name) {
            row.render = known.render
            row.sensor = statedSize(companion.width, companion.height)
        } else {
            row.pixels = statedSize(companion.width, companion.height)
        }
        others.append(row)
    }
    for sibling in facts.siblings {
        var row = CaptureFile(name: sibling.file.name, bytes: sibling.file.size, here: true, software: sibling.facts.software)
        if isRawImage(sibling.file.name) {
            row.render = sibling.facts.render
            row.sensor = sibling.facts.sensor
        } else {
            row.pixels = sibling.facts.pixels
        }
        others.append(row)
    }
    return CaptureInput(open: open, openIsProxy: openIsProxy, others: others, canDraw: facts.canDraw)
}
