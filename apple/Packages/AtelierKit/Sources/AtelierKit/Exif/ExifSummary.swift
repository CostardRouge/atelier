// A photograph's exposure as one readable line — port of
// `src/shared/exif/exif-summary.ts`: body, lens, focal length, aperture,
// shutter, ISO — and, for a stage where the body is already named, the four
// facts a photographer reads at speed (`captureLine`).
//
// The rules it keeps:
// - Every field is optional and a missing one is simply absent — the line
//   never says `—` and never guesses, exactly like the elements that draw
//   these values.
// - A model that already carries its maker's name does not want it twice; a
//   lens whose name repeats the body is dropped.
// - A compensation of zero says nothing — a camera left on its own reading is
//   the default, not a decision.
// - The numbers are the web's `String(Math.round(n * 100) / 100)` and its
//   signed one-decimal text with a typographic minus (`ExifText`, in
//   `ExifCue.swift`).

import Foundation

private func trimmedOrNil(_ s: String?) -> String? {
    guard let s else { return nil }
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : t
}

private func positive(_ n: Double?) -> Double? {
    guard let n, n.isFinite, n > 0 else { return nil }
    return n
}

/// A model that already carries its maker's name does not want it twice.
public func cameraName(_ exif: ExifData) -> String? {
    let model = trimmedOrNil(exif.model)
    let make = trimmedOrNil(exif.make)
    guard let model else { return make }
    guard let make else { return model }
    return model.lowercased().hasPrefix(make.lowercased()) ? model : "\(make) \(model)"
}

/// The exposure line, `·`-joined, or `""` when the picture says nothing.
///
/// `body` overrides the camera name — a source that keeps its own display
/// label (Winnow's `camera_model`) passes it rather than having it inferred.
/// A lens whose name repeats the body is dropped: `DJI Mini 4 Pro` twice on
/// one line is noise, not a second fact.
public func exposureSummary(_ exif: ExifData?, body: String? = nil) -> String {
    guard let exif else { return body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
    var parts: [String] = []
    let camera = trimmedOrNil(body) ?? cameraName(exif)
    if let camera { parts.append(camera) }

    let lens = trimmedOrNil(exif.lensModel) ?? trimmedOrNil(exif.lensMake)
    if let lens, lens != camera { parts.append(lens) }

    if let focal = positive(exif.focalLength) { parts.append("\(ExifText.rounded2(focal)) mm") }
    if let fNumber = positive(exif.fNumber) { parts.append("ƒ/\(ExifText.rounded2(fNumber))") }
    if let shutter = exifShutter(exif.exposureTime) { parts.append(shutter) }
    if let iso = positive(exif.iso) { parts.append("ISO \(ExifText.jsString(ExifText.jsRound(iso)))") }

    return parts.joined(separator: " · ")
}

/// The four facts a photographer reads at speed, `·`-joined:
/// `ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV`.
///
/// `exposureSummary`'s shorter twin, for a surface that already names the file
/// — the Develop stage, where the body and the lens are one glance away in the
/// bar and the line is drawn OVER the photograph. The compensation is the one
/// fact the long line never carried: it is what says the camera was argued
/// with before this session started. Absent fields are absent, never `—`, and
/// a compensation of zero says nothing. A picture that says nothing yields `""`.
public func captureLine(_ exif: ExifData?) -> String {
    guard let exif else { return "" }
    var parts: [String] = []
    if let fNumber = positive(exif.fNumber) { parts.append("ƒ/\(ExifText.rounded2(fNumber))") }
    if let shutter = exifShutter(exif.exposureTime) { parts.append(shutter) }
    if let iso = positive(exif.iso) { parts.append("ISO \(ExifText.jsString(ExifText.jsRound(iso)))") }
    if let bias = exif.exposureBias, bias.isFinite, ExifText.jsRound(bias * 10) != 0 {
        parts.append("\(ExifText.signed(bias)) EV")
    }
    return parts.joined(separator: " · ")
}
