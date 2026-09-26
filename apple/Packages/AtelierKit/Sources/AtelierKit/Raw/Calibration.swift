// WHAT A RAW'S OWN CALIBRATION MEANS TO A RENDER — the seam between the file
// (`Exif/DngOpcodes.swift`, read by `Exif/RawProbe.swift`) and the two passes
// that apply it (`Render/GainMapGrid.swift`, `Render/CameraWarp.swift`). Port
// of `src/shared/raw/calibration.ts`.
//
// It answers two questions and nothing else: which RUNGS of the material
// ladder this file can offer, and what the passes need at the rung a picture
// stands on. Read from a megabyte of the file's head, once per file, and held
// for the session: a stage that re-reads a header on every repaint stutters.
//
// **A rung is offered only where the file carries the opcode.** A DNG with no
// GainMap simply has no `gainMap` rung, and nothing fabricates one.
//
// The web keeps the session's answers in a module `Map` keyed by the file; here
// that map is a small class the app owns (`RawCalibrationStore`), keyed by
// `fileKey`, and the resolve itself is the pure `rawCalibrationFrom(head:)`.

import Foundation

/// A file's calibration, resolved into what the render graph can use.
public struct RawCalibration: Equatable, Sendable {
    /// The shading grid over the whole image, or nil when the file states none.
    public var gain: GainField?
    /// The rectilinear warp, or nil when the file states none (or an identity).
    public var warp: CameraWarp?
    /// The sensor's own pixels — what the opcodes were written against.
    public var width: Double
    public var height: Double
    /// What the file asks for, in the numbers a person can check.
    public var summary: String

    public init(gain: GainField?, warp: CameraWarp?, width: Double, height: Double, summary: String) {
        self.gain = gain; self.warp = warp; self.width = width; self.height = height; self.summary = summary
    }
}

/// What the passes want at a given rung — nothing at all below `gainMap`.
public struct CalibrationAt: Equatable, Sendable {
    public var gain: GainField?
    public var warp: CameraWarp?

    public init(gain: GainField? = nil, warp: CameraWarp? = nil) {
        self.gain = gain; self.warp = warp
    }

    public static let nothing = CalibrationAt()
}

/// The web's `baseRung`: 0 for the proxy and for no base at all.
private func baseRung(_ base: DevelopBase?) -> Int {
    base?.rung ?? 0
}

/// Which rungs this file can honestly offer, lowest first.
public func rungsFor(_ cal: RawCalibration?) -> [DevelopBase] {
    var rungs: [DevelopBase] = [.proxy, .gain]
    if cal?.gain != nil { rungs.append(.gainMap) }
    if cal?.gain != nil && cal?.warp != nil { rungs.append(.gainMapWarp) }
    return rungs
}

/// The calibration to apply at one rung. `gainMap` adds the grid; `gainMapWarp`
/// adds the warp on top — so a rung always contains the one below it, which is
/// what makes the ladder a ladder.
public func calibrationAt(_ base: DevelopBase?, _ cal: RawCalibration?) -> CalibrationAt {
    guard let cal else { return .nothing }
    let rung = baseRung(base)
    if rung < DevelopBase.gainMap.rung { return .nothing }
    return CalibrationAt(gain: cal.gain, warp: rung >= DevelopBase.gainMapWarp.rung ? cal.warp : nil)
}

/// The highest rung this file can reach — what an export climbs to.
public func topRung(_ cal: RawCalibration?) -> DevelopBase {
    rungsFor(cal).last ?? .gain
}

/// `gain map up to 5.93× · warp ×1.049`, or what the opcodes say when nothing applies.
private func summarise(_ opcodes: DngOpcodes, _ gain: GainField?, _ warp: CameraWarp?, _ w: Double, _ h: Double) -> String {
    var parts: [String] = []
    if let gain { parts.append("gain map up to \(ExifText.toFixed(maxGain(gain), 2))×") }
    let warped = warp.map { describeWarp($0, w, h) } ?? ""
    if !warped.isEmpty { parts.append("warp \(warped)") }
    if parts.isEmpty { return describeOpcodes(opcodes) }
    if !opcodes.unread.isEmpty { parts.append("\(opcodes.unread.count) not applied") }
    return parts.joined(separator: " · ")
}

/// A RAW's calibration from the head of its file — pure, the heart of the
/// web's `readRawCalibration`.
///
/// Nil for a file that is not a RAW, carries no `OpcodeList3`, or states only
/// opcodes this engine does not apply — all three of which mean the same thing
/// to a caller: no rung above `gain`.
public func rawCalibrationFrom(head: [UInt8]) -> RawCalibration? {
    guard let probe = probeRaw(head), let opcodes = probe.calibration else { return nil }
    // The opcodes' rectangle is in the SENSOR's pixels, so without its size
    // there is nothing to normalise against and the grid cannot be laid over
    // the picture at all.
    let sensor = sensorIfd(probe)
    let width = sensor?.width ?? 0
    let height = sensor?.height ?? 0
    if !(width > 0) || !(height > 0) { return nil }
    let field = gainFieldFrom(opcodes.gainMaps, width, height)
    let gain = field.flatMap { isFlatField($0) ? nil : $0 }
    let warp = opcodes.warp.flatMap { isIdentityWarp($0) ? nil : $0 }
    if gain == nil && warp == nil { return nil }
    return RawCalibration(gain: gain, warp: warp, width: width, height: height,
                          summary: summarise(opcodes, gain, warp, width, height))
}

/// The session's answers, once per file: the web's module map, owned by the
/// app. Not `Sendable` — keep it on one actor.
public final class RawCalibrationStore {
    private var answers: [String: RawCalibration?] = [:]

    public init() {}

    /// Read a RAW's calibration, once per file and per session. `key` is the
    /// file's identity (`fileKey`); `read` hands back a range of its bytes.
    /// A read that throws is an answer too: nil, held like any other.
    public func read(_ key: String, fileSize: Int, read: (Range<Int>) throws -> [UInt8]) -> RawCalibration? {
        if let known = answers[key] { return known }
        var out: RawCalibration? = nil
        if let head = try? read(0..<min(rawProbeBytes, max(0, fileSize))) {
            out = rawCalibrationFrom(head: head)
        }
        answers[key] = .some(out)
        return out
    }

    /// The calibration already read for this file, without reading: `.none`
    /// until it is, `.some(nil)` for a file with none — and for no file at all.
    public func held(_ key: String?) -> RawCalibration?? {
        guard let key else { return .some(nil) }
        return answers[key]
    }
}
