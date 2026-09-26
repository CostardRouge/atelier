// Which pictures of a roll CHANGED since they were last delivered: a mark per
// picture, written when its file lands, holding a FINGERPRINT of everything
// that decides that file. Port of `src/shared/develop/export-marks.ts`.
//
// A picture whose fingerprint no longer matches its mark is *changed*; one
// with no mark is *new*; the rest are *current*.
//
// What the fingerprint covers is the picture's own: its develop, its look, its
// crop and border, the file it is developed from, its geometry, detail, repair
// and layers, and its title and caption. NOT the roll's export settings (a new
// size is the author's knowing choice for a whole run), not the delivery
// state and not the identity.
//
// Kept BESIDE the roll, never on it: a mark on the document would be a write
// the undo stack records, and it says "the file is in a folder of THIS
// machine" — this device's fact, like a folder handle. The app keeps them in
// a side file beside the roll (`json` / `readExportMarks`).
//
// The key is the web's to the byte for the same picture: the web hashes the
// picture's fields as `JSON.stringify` spells them, so the numbers and the
// strings here are spelt as JavaScript spells them (`1`, not `1.0`; `1e-7`,
// not `1e-07`; the same escapes), the keys sorted by UTF-16 code unit as `<`
// sorts them there.

import Foundation

/// When a picture last left, and as what.
public struct ExportMark: Equatable, Sendable {
    public var at: Double
    /// `exportKey` of the picture as it was rendered.
    public var key: String
    public init(at: Double, key: String) { self.at = at; self.key = key }
}

/// A roll's marks, by picture id.
public typealias ExportMarks = [String: ExportMark]

public enum ExportState: String, Sendable {
    case new, current, changed
}

/// The carried fields of a picture that decide its delivered file.
private let keyedCarried = ["border", "keystone", "lens", "lensProfile", "detail", "vignette", "repair", "layers"]

/// A string as `JSON.stringify` writes it.
private func jsQuoted(_ s: String) -> String {
    var out = "\""
    for u in s.unicodeScalars {
        switch u {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if u.value < 0x20 {
                out += String(format: "\\u%04x", u.value)
            } else {
                out.unicodeScalars.append(u)
            }
        }
    }
    out += "\""
    return out
}

/// A finite number as JavaScript's `Number.prototype.toString` writes it:
/// the shortest digits that read back to the same double (which Swift's
/// `description` also gives), laid out by ECMAScript's rules — plain up to
/// 21 integer digits, plain down to six leading zeros, an exponent past
/// either with no padding (`1e-7`, `1e+21`).
private func jsNumberString(_ n: Double) -> String {
    if n == 0 { return "0" }
    let negative = n < 0
    let text = "\(abs(n))"
    var mantissa = text
    var exponent = 0
    if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
        mantissa = String(text[..<e])
        exponent = Int(text[text.index(after: e)...]) ?? 0
    }
    let parts = mantissa.split(separator: ".", omittingEmptySubsequences: false)
    let intPart = String(parts[0])
    let fracPart = parts.count > 1 ? String(parts[1]) : ""
    var digits = intPart + fracPart
    var point = intPart.count + exponent
    while digits.hasPrefix("0") && digits.count > 1 {
        digits.removeFirst()
        point -= 1
    }
    while digits.hasSuffix("0") && digits.count > 1 { digits.removeLast() }
    let k = digits.count
    let out: String
    if k <= point && point <= 21 {
        out = digits + String(repeating: "0", count: point - k)
    } else if 0 < point && point <= 21 {
        out = digits.prefix(point) + "." + digits.dropFirst(point)
    } else if -6 < point && point <= 0 {
        out = "0." + String(repeating: "0", count: -point) + digits
    } else {
        let e = point - 1
        let sign = e < 0 ? "-" : "+"
        let head = k == 1 ? digits : digits.prefix(1) + "." + digits.dropFirst(1)
        out = head + "e" + sign + "\(abs(e))"
    }
    return negative ? "-" + out : out
}

