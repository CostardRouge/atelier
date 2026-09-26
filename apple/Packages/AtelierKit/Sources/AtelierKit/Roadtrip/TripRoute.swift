// Where you are in Road Trip, expressed as a route. Port of
// `src/shared/roadtrip/trip-route.ts`.
//
// On the web the route lives in the hash (`#/roadtrip/<trip>/<day>/<piece>`),
// so Back lands on the day you were on, a reload survives and a day is
// linkable. The app keeps the SAME path: it maps it onto a navigation path
// and reads it from a deep link, so a link made by either client opens the
// same place in the other.
//
// The trip's part is `<slug>-<first 8 of its id>` — `australia-3b525ba1`. The
// slug is there to be read and is otherwise ignored; the id fragment is what
// resolves, so renaming a trip cannot break a link and two trips called
// "Australia" stay distinguishable. The day is a plain `YYYY-MM-DD`, which is
// the one part anyone actually reads.
//
// The percent-encoding is JavaScript's own (`encodeURIComponent`, and
// `URLSearchParams`' form encoding for a timeline link's query), so a path
// built here is byte for byte the one the web builds. One divergence: a
// malformed escape in a path makes the web's `decodeURIComponent` THROW; here
// the path reads as nowhere in particular.

import Foundation

/// How many characters of the id go in a reference.
private let tripRefIdChars = 8

/// The web's `ROADTRIP_BASE`.
public let roadtripBase = "/roadtrip"
/// The web's `ROADTRIP_HOME`.
public let roadtripHome = "/roadtrip/home"

/// `Australie / Ouest` → `australie-ouest`. Empty for a nameless trip.
public func tripSlug(_ name: String) -> String {
    // NFD, then the combining marks U+0300–U+036F dropped, then lower case —
    // the web's order, which matters: a mark lower-casing produces is kept.
    let stripped = String(String.UnicodeScalarView(
        name.decomposedStringWithCanonicalMapping.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }))
    let lowered = stripped.lowercased()
    // `[^a-z0-9]+` → `-`.
    var out = ""
    var inRun = false
    for scalar in lowered.unicodeScalars {
        let v = scalar.value
        if (v >= 0x61 && v <= 0x7A) || (v >= 0x30 && v <= 0x39) {
            out.unicodeScalars.append(scalar)
            inRun = false
        } else if !inRun {
            out.append("-")
            inRun = true
        }
    }
    // `^-|-$`, once each end (a run is already one dash).
    if out.hasPrefix("-") { out.removeFirst() }
    if out.hasSuffix("-") { out.removeLast() }
    // Every character is ASCII now, so 40 characters are 40 UTF-16 units.
    return String(out.prefix(40))
}

private func utf16Prefix(_ s: String, _ n: Int) -> String {
    String(decoding: Array(s.utf16.prefix(n)), as: UTF16.self)
}

private func utf16Suffix(_ s: String, _ n: Int) -> String {
    String(decoding: Array(s.utf16.suffix(n)), as: UTF16.self)
}

/// The readable-but-resolvable reference for a trip, from its id and name.
public func tripRef(id: String, name: String) -> String {
    let slug = tripSlug(name)
    let tail = utf16Prefix(id.replacingOccurrences(of: "-", with: ""), tripRefIdChars)
    return slug.isEmpty ? tail : "\(slug)-\(tail)"
}

/// The trip a reference points at, or nil. Matched on the id fragment alone,
/// so a renamed trip keeps every link that was ever made to it. `id` reads a
/// trip's id — the web's `{ id }` constraint.
public func tripFromRef<T>(_ ref: String, _ trips: [T], id: (T) -> String) -> T? {
    if ref.isEmpty { return nil }
    let tail = utf16Suffix(ref, tripRefIdChars).lowercased()
    func flat(_ s: String) -> String { s.replacingOccurrences(of: "-", with: "").lowercased() }
    if let hit = trips.first(where: { flat(id($0)).hasPrefix(tail) }) { return hit }
    // A full id in the path (an older link, or one typed by hand) still works.
    let whole = ref.lowercased()
    return trips.first(where: { id($0).lowercased() == whole })
}

/// Whether a timeline link seeds a trip or completes one.
public enum TimelineLinkKind: String, Sendable {
    /// Creates a trip from the timeline.
    case seed
    /// Reconciles the timeline into a trip.
    case complete
}

/// A link from a Winnow into Road Trip — a PROPOSAL the person confirms on a
/// screen, never an action the URL performs (`docs/winnow-timeline.md` §5.5).
///
/// `source` is the instance's host. The URL may say what to open, never where
/// to fetch from: the shell resolves the host against the connections it
/// already holds. `chapters` narrows a seed to the legs the link named;
/// empty means all.
public struct TimelineLink: Equatable, Sendable {
    public var kind: TimelineLinkKind
    public var source: String
    public var chapters: [String]
    public init(kind: TimelineLinkKind, source: String, chapters: [String]) {
        self.kind = kind; self.source = source; self.chapters = chapters
    }
}

