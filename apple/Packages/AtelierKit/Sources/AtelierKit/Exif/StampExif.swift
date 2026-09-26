// Giving a delivered JPEG the metadata of the picture it came from — port of
// `src/shared/exif/stamp-exif.ts`.
//
// The maintainer's rule (2026-09-20): **an export carries the ORIGINAL's
// EXIF, whatever its pixels were taken from.** He develops on a proxy for the
// speed of it — a WebP with no metadata at all — and the file he keeps has to
// read like the capture: its position, its body, its lens, its hour.
//
// Three accounts, in this order — the rules it keeps from the web module:
// 1. The original's own EXIF **block**, copied whole (`ExifBlock.swift`),
//    whenever the original's head bytes hold one: it keeps what no struct
//    models — the maker notes above all. Retagged on the way (orientation 1,
//    the delivered size, the thumbnail cut loose, `Software: Atelier`, the
//    author's tags over the camera's).
// 2. Its **fields**, parsed and rebuilt (`ExifBuild.swift`), for an original
//    whose block cannot be moved — a DNG or an ARW, whose TIFF stream is the
//    whole file — and for a JPEG whenever a capture group is left out
//    (`keepsWholeBlock`): what the fields do not name stays behind. What the
//    source vouched for fills the gaps, never the other way round.
// 3. What the source vouched for alone, when the original is out of reach —
//    the poorest account (Winnow's row has no make, no model, no lens).
// Whichever account — and with none — the block says `Software: Atelier`
// and the XMP `xmp:CreatorTool="Atelier"`: every delivered file is signed.
//
// The author's three tags (`AuthorTag`: keep · clear · write) follow one rule:
// a group left OUT clears the capture's own value too ("no rights" means
// none, not the camera's owner string), while a group kept with nothing to
// say leaves it alone. The rights' year is the CAPTURE's, read before the
// choice drops its time; the place is named from the capture's OWN position,
// read before the choice drops it, so a town can leave without the
// coordinates it came from.
//
// The web's `new Date().getFullYear()` default is a parameter here (`now`,
// in ms): the year a picture with no capture time is signed with, read in
// the device's own time zone as the browser reads it. `stampExif` takes and
// gives bytes where the web takes and gives a `Blob`.

import Foundation

/// Which of the three accounts a block was made from.
public enum ExifAccount: String, Equatable, Sendable {
    case block
    case fields
    case vouched
    case none
}

/// The author's three tags, as the writers take them: a string writes, a
/// clear clears the capture's, a keep leaves it (the web's `string | null |
/// undefined`).
public struct AuthorTags: Equatable, Sendable {
    public var artist: AuthorTag
    public var copyright: AuthorTag
    public var description: AuthorTag

    public init(artist: AuthorTag = .keep, copyright: AuthorTag = .keep, description: AuthorTag = .keep) {
        self.artist = artist; self.copyright = copyright; self.description = description
    }
}

/// The delivered picture's own size — the web's `DeliveredSize`, the kernel's `Size`.
public typealias DeliveredSize = Size

public struct ExportExif: Equatable, Sendable {
    /// What to write. Never nil from `exportExifBlock` since every file is
    /// signed: with no account it is a block holding the signature and the
    /// rights alone. Optional as the web's is.
    public var block: [UInt8]?
    /// Where the CAPTURE's metadata came from — `none` still leaves signed.
    public var account: ExifAccount
    /// The rights written, resolved against the capture's year.
    public var rights: DeliveryRights
    /// The author's tags as written over the capture's — what a rebuild must write again.
    public var tags: AuthorTags
    /// What was asked to leave (`MetaGroups.swift`).
    public var keep: MetaChoice
    /// The place written, or nil.
    public var place: DeliveryPlace?
    /// Whether the capture had a position a place could have been named from.
    public var located: Bool
    /// The XMP packet the file carries: the signature, and the rest where there is some.
    public var xmp: String

    public init(block: [UInt8]?, account: ExifAccount, rights: DeliveryRights, tags: AuthorTags,
                keep: MetaChoice, place: DeliveryPlace?, located: Bool, xmp: String) {
        self.block = block; self.account = account; self.rights = rights; self.tags = tags
        self.keep = keep; self.place = place; self.located = located; self.xmp = xmp
    }
}

