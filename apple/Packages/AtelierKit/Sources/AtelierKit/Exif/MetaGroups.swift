// WHAT leaves in a delivered file's metadata — port of
// `src/shared/exif/meta-groups.ts`.
//
// In groups a person can reason about (`docs/lightroom-gaps.md` §9, M3) —
// never a list of forty tags. One choice per ROLL (`RollExport.metadata`): a
// roll is a delivery, and "this set goes online, no position" is said of the
// delivery, not of each frame. Three presets name the usual answers; any other
// combination reads Custom.
//
// The rules it keeps from the web module:
// - **The cost of leaving something out is said, not hidden.** A JPEG's own
//   EXIF block is COPIED whole whenever it can be (`stamp-exif.ts`), which is
//   what keeps the maker notes, the serial numbers and every tag no struct
//   here models. Dropping any CAPTURE group — the camera, the exposure, the
//   time, the position — or the maker notes themselves means REBUILDING the
//   block from its fields, and whatever the fields do not name stays behind.
//   So `keepsWholeBlock` is the one question the panel asks aloud.
// - A stored choice names only what is OFF: every group it does not name is
//   kept, so an older roll (no `metadata` at all) reads as All.
// - The signature (`Software: Atelier`) is not a group: it is always written.
// - `filterExif` drops the capture groups left out and nothing else — the
//   author's tags are the writer's to decide, and what describes the file
//   itself (its software, its size, its orientation) is never the choice's.

import Foundation

public enum MetaGroup: String, CaseIterable, Equatable, Sendable {
    case camera
    case exposure
    case time
    case position
    case place
    case makerNotes
    case words
    case rights
}

/// The web's `MetaChoice`: one flag per group, all of them always present.
public struct MetaChoice: Equatable, Sendable {
    public var camera: Bool
    public var exposure: Bool
    public var time: Bool
    public var position: Bool
    public var place: Bool
    public var makerNotes: Bool
    public var words: Bool
    public var rights: Bool

    public init(
        camera: Bool = true, exposure: Bool = true, time: Bool = true, position: Bool = true,
        place: Bool = true, makerNotes: Bool = true, words: Bool = true, rights: Bool = true
    ) {
        self.camera = camera; self.exposure = exposure; self.time = time; self.position = position
        self.place = place; self.makerNotes = makerNotes; self.words = words; self.rights = rights
    }

    public subscript(group: MetaGroup) -> Bool {
        get {
            switch group {
            case .camera: return camera
            case .exposure: return exposure
            case .time: return time
            case .position: return position
            case .place: return place
            case .makerNotes: return makerNotes
            case .words: return words
            case .rights: return rights
            }
        }
        set {
            switch group {
            case .camera: camera = newValue
            case .exposure: exposure = newValue
            case .time: time = newValue
            case .position: position = newValue
            case .place: place = newValue
            case .makerNotes: makerNotes = newValue
            case .words: words = newValue
            case .rights: rights = newValue
            }
        }
    }

    /// The choice as `RollExport.metadata` stores it — every group named, as the web writes it.
    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        for group in MetaGroup.allCases { o[group.rawValue] = .bool(self[group]) }
        return .object(o)
    }
}

/// One group as a panel lists it, with what it holds.
public struct MetaGroupInfo: Equatable, Sendable {
    public var id: MetaGroup
    public var label: String
    public var hint: String
    public init(id: MetaGroup, label: String, hint: String) { self.id = id; self.label = label; self.hint = hint }
}