public struct RoadtripRoute: Equatable, Sendable {
    /// Nil on the gallery, when nothing else is addressed.
    public var ref: String?
    public var date: IsoDate?
    public var postId: String?
    /// Set when the route is a timeline link; nil on an ordinary route.
    public var link: TimelineLink?
    public init(ref: String?, date: IsoDate?, postId: String?, link: TimelineLink? = nil) {
        self.ref = ref; self.date = date; self.postId = postId; self.link = link
    }

    /// The gallery. The web's `NOWHERE`.
    public static let nowhere = RoadtripRoute(ref: nil, date: nil, postId: nil)
}

// MARK: - JavaScript's URI encodings

private let hexDigits: [Character] = Array("0123456789ABCDEF")

private func percentByte(_ b: UInt8) -> String {
    "%" + String(hexDigits[Int(b >> 4)]) + String(hexDigits[Int(b & 0x0F)])
}

private func hexValue(_ c: UInt8) -> UInt8? {
    switch c {
    case 48...57: return c - 48
    case 65...70: return c - 55
    case 97...102: return c - 87
    default: return nil
    }
}

private func isAsciiAlnum(_ b: UInt8) -> Bool {
    (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)
}

/// `encodeURIComponent`: everything but `A–Z a–z 0–9 - _ . ! ~ * ' ( )` escaped, as UTF-8.
private func encodeURIComponentJS(_ s: String) -> String {
    let keep = Set("-_.!~*'()".utf8)
    var out = ""
    for b in s.utf8 {
        if isAsciiAlnum(b) || keep.contains(b) { out.unicodeScalars.append(Unicode.Scalar(b)) } else { out += percentByte(b) }
    }
    return out
}

/// `decodeURIComponent`, or nil where the web would throw a `URIError` — a
/// `%` not followed by two hex digits, or escapes that are not UTF-8.
private func decodeURIComponentJS(_ s: String) -> String? {
    let bytes = Array(s.utf8)
    var out: [UInt8] = []
    out.reserveCapacity(bytes.count)
    var i = 0
    while i < bytes.count {
        if bytes[i] == UInt8(ascii: "%") {
            guard i + 2 < bytes.count, let hi = hexValue(bytes[i + 1]), let lo = hexValue(bytes[i + 2]) else {
                return nil
            }
            out.append(hi << 4 | lo)
            i += 3
        } else {
            out.append(bytes[i])
            i += 1
        }
    }
    let text = String(decoding: out, as: UTF8.self)
    // A repair (U+FFFD for a bad sequence) is what the web refuses.
    return Array(text.utf8) == out ? text : nil
}

/// `URLSearchParams`' parse: `&`-separated pairs, `+` as a space, a lenient
/// percent-decode (a stray `%` stays), UTF-8 with replacement.
private func formDecode(_ s: String) -> String {
    let bytes = Array(s.utf8)
    var out: [UInt8] = []
    var i = 0
    while i < bytes.count {
        let b = bytes[i]
        if b == UInt8(ascii: "+") {
            out.append(0x20)
            i += 1
        } else if b == UInt8(ascii: "%"), i + 2 < bytes.count, let hi = hexValue(bytes[i + 1]), let lo = hexValue(bytes[i + 2]) {
            out.append(hi << 4 | lo)
            i += 3
        } else {
            out.append(b)
            i += 1
        }
    }
    return String(decoding: out, as: UTF8.self)
}

private func formPairs(_ query: String) -> [(name: String, value: String)] {
    query.split(separator: "&", omittingEmptySubsequences: true).map { part in
        let text = String(part)
        if let eq = text.firstIndex(of: "=") {
            return (formDecode(String(text[..<eq])), formDecode(String(text[text.index(after: eq)...])))
        }
        return (formDecode(text), "")
    }
}

/// `URLSearchParams`' serialisation of one name or value: a space as `+`,
/// `* - . _` and ASCII letters and digits kept, everything else escaped.
private func formEncode(_ s: String) -> String {
    let keep = Set("*-._".utf8)
    var out = ""
    for b in s.utf8 {
        if b == 0x20 {
            out += "+"
        } else if isAsciiAlnum(b) || keep.contains(b) {
            out.unicodeScalars.append(Unicode.Scalar(b))
        } else {
            out += percentByte(b)
        }
    }
    return out
}

