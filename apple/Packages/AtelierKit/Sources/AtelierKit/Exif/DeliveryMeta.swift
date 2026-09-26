// What a delivered picture SAYS beyond the capture's own EXIF — port of
// `src/shared/exif/delivery-meta.ts`: who made it, whose it is, and what
// wrote it (`docs/lightroom-gaps.md` §9, M1).
//
// The capture's metadata travels on its own account (`StampExif.swift`);
// this module is the AUTHOR's half, written over it. The rules it keeps:
// - **The signature, always**: `Software` in the EXIF and `xmp:CreatorTool`
//   in the XMP both say `Atelier` (`SoftwareMark.swift`), on every delivered
//   file — including one whose capture is unknown. It is not a switch.
// - **The rights**, from an IDENTITY set once per person and kept with the
//   preset book: `Artist` + `dc:creator`, `Copyright` + `dc:rights`. The
//   copyright is a TEMPLATE whose `{year}` is the CAPTURE's year (a picture
//   taken in 2024 and exported today is © 2024) and whose `{creator}` is the
//   name. Nothing is written until a name is set: no person's name is anybody's
//   default, and "© 2026 . All rights reserved." is worse than no line.
// - **The words**, the PICTURE's own: a title as `dc:title` (EXIF has no title
//   tag worth writing), a caption as `dc:description` and EXIF
//   `ImageDescription`.
// - **The place** (`DeliveryPlace.swift`): `photoshop:City`,
//   `photoshop:Country`, `Iptc4xmpCore:CountryCode` — XMP only.
// - Written twice, EXIF and XMP, because readers split; the XMP is ONE packet,
//   so the Ultra HDR container FOLDS this packet's descriptions into its own
//   (`xmpDescriptions`, `UltraHDR.swift`) rather than writing beside it.
//
// The packet is text, built exactly as the web builds it — same attribute
// order, same escapes — so a file from either client reads the same.

import Foundation

/// Who signs a delivered picture — one per person, kept with the preset book.
public struct DeliveryIdentity: Equatable, Sendable {
    /// The name written as `Artist` and `dc:creator`. Empty: no rights are written.
    public var creator: String
    /// The copyright line as a template: `{year}` is the capture's year, `{creator}` the name.
    public var copyright: String

    public init(creator: String, copyright: String) {
        self.creator = creator; self.copyright = copyright
    }
}

/// The line a copyright takes until its author writes another — English, the suite's language.
public let defaultCopyrightTemplate = "© {year} {creator}. All rights reserved."

public let emptyIdentity = DeliveryIdentity(creator: "", copyright: defaultCopyrightTemplate)

