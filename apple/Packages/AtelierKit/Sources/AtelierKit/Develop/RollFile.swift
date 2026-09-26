// The roll file — a whole roll on disk as JSON, `.roll.json` — in the web's
// own two steps, and the roll on the wire. The rest of
// `src/shared/develop/roll-file.ts`: `Roll.swift` already carries
// `rollFileKind`, `rollFileExtension`, `RollFileError`, `rollFileJSON`,
// `rollFileName` and a one-step `parseRollFile` (text → new roll); this adds
// the file as a VALUE (`RollFile`, `toRollFile`, `serializeRollFile`), the
// parse that stops at the file (`readRollFile` — named apart, since
// `parseRollFile(text)` already names the one-step import) and the import
// from it (`rollDocFromFile`). Plus the pure half of
// `src/shared/develop/roll-remote.ts`: `toWireDoc` / `fromWireDoc`.
//
// Rules kept (`develop-roll.md`, the trip file's): a file is a BACKUP and a
// transfer, never a template; it carries everything but what only means
// something where it was written — the id (fresh on import, each PICTURE's
// too, since thumbnails and working previews are keyed by picture id alone),
// the source, the timestamps; the media REFS travel, hash and asset id
// included; a file from a NEWER version is refused rather than half-read.
// On the wire, `sourceId` never travels and the id and source come back from
// the REQUEST, the body read through `readRollDoc` like a stored roll.

import Foundation

/// A stored body that is not the document it was asked for — the web's
/// `WinnowError('protocol', …)` from a wire reader. A later port of the Winnow
/// client maps it onto its own error; the push/pull machinery reads it as a
/// `PushFailure.protocol`.
public struct WireDocError: Error, Equatable, Sendable {
    public var message: String
    public var kind: PushFailure { .protocol }
    public init(message: String) { self.message = message }
}

/// What a file picker accepts for a roll.
public let rollFileAccept = ".json,application/json"

/// What a roll file carries — the document minus what is machine-bound.
public struct RollFile: Equatable, Sendable {
    public var kind: String
    public var version: Int
    /// ISO timestamp, for the human reading the file.
    public var exportedAt: String
    public var name: String
    public var pictures: [RollPicture]
    public var export: RollExport

    public init(kind: String = rollFileKind, version: Int = rollDocVersion, exportedAt: String, name: String,
                pictures: [RollPicture], export: RollExport) {
        self.kind = kind; self.version = version; self.exportedAt = exportedAt; self.name = name
        self.pictures = pictures; self.export = export
    }

    /// The file as it is written: exactly the six keys the web's carries.
    public var json: JSONValue {
        .object([
            "kind": .string(kind), "version": .number(Double(version)), "exportedAt": .string(exportedAt),
            "name": .string(name), "pictures": .array(pictures.map(\.json)), "export": export.json,
        ])
    }
}

/// `new Date(ms).toISOString()`.
private func isoInstant(_ ms: Double) -> String {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    iso.timeZone = TimeZone(identifier: "UTC")
    return iso.string(from: Date(timeIntervalSince1970: ms / 1000))
}

public func toRollFile(_ roll: RollDoc, exportedAt: Double = nowMillis()) -> RollFile {
    RollFile(exportedAt: isoInstant(exportedAt), name: roll.name, pictures: roll.pictures, export: roll.export)
}

/// Indented on purpose: the file is meant to be readable and diffable.
public func serializeRollFile(_ file: RollFile) -> String {
    file.json.serialized(pretty: true) + "\n"
}

/// A file's text into a roll FILE, or the reason it is not one — the web's
/// `parseRollFile`. The input comes from a disk and may be anything: this never
/// throws, and every refusal is something a person can act on. The body is read
/// through the same `readRollDoc` a stored roll is, so a file cannot mean
/// something a store would not; a pre-v5 file's one look lands on every picture.
public func readRollFile(_ text: String) -> Result<RollFile, RollFileError> {
    guard let raw = JSONValue.parse(text) else { return .failure(.notJSON) }
    guard let body = raw.objectValue else { return .failure(.notARoll("That file is not an Atelier roll.")) }
    guard body["kind"]?.stringValue == rollFileKind else {
        return .failure(.notARoll("That file is not an Atelier roll (wrong or missing kind)."))
    }
    let version = Int(body["version"]?.finiteNumber ?? 0)
    if version > rollDocVersion { return .failure(.newerVersion(version)) }
    guard body["pictures"]?.arrayValue != nil else { return .failure(.noPictures) }
    var withId = body
    withId["id"] = .string("file")
    guard let read = readRollDoc(.object(withId)) else { return .failure(.notARoll("That file is not an Atelier roll.")) }
    return .success(RollFile(exportedAt: body["exportedAt"]?.stringValue ?? "", name: read.name,
                             pictures: read.pictures, export: read.export))
}

/// A brand-new roll from a file — the import: a fresh id, fresh timestamps,
/// the importing source, and a fresh id for every PICTURE (`makeId`), so the
/// same file imported twice is two rolls that share nothing.
public func rollDocFromFile(_ file: RollFile, now: Double = nowMillis(), sourceId: String = defaultSourceId,
                            makeId: () -> String = newRollId) -> RollDoc {
    var doc = createRollDoc(name: file.name, sourceId: sourceId, now: now)
    doc.pictures = file.pictures.map { picture in
        var copy = picture
        copy.id = makeId()
        return copy
    }
    doc.export = file.export
    return doc
}

/// The roll as an instance's document bucket stores it: everything but where it is kept.
public func toWireDoc(_ doc: RollDoc) -> JSONValue {
    guard var o = doc.json.objectValue else { return .null }
    o["sourceId"] = nil
    return .object(o)
}

/// A stored body back into a roll, id and source from the request — never
/// from the body; a body that is not a roll is refused.
public func fromWireDoc(_ raw: JSONValue?, _ id: String, _ sourceId: String) throws -> RollDoc {
    guard var body = raw?.objectValue else { throw WireDocError(message: "The stored copy of \(id) is not a roll.") }
    body["id"] = .string(id)
    body["sourceId"] = .string(sourceId)
    guard let doc = readRollDoc(.object(body), fallbackSourceId: sourceId) else {
        throw WireDocError(message: "The stored copy of \(id) is not a roll.")
    }
    return doc
}
