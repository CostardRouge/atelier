// Two accounts of one photograph's EXIF, reconciled — port of
// `src/shared/exif/merge-exif.ts`.
//
// A picture can arrive with its metadata stripped — a source's editing
// rendition is a re-encode, and a re-encode drops EXIF — while the source that
// handed it over parsed the original at ingest and knows all of it. Both are
// worth having, and they are not equal: **the file wins**. What is in the
// bytes is the truth about the file on the stage; the source's account is the
// truth about the capture it was made from, which is the right answer only
// where the file is silent.
//
// Merged field by field rather than record by record, because a stripped file
// is rarely empty — a WebP still declares its pixel size — and taking either
// whole would throw away half the answer.

import Foundation

/// `file` where it has a value, `source` where it does not. Nil only when
/// neither says anything at all.
public func mergeExif(_ file: ExifData?, _ source: ExifData?) -> ExifData? {
    guard let file else { return source }
    guard let source else { return file }
    var merged = source
    merged.make = file.make ?? source.make
    merged.model = file.model ?? source.model
    merged.lensMake = file.lensMake ?? source.lensMake
    merged.lensModel = file.lensModel ?? source.lensModel
    merged.software = file.software ?? source.software
    merged.artist = file.artist ?? source.artist
    merged.copyright = file.copyright ?? source.copyright
    merged.imageDescription = file.imageDescription ?? source.imageDescription
    merged.iso = file.iso ?? source.iso
    merged.exposureTime = file.exposureTime ?? source.exposureTime
    merged.fNumber = file.fNumber ?? source.fNumber
    merged.focalLength = file.focalLength ?? source.focalLength
    merged.focalLength35 = file.focalLength35 ?? source.focalLength35
    merged.exposureBias = file.exposureBias ?? source.exposureBias
    merged.exposureProgram = file.exposureProgram ?? source.exposureProgram
    merged.meteringMode = file.meteringMode ?? source.meteringMode
    merged.whiteBalance = file.whiteBalance ?? source.whiteBalance
    merged.flash = file.flash ?? source.flash
    merged.pixelWidth = file.pixelWidth ?? source.pixelWidth
    merged.pixelHeight = file.pixelHeight ?? source.pixelHeight
    merged.orientation = file.orientation ?? source.orientation
    merged.dateTimeOriginal = file.dateTimeOriginal ?? source.dateTimeOriginal
    merged.gps = file.gps ?? source.gps
    merged.gpsAltitude = file.gpsAltitude ?? source.gpsAltitude
    merged.relativeAltitude = file.relativeAltitude ?? source.relativeAltitude
    return merged
}
