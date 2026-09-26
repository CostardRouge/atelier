// The day a picture was actually taken — MEASURED from the file, not authored.
// Port of `src/shared/roadtrip/media-date.ts`.
//
// Road Trip files a piece under a DAY, and every number it draws is a
// subtraction from that day. So the day has to be the picture's own, or the
// badge counts confidently in the wrong direction: a Brittany 2026 photo
// dropped into an Australia 2025 trip would read "day 261 of 310". Nothing here
// changes a post on its own — the tool SHOWS what it measured and offers it;
// the author decides.
//
// Three sources, and which one it was is part of the answer:
// - `exif` — `DateTimeOriginal`, the camera's own record of the shutter, read
//   from the file in hand.
// - `source` — the same field as the instance the picture came from parsed it
//   at ingest (a Winnow photo proxy is a re-encode with no EXIF at all). A
//   notch below: an instance that found no EXIF stores the file's mtime in the
//   same column, and the wire cannot tell the two apart.
// - `file` — the file's modified time, a WEAK fallback (a copy, an export or a
//   re-grade rewrites it), labelled as such wherever it is shown.
// The file's own EXIF wins over the source's, the general rule for vouched
// metadata: the bytes in hand are the picture, the column is a record of it.
//
// The web reads the file's head itself (`file.slice(0, EXIF_SLICE_BYTES)`);
// here the app reads those bytes and hands them in (`head`), so the kernel
// stays pure. The web's `File` is the library's handle, a `SavedMediaRef`, and
// what a source vouched for it with is the identity registry's
// (`Projects/MediaIdentity.swift`) — the EXIF riding beside the origin there.

import Foundation

/// Which of the three answered.
public enum CaptureDateSource: String, CaseIterable, Sendable {
    case exif
    case source
    case file
}

public struct CaptureDate: Equatable, Sendable {
    public var date: IsoDate
    public var source: CaptureDateSource
    /// For `source`: which instance vouched for it, so the panel can say so.
    public var via: String?

    public init(date: IsoDate, source: CaptureDateSource, via: String? = nil) {
        self.date = date; self.source = source; self.via = via
    }
}

private func isAsciiDigit(_ b: UInt8) -> Bool { b >= 48 && b <= 57 }

/// EXIF writes `YYYY:MM:DD HH:MM:SS` in the camera's LOCAL time with no zone,
/// which is exactly what a day wants: the day a photo belongs to is the day it
/// was where it was taken, never a UTC conversion of it. So the date half is
/// read as written (`^(\d{4})[:-](\d{2})[:-](\d{2})`) and the clock dropped.
/// Nil for anything that is not a real calendar day — a camera with a flat
/// clock battery writes `0000:00:00`.
public func isoFromExifDateTime(_ value: String?) -> IsoDate? {
    guard let value else { return nil }
    let bytes = Array(value.trimmingCharacters(in: .whitespacesAndNewlines).utf8.prefix(10))
    guard bytes.count == 10 else { return nil }
    let separators: Set<UInt8> = [UInt8(ascii: ":"), UInt8(ascii: "-")]
    for i in [0, 1, 2, 3, 5, 6, 8, 9] where !isAsciiDigit(bytes[i]) { return nil }
    guard separators.contains(bytes[4]), separators.contains(bytes[7]) else { return nil }
    let year = String(decoding: bytes[0..<4], as: UTF8.self)
    let month = String(decoding: bytes[5..<7], as: UTF8.self)
    let day = String(decoding: bytes[8..<10], as: UTF8.self)
    let iso = "\(year)-\(month)-\(day)"
    return parseIsoDate(iso) == nil ? nil : iso
}

/// A file timestamp (epoch ms) as the calendar day it was in the READER's
/// zone — `lastModified` is an instant, and the day it fell on depends on
/// where you are. Local is the right frame for the same reason as above: the
/// question is which day a human would file this under. The zone is an input
/// (the app passes `.current`).
public func isoFromTimestamp(_ ms: Double, timeZone: TimeZone = .current) -> IsoDate? {
    guard ms.isFinite, ms > 0, ms < 8.64e15 else { return nil }
    let instant = Date(timeIntervalSince1970: ms / 1000)
    return todayIso(now: ms, utcOffsetSeconds: timeZone.secondsFromGMT(for: instant))
}

/// The day a file was captured and, when its EXIF says, where.
public struct Capture: Equatable, Sendable {
    public var date: CaptureDate?
    /// Where it was shot, from the file's EXIF or the source's record; nil when neither says.
    public var coords: GeoPoint?

    public init(date: CaptureDate?, coords: GeoPoint?) { self.date = date; self.coords = coords }
}

/// The day AND the position, from one read of the file's head — the chooser
/// that dates a hundred pictures must not read a hundred heads twice. `head`
/// is the file's first `exifSliceBytes` (EXIF sits at the head of a JPEG or a
/// TIFF-based RAW), or nil when it could not be read — not an error worth
/// surfacing: the fallbacks answer, less confidently. The position follows the
/// date's rule — the file's own EXIF, else the source's record of it — and is
/// never a guess, so there is no third rung.
public func readCapture(_ file: SavedMediaRef, head: Data?, identities: MediaIdentities = .shared,
                        timeZone: TimeZone = .current) -> Capture {
    var exifDate: IsoDate? = nil
    var coords: GeoPoint? = nil
    if let head {
        let exif = parseExif(head)
        exifDate = isoFromExifDateTime(exif.dateTimeOriginal)
        if let gps = exif.gps, gps.lat.isFinite, gps.lon.isFinite { coords = GeoPoint(lat: gps.lat, lon: gps.lon) }
    }
    let known = identities.identity(of: file)
    if coords == nil, let gps = known?.exif?.gps, gps.lat.isFinite, gps.lon.isFinite {
        coords = GeoPoint(lat: gps.lat, lon: gps.lon)
    }
    if let exifDate { return Capture(date: CaptureDate(date: exifDate, source: .exif), coords: coords) }
    if let vouched = isoFromExifDateTime(known?.exif?.dateTimeOriginal) {
        return Capture(date: CaptureDate(date: vouched, source: .source, via: known?.origin?.sourceId), coords: coords)
    }
    let stamp = isoFromTimestamp(file.lastModified, timeZone: timeZone)
    return Capture(date: stamp.map { CaptureDate(date: $0, source: .file) }, coords: coords)
}

/// The day a file was captured — `readCapture`'s date.
public func readCaptureDate(_ file: SavedMediaRef, head: Data?, identities: MediaIdentities = .shared,
                            timeZone: TimeZone = .current) -> CaptureDate? {
    readCapture(file, head: head, identities: identities, timeZone: timeZone).date
}