private func trimmed(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// A stored identity, or the empty one. Text is trimmed; an empty template falls back to the default.
public func readIdentity(_ raw: JSONValue?) -> DeliveryIdentity {
    guard let r = raw?.objectValue else { return emptyIdentity }
    let creator = r["creator"]?.stringValue.map(trimmed) ?? ""
    let copyright = r["copyright"]?.stringValue.map(trimmed) ?? ""
    return DeliveryIdentity(creator: creator, copyright: copyright.isEmpty ? defaultCopyrightTemplate : copyright)
}

public func sameIdentity(_ a: DeliveryIdentity, _ b: DeliveryIdentity) -> Bool {
    a.creator == b.creator && a.copyright == b.copyright
}

private let captureYearRe = try! NSRegularExpression(pattern: #"^(\d{4})[:-]"#)

/// The year a picture was TAKEN, from an EXIF `DateTimeOriginal`
/// (`YYYY:MM:DD HH:MM:SS`), else `fallback` — the export's own year, for a
/// picture whose capture time nobody knows. A camera with a flat clock
/// battery writes `0000`, which is refused (the first photograph is 1826).
public func captureYear(_ dateTimeOriginal: String?, _ fallback: Int) -> Int {
    let text = trimmed(dateTimeOriginal ?? "")
    guard let m = captureYearRe.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let r = Range(m.range(at: 1), in: text),
          let year = Int(text[r])
    else { return fallback }
    return year >= 1826 && year <= 9999 ? year : fallback
}

/// The rights a picture carries, resolved: the name and the copyright line, or nil for each that says nothing.
public struct DeliveryRights: Equatable, Sendable {
    public var creator: String?
    public var copyright: String?
    public init(creator: String? = nil, copyright: String? = nil) {
        self.creator = creator; self.copyright = copyright
    }
}

/// The identity applied to one picture. No name, no rights at all; a
/// template with no `{creator}` in it stands on its own once there is a name.
public func resolveRights(_ identity: DeliveryIdentity?, _ year: Int) -> DeliveryRights {
    let creator = identity.map { trimmed($0.creator) } ?? ""
    if creator.isEmpty { return DeliveryRights(creator: nil, copyright: nil) }
    let own = identity.map { trimmed($0.copyright) } ?? ""
    let template = own.isEmpty ? defaultCopyrightTemplate : own
    let line = trimmed(
        template
            .replacingOccurrences(of: "{year}", with: String(year))
            .replacingOccurrences(of: "{creator}", with: creator)
    )
    return DeliveryRights(creator: creator, copyright: line.isEmpty ? nil : line)
}

/// What the XMP packet of one delivered picture says.
public struct DeliveryText: Equatable, Sendable {
    public var creator: String?
    public var copyright: String?
    /// The picture's own title — `dc:title` (M2).
    public var title: String?
    /// The picture's caption — `dc:description`, and EXIF `ImageDescription` beside it (M2).
    public var caption: String?
    /// Where it was taken, named offline (M4, `DeliveryPlace.swift`).
    public var place: DeliveryPlace?

    public init(creator: String? = nil, copyright: String? = nil, title: String? = nil,
                caption: String? = nil, place: DeliveryPlace? = nil) {
        self.creator = creator; self.copyright = copyright; self.title = title
        self.caption = caption; self.place = place
    }
}

private enum XmpNS {
    static let x = "adobe:ns:meta/"
    static let rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    static let xmp = "http://ns.adobe.com/xap/1.0/"
    static let dc = "http://purl.org/dc/elements/1.1/"
    static let xmpRights = "http://ns.adobe.com/xap/1.0/rights/"
    static let photoshop = "http://ns.adobe.com/photoshop/1.0/"
    static let iptc = "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
}

/// Text as XML character data or an attribute value.
public func escapeXml(_ text: String) -> String {
    var out = ""
    out.reserveCapacity(text.count)
    for c in text.unicodeScalars {
        switch c {
        case "&": out += "&amp;"
        case "<": out += "&lt;"
        case ">": out += "&gt;"
        case "\"": out += "&quot;"
        case "'": out += "&apos;"
        default: out.unicodeScalars.append(c)
        }
    }
    return out
}

/// A language alternative with its one default entry — how XMP holds rights, a title, a caption.
private func alt(_ name: String, _ text: String) -> String {
    "<\(name)><rdf:Alt><rdf:li xml:lang=\"x-default\">\(escapeXml(text))</rdf:li></rdf:Alt></\(name)>"
}

/// Truthy as the web reads a `string | null | undefined`: present and not empty.
private func said(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}

/// The `rdf:Description` of one delivered picture: the signature always, the
/// rest where there is something to say.
public func deliveryDescription(_ text: DeliveryText) -> String {
    var attrs = ["xmp:CreatorTool=\"\(atelierSoftware)\""]
    var children: [String] = []
    if let creator = said(text.creator) {
        children.append("<dc:creator><rdf:Seq><rdf:li>\(escapeXml(creator))</rdf:li></rdf:Seq></dc:creator>")
    }
    if let copyright = said(text.copyright) {
        attrs.append("xmpRights:Marked=\"True\"")
        children.append(alt("dc:rights", copyright))
    }
    if let title = said(text.title) { children.append(alt("dc:title", title)) }
    if let caption = said(text.caption) { children.append(alt("dc:description", caption)) }
    if let place = text.place {
        if !place.city.isEmpty { attrs.append("photoshop:City=\"\(escapeXml(place.city))\"") }
        if !place.country.isEmpty { attrs.append("photoshop:Country=\"\(escapeXml(place.country))\"") }
        if !place.countryCode.isEmpty { attrs.append("Iptc4xmpCore:CountryCode=\"\(escapeXml(place.countryCode))\"") }
    }
    let open = "<rdf:Description rdf:about=\"\" xmlns:xmp=\"\(XmpNS.xmp)\" xmlns:dc=\"\(XmpNS.dc)\" xmlns:xmpRights=\"\(XmpNS.xmpRights)\""
        + " xmlns:photoshop=\"\(XmpNS.photoshop)\" xmlns:Iptc4xmpCore=\"\(XmpNS.iptc)\" \(attrs.joined(separator: " "))>"
    return open + children.joined() + "</rdf:Description>"
}

/// A whole XMP packet around `descriptions`, in the shape `UltraHDR.swift`
/// writes its own. The web's `xmpPacket`; labelled here because the
/// container's own private writer already answers to `xmpPacket(_:)`.
public func xmpPacket(descriptions: String) -> String {
    "<?xpacket begin=\"\u{FEFF}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>"
        + "<x:xmpmeta xmlns:x=\"\(XmpNS.x)\" x:xmptk=\"\(atelierSoftware)\">"
        + "<rdf:RDF xmlns:rdf=\"\(XmpNS.rdf)\">"
        + descriptions
        + "</rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
}

/// The packet a delivered picture carries.
public func deliveryXmp(_ text: DeliveryText) -> String {
    xmpPacket(descriptions: deliveryDescription(text))
}

private let rdfOpenRe = try! NSRegularExpression(pattern: #"<rdf:RDF\b[^>]*>"#)

/// The `rdf:Description`s inside a packet, verbatim — what a second writer
/// (the Ultra HDR container) folds into its own packet so the file keeps ONE.
/// Empty when the packet holds none it can read.
public func xmpDescriptions(_ packet: String) -> String {
    guard let m = rdfOpenRe.firstMatch(in: packet, range: NSRange(packet.startIndex..., in: packet)),
          let open = Range(m.range, in: packet),
          let close = packet.range(of: "</rdf:RDF>", options: .backwards)
    else { return "" }
    // The web's `close < open.index` refuses a close before the open tag; a
    // close inside it slices nothing, as `String.slice` does.
    if close.lowerBound < open.lowerBound || close.lowerBound < open.upperBound { return "" }
    return trimmed(String(packet[open.upperBound..<close.lowerBound]))
}