/// JSON with its keys sorted, so two records that say the same thing print the
/// same way whatever order they were built in. An absent value, `null` and an
/// empty list are one spelling: the roll reads them as the same thing.
private func stable(_ value: JSONValue?) -> String {
    guard let value else { return "null" }
    switch value {
    case .null:
        return "null"
    case .bool(let b):
        return b ? "true" : "false"
    case .number(let n):
        return n.isFinite ? jsNumberString(n) : "null"
    case .string(let s):
        return jsQuoted(s)
    case .array(let list):
        return list.isEmpty ? "null" : "[" + list.map { stable($0) }.joined(separator: ",") + "]"
    case .object(let o):
        // A key whose value says nothing is left out, so absent, `null` and `[]`
        // spell the same record at every depth.
        let entries = o.map { ($0.key, stable($0.value)) }
            .filter { $0.1 != "null" }
            .sorted { $0.0.utf16.lexicographicallyPrecedes($1.0.utf16) }
        return "{" + entries.map { jsQuoted($0.0) + ":" + $0.1 }.joined(separator: ",") + "}"
    }
}

/// FNV-1a, twice with two offsets, as 16 hex digits — a fingerprint, not a
/// secret. Over UTF-16 code units, as `charCodeAt` walks them.
private func fnv1a(_ text: String) -> String {
    var a: UInt32 = 0x811c9dc5
    var b: UInt32 = 0x01000193 ^ 0x5bd1e995
    for unit in text.utf16 {
        let c = UInt32(unit)
        a = (a ^ c) &* 0x01000193
        b = (b ^ c) &* (0x01000193 + 2)
    }
    return String(format: "%08x%08x", a, b)
}

/// The fingerprint of what a picture's delivered file is made of.
public func exportKey(_ picture: RollPicture) -> String {
    var record: [String: JSONValue] = [:]
    record["develop"] = picture.develop?.json ?? .null
    record["grade"] = picture.grade?.json ?? .null
    record["framing"] = picture.framing?.json ?? .null
    // An original aspect with no crop is the same file as no aspect at all.
    record["aspect"] = picture.aspect == "original" ? .null : .string(picture.aspect)
    record["rendition"] = picture.rendition.map { .string($0) } ?? .null
    record["title"] = picture.title.map { .string($0) } ?? .null
    record["caption"] = picture.caption.map { .string($0) } ?? .null
    for key in keyedCarried { record[key] = picture.carried[key] ?? .null }
    return fnv1a(stable(.object(record)))
}

public func exportState(_ picture: RollPicture, _ marks: ExportMarks) -> ExportState {
    guard let mark = marks[picture.id] else { return .new }
    return mark.key == exportKey(picture) ? .current : .changed
}

/// Whether a picture needs delivering again: never delivered, or changed since.
public func needsExport(_ picture: RollPicture, _ marks: ExportMarks) -> Bool {
    exportState(picture, marks) != .current
}

/// The marks after `pictures` landed at `at` — each keyed on the picture AS IT
/// WAS RENDERED, so an edit made while the run was going is still a change.
public func withExported(_ marks: ExportMarks, _ pictures: [RollPicture], at: Double) -> ExportMarks {
    if pictures.isEmpty { return marks }
    var next = marks
    for p in pictures { next[p.id] = ExportMark(at: at, key: exportKey(p)) }
    return next
}

/// Marks as stored, reading nothing it does not recognise.
public func readExportMarks(_ raw: JSONValue?) -> ExportMarks {
    guard let o = raw?.objectValue else { return [:] }
    var out: ExportMarks = [:]
    for (id, v) in o {
        guard let m = v.objectValue, let at = m["at"]?.finiteNumber, let key = m["key"]?.stringValue, !key.isEmpty else { continue }
        out[id] = ExportMark(at: at, key: key)
    }
    return out
}

/// Only the marks of pictures still on the roll — a removed picture's mark is dropped.
public func pruneMarks(_ marks: ExportMarks, _ pictureIds: [String]) -> ExportMarks {
    let keep = Set(pictureIds)
    if marks.keys.allSatisfy({ keep.contains($0) }) { return marks }
    return marks.filter { keep.contains($0.key) }
}

extension Dictionary where Key == String, Value == ExportMark {
    /// The marks as the side file keeps them.
    public var json: JSONValue {
        .object(mapValues { .object(["at": .number($0.at), "key": .string($0.key)]) })
    }
}