/// The author's half of what a delivered picture says (`DeliveryMeta.swift`).
public struct AuthorMeta {
    /// Who signs; nil or no name writes no rights.
    public var identity: DeliveryIdentity?
    /// The year for a picture whose capture time is unknown — the export's own
    /// when nil, read from `exportExifBlock`'s `now`.
    public var fallbackYear: Int?
    /// The picture's own title and caption (`RollPicture`), or none.
    public var title: String?
    public var caption: String?
    /// Which groups leave; everything when nil.
    public var keep: MetaChoice?
    /// Names a position (`placeFor` over the loaded index), or nil when the run
    /// did not load one. Asked of the capture's OWN position, whether or not
    /// that position leaves.
    public var placeOf: ((GpsCoord) -> DeliveryPlace?)?

    public init(identity: DeliveryIdentity? = nil, fallbackYear: Int? = nil, title: String? = nil,
                caption: String? = nil, keep: MetaChoice? = nil, placeOf: ((GpsCoord) -> DeliveryPlace?)? = nil) {
        self.identity = identity; self.fallbackYear = fallbackYear; self.title = title
        self.caption = caption; self.keep = keep; self.placeOf = placeOf
    }
}

/// JS `new Date(now).getFullYear()`: the calendar year in the device's own zone.
private func localYear(_ now: Double) -> Int {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone.current
    return calendar.component(.year, from: Date(timeIntervalSince1970: now / 1000))
}

/// `text?.trim() || null`.
private func nonBlank(_ text: String?) -> String? {
    guard let t = text?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return t
}

/// What the author's half writes over the capture's. A group left out CLEARS
/// the capture's own value too, while a group kept with nothing to say leaves
/// it alone.
private func authorTagsFor(_ keep: MetaChoice, _ rights: DeliveryRights, _ caption: String?) -> AuthorTags {
    var tags = AuthorTags()
    if !keep.rights {
        tags.artist = .clear
        tags.copyright = .clear
    } else if let creator = rights.creator, !creator.isEmpty {
        tags.artist = .write(creator)
        tags.copyright = rights.copyright.map { .write($0) } ?? .clear
    }
    if !keep.words {
        tags.description = .clear
    } else if let caption {
        tags.description = .write(caption)
    }
    return tags
}

/// A block rebuilt from fields, signed and sized, the author's tags over them.
private func buildSigned(_ exif: ExifData, _ delivered: DeliveredSize, _ tags: AuthorTags) -> [UInt8] {
    buildExifBlock(exif, BuildExifOptions(
        software: atelierSoftware,
        artist: tags.artist,
        copyright: tags.copyright,
        description: tags.description,
        pixelWidth: delivered.width,
        pixelHeight: delivered.height
    ))
}