/// The groups in the order a panel lists them, with what each one holds.
public let metaGroups: [MetaGroupInfo] = [
    MetaGroupInfo(id: .camera, label: "Camera and lens", hint: "make, model, lens"),
    MetaGroupInfo(id: .exposure, label: "Exposure", hint: "shutter, aperture, ISO, focal length, compensation, flash"),
    MetaGroupInfo(id: .time, label: "Capture time", hint: "the moment it was taken"),
    MetaGroupInfo(id: .position, label: "GPS position", hint: "latitude, longitude, altitude"),
    MetaGroupInfo(id: .place, label: "Place name", hint: "city and country, named offline from the GPS — written even when the position is left out"),
    MetaGroupInfo(id: .makerNotes, label: "Maker notes and serials", hint: "everything else the camera wrote — kept only by copying its block whole"),
    MetaGroupInfo(id: .words, label: "Title and caption", hint: "this picture’s own words"),
    MetaGroupInfo(id: .rights, label: "Creator and copyright", hint: "your name and your line"),
]

/// Everything leaves — the default.
public let allMeta = MetaChoice()

public enum MetaPresetId: String, CaseIterable, Equatable, Sendable {
    case all
    case share
    case minimal
}

public struct MetaPreset: Equatable, Sendable {
    public var id: MetaPresetId
    public var label: String
    public var choice: MetaChoice
    public init(id: MetaPresetId, label: String, choice: MetaChoice) { self.id = id; self.label = label; self.choice = choice }
}

/// The three usual answers. *All* is the default — the maintainer finds a
/// photograph by its position, so the GPS leaves unless asked otherwise.
/// *Share online* keeps what a viewer enjoys and drops what locates or
/// identifies: the position and the serials — the town stays, a position to
/// the metre does not (`delivery-place.ts`). *Minimal* is the rights alone.
public let metaPresets: [MetaPreset] = [
    MetaPreset(id: .all, label: "All", choice: allMeta),
    MetaPreset(id: .share, label: "Share online", choice: MetaChoice(position: false, makerNotes: false)),
    MetaPreset(
        id: .minimal,
        label: "Minimal",
        choice: MetaChoice(camera: false, exposure: false, time: false, position: false, place: false, makerNotes: false, words: false, rights: true)
    ),
]

/// A stored choice: every group it does not name is kept, so an older roll reads as All.
public func readMetaChoice(_ raw: JSONValue?) -> MetaChoice {
    let r = raw?.objectValue ?? [:]
    var out = allMeta
    for group in metaGroups.map({ $0.id }) where r[group.rawValue] == .bool(false) {
        out[group] = false
    }
    return out
}

/// Which preset a choice IS, or nil for a combination of its own.
public func presetOf(_ choice: MetaChoice) -> MetaPresetId? {
    metaPresets.first { preset in metaGroups.allSatisfy { preset.choice[$0.id] == choice[$0.id] } }?.id
}

/// Whether the camera's own block can travel whole — every capture group and
/// the maker notes kept. The rights, the words and the place are written over
/// a copy (or into the XMP) either way, so they never force a rebuild.
public func keepsWholeBlock(_ choice: MetaChoice) -> Bool {
    choice.camera && choice.exposure && choice.time && choice.position && choice.makerNotes
}

/// Whether any of the capture's own facts leave — the run says so when none were known.
public func keepsCapture(_ choice: MetaChoice) -> Bool {
    choice.camera || choice.exposure || choice.time || choice.position
}

/// `exif` without the capture groups the choice leaves out. The author's
/// tags — artist, copyright, description — are the writer's to decide
/// (`stamp-exif.ts`), and what describes the file itself (its software, its
/// size, its orientation) is never the choice's.
public func filterExif(_ exif: ExifData, _ choice: MetaChoice) -> ExifData {
    var out = exif
    if !choice.camera {
        out.make = nil
        out.model = nil
        out.lensMake = nil
        out.lensModel = nil
    }
    if !choice.exposure {
        out.iso = nil
        out.exposureTime = nil
        out.fNumber = nil
        out.focalLength = nil
        out.focalLength35 = nil
        out.exposureBias = nil
        out.exposureProgram = nil
        out.meteringMode = nil
        out.whiteBalance = nil
        out.flash = nil
    }
    if !choice.time {
        out.dateTimeOriginal = nil
    }
    if !choice.position {
        out.gps = nil
        out.gpsAltitude = nil
        out.relativeAltitude = nil
    }
    return out
}