/// A host, and only a host — no scheme, no path, no space:
/// `^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$`, case-insensitive.
private func isBareHost(_ s: String) -> Bool {
    let bytes = Array(s.utf8)
    var host = bytes[...]
    if let colon = bytes.firstIndex(of: UInt8(ascii: ":")) {
        let port = bytes[(colon + 1)...]
        guard (1...5).contains(port.count), port.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return false }
        host = bytes[..<colon]
    }
    guard let first = host.first, let last = host.last, isAsciiAlnum(first), isAsciiAlnum(last) else { return false }
    return host.allSatisfy { isAsciiAlnum($0) || $0 == UInt8(ascii: ".") || $0 == UInt8(ascii: "-") }
}

/// The `?source=…&chapters=…` part of a link, or nil when it names no source.
private func parseLinkQuery(_ query: String) -> (source: String, chapters: [String])? {
    let pairs = formPairs(query)
    let raw = pairs.first(where: { $0.name == "source" })?.value ?? ""
    let source = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if source.isEmpty || !isBareHost(source) { return nil }
    let chapters = pairs.filter { $0.name == "chapters" }
        .flatMap { $0.value.components(separatedBy: ",") }
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    return (source, chapters)
}

/// Read `/roadtrip/<ref>/<date>/<postId>`, any tail of which may be absent.
/// `/roadtrip` and `/roadtrip/home` both mean the gallery; a date that is not
/// a real calendar day is dropped rather than carried, along with anything
/// that followed it — half a route is worse than none.
///
/// Two more shapes are the timeline links: `/roadtrip/new?source=<host>` seeds
/// a trip, `/roadtrip/<ref>/import?source=<host>` completes one. A link with
/// no usable source is read as the plain route underneath it.
public func parseRoadtripPath(_ path: String) -> RoadtripRoute {
    // Scalar by scalar, as the web's string methods read: a combining mark
    // after `p` or `?` must not hide them the way a grapheme would.
    let scalars = path.unicodeScalars
    guard scalars.starts(with: roadtripBase.unicodeScalars) else { return .nowhere }
    func text<S: Sequence>(_ s: S) -> String where S.Element == Unicode.Scalar {
        var out = String.UnicodeScalarView()
        out.append(contentsOf: s)
        return String(out)
    }
    let bareScalars: [Unicode.Scalar]
    let query: String
    if let q = scalars.firstIndex(of: "?") {
        bareScalars = Array(scalars[..<q])
        query = text(scalars[scalars.index(after: q)...])
    } else {
        bareScalars = Array(scalars)
        query = ""
    }
    var restScalars = bareScalars.dropFirst(roadtripBase.unicodeScalars.count)
    if restScalars.first == "/" { restScalars = restScalars.dropFirst() }
    let rest = text(restScalars)
    if rest.isEmpty || rest == "home" { return .nowhere }
    var parts: [String] = []
    for piece in rest.components(separatedBy: "/") {
        guard let decoded = decodeURIComponentJS(piece) else { return .nowhere }
        parts.append(decoded)
    }
    let ref = parts[0]
    let second = parts.count > 1 ? parts[1] : nil
    let third = parts.count > 2 ? parts[2] : nil
    if ref == "new" {
        guard let link = parseLinkQuery(query) else { return .nowhere }
        return RoadtripRoute(ref: nil, date: nil, postId: nil,
                             link: TimelineLink(kind: .seed, source: link.source, chapters: link.chapters))
    }
    if second == "import" {
        guard let link = parseLinkQuery(query) else { return RoadtripRoute(ref: ref, date: nil, postId: nil) }
        return RoadtripRoute(ref: ref, date: nil, postId: nil,
                             link: TimelineLink(kind: .complete, source: link.source, chapters: link.chapters))
    }
    guard let date = second, !date.isEmpty, isIsoDate(date) else {
        return RoadtripRoute(ref: ref, date: nil, postId: nil)
    }
    let postId = third.flatMap { $0.isEmpty ? nil : $0 }
    return RoadtripRoute(ref: ref, date: date, postId: postId)
}

/// The path a Winnow puts behind "Make a Road Trip from this leg" (`seed`, no
/// ref) or "Complete this trip" (`complete`, with the trip's ref).
public func timelineLinkPath(_ link: TimelineLink, ref: String? = nil) -> String {
    var query = "source=\(formEncode(link.source))"
    if !link.chapters.isEmpty { query += "&chapters=\(formEncode(link.chapters.joined(separator: ",")))" }
    let head = link.kind == .seed
        ? "\(roadtripBase)/new"
        : "\(roadtripBase)/\(encodeURIComponentJS(ref ?? ""))/import"
    return "\(head)?\(query)"
}

/// The path for a place in the tool. Omit what you are not addressing.
public func roadtripPath(_ ref: String, _ date: IsoDate? = nil, _ postId: String? = nil) -> String {
    var parts = [roadtripBase, encodeURIComponentJS(ref)]
    if let date, !date.isEmpty {
        parts.append(date)
        if let postId, !postId.isEmpty { parts.append(encodeURIComponentJS(postId)) }
    }
    return parts.joined(separator: "/")
}