/// The EXIF block a delivered picture should carry.
///
/// `head` is the first bytes of the ORIGINAL — enough to hold its EXIF, which
/// sits at the front of a JPEG and of a TIFF-based RAW alike — or nil when it
/// could not be had. `vouched` is what the source said about the capture.
/// `now` (ms since the epoch) dates a picture nobody knows the capture time
/// of, when `author.fallbackYear` does not.
public func exportExifBlock(
    _ head: [UInt8]?,
    _ vouched: ExifData?,
    _ delivered: DeliveredSize,
    _ author: AuthorMeta = AuthorMeta(),
    now: Double
) -> ExportExif {
    let keep = author.keep ?? allMeta
    let fallbackYear = author.fallbackYear ?? localYear(now)
    let caption = keep.words ? nonBlank(author.caption) : nil
    let title = keep.words ? nonBlank(author.title) : nil

    func rightsOf(_ exif: ExifData?) -> DeliveryRights {
        keep.rights
            ? resolveRights(author.identity, captureYear(exif?.dateTimeOriginal, fallbackYear))
            : DeliveryRights(creator: nil, copyright: nil)
    }

    func signed(_ block: [UInt8], _ account: ExifAccount, _ rights: DeliveryRights, _ capture: ExifData?) -> ExportExif {
        let tags = authorTagsFor(keep, rights, caption)
        // The place is read from the capture as it WAS — before the choice
        // drops its position — so a town can leave without its coordinates.
        var located = false
        var place: DeliveryPlace?
        if let gps = capture?.gps {
            located = true
            if keep.place, let placeOf = author.placeOf { place = placeOf(gps) }
        }
        let text = DeliveryText(creator: rights.creator, copyright: rights.copyright, title: title, caption: caption, place: place)
        return ExportExif(block: block, account: account, rights: rights, tags: tags, keep: keep,
                          place: place, located: located, xmp: deliveryXmp(text))
    }

    if let head, !head.isEmpty {
        if let copied = readExifBlock(head) {
            let own = parseExif(copied)
            let rights = rightsOf(own)
            let tags = authorTagsFor(keep, rights, caption)
            if keepsWholeBlock(keep) {
                // Every account names the software: it is the one mark that
                // tells this export from the camera's own file once the rest
                // is a copy. The author's tags go over the camera's own.
                let block = retagExifBlock(copied, RetagOptions(
                    pixelWidth: delivered.width,
                    pixelHeight: delivered.height,
                    software: atelierSoftware,
                    artist: tags.artist,
                    copyright: tags.copyright,
                    description: tags.description
                ))
                return signed(block, .block, rights, mergeExif(own, vouched))
            }
            // A group left out: the block is REBUILT from its fields, and what
            // the fields do not name — the maker notes, the serials — stays behind.
            let merged = mergeExif(own, vouched) ?? own
            return signed(buildSigned(filterExif(merged, keep), delivered, tags), .fields, rights, merged)
        }
        let fields = parseExif(head)
        if let merged = mergeExif(isEmptyExif(fields) ? nil : fields, vouched), !isEmptyExif(merged) {
            let rights = rightsOf(merged)
            let tags = authorTagsFor(keep, rights, caption)
            return signed(buildSigned(filterExif(merged, keep), delivered, tags), .fields, rights, merged)
        }
    }
    if let vouched, !isEmptyExif(vouched) {
        let rights = rightsOf(vouched)
        let tags = authorTagsFor(keep, rights, caption)
        return signed(buildSigned(filterExif(vouched, keep), delivered, tags), .vouched, rights, vouched)
    }
    let rights = rightsOf(nil)
    let tags = authorTagsFor(keep, rights, caption)
    return signed(buildSigned(ExifData(), delivered, tags), .none, rights, nil)
}

/// The same JPEG carrying the block, the XMP packet and an sRGB ICC profile.
/// A block the format cannot hold — a copied one can be larger than a segment
/// — is REBUILT from what can be read of it rather than dropped, so the
/// position and the body still travel. A packet too large for its segment is
/// left out rather than failing the picture; the EXIF still signs it. Throws
/// only where the web's promise rejects: bytes that are not a JPEG.
public func stampExif(_ jpeg: [UInt8], _ exif: ExportExif, _ delivered: DeliveredSize) throws -> [UInt8] {
    var bytes = jpeg
    if let block = exif.block {
        do {
            bytes = try withExifBlock(bytes, block)
        } catch {
            let fields = parseExif(block)
            bytes = try withExifBlock(bytes, buildSigned(filterExif(fields, exif.keep), delivered, exif.tags))
        }
    }
    if !exif.xmp.isEmpty, let withXmp = try? withXmpPacket(bytes, exif.xmp) {
        bytes = withXmp
    }
    // The colour space the pixels are IN, said rather than left to a reader's
    // guess (`IccSRGB.swift`): the encoder writes sRGB, so the tag moves no pixel.
    return try withIccProfile(bytes)
}

public func stampExif(_ jpeg: Data, _ exif: ExportExif, _ delivered: DeliveredSize) throws -> Data {
    Data(try stampExif([UInt8](jpeg), exif, delivered))
}

/// Where a picture's metadata came from, for the sentence a panel says.
public func exifAccountText(_ account: ExifAccount) -> String {
    switch account {
    case .block: return "the original’s own EXIF, copied whole"
    case .fields: return "the original’s EXIF, rebuilt"
    case .vouched: return "what the source knows of the capture"
    case .none: return "no camera EXIF — nothing is known about this picture, only the signature is written"
    }
}
