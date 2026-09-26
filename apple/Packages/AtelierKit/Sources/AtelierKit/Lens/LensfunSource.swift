// WHERE a lens profile comes from — port of `src/shared/lens/lensfun-source.ts`,
// the one third-party address the Lensfun feature reaches, kept in one file so
// it can be audited in one place (`local-first.md`'s convention).
//
// The database is ~5 MB across 59 files, one per maker and kind of body. His
// rule (2026-09-23): never the whole database shipped, fetch on demand per
// lens, keep locally. So what ships is this TABLE OF CONTENTS — which files a
// camera's maker lives in, and which hold lenses for its kind of mount — and a
// lookup asks for the fewest files that can answer it: the maker's own first,
// then, only when the lens is not there, the independent lens makers' files
// for that kind of body. The fetch itself, and the store that keeps the
// matched camera and lens (never the files), are the app's.

import Foundation

/// The database's own files on GitHub — Lensfun, CC BY-SA 3.0. Follows `master`: new lenses arrive there.
public let lensfunBase = "https://raw.githubusercontent.com/lensfun/lensfun/master/data/db/"

public let lensfunLicence = "Lensfun database, CC BY-SA 3.0"

/// Which files hold a maker's bodies (and, for a compact, its fixed lens). Keyed by `makerKey`.
private let byMaker: [String: [String]] = [
    "sony": ["mil-sony.xml", "slr-sony.xml", "compact-sony.xml"],
    "canon": ["mil-canon.xml", "slr-canon.xml", "compact-canon.xml"],
    "nikon": ["mil-nikon.xml", "slr-nikon.xml", "compact-nikon.xml"],
    "fujifilm": ["mil-fujifilm.xml", "compact-fujifilm.xml"],
    "olympus": ["mil-olympus.xml", "slr-olympus.xml", "compact-olympus.xml"],
    "omdigitalsolutions": ["om-system.xml", "mil-olympus.xml"],
    "panasonic": ["mil-panasonic.xml", "slr-panasonic.xml", "compact-panasonic.xml"],
    "pentax": ["slr-pentax.xml", "mil-pentax.xml", "compact-pentax.xml"],
    "ricoh": ["slr-ricoh.xml", "compact-ricoh.xml", "slr-pentax.xml"],
    "leica": ["mil-leica.xml", "rf-leica.xml", "slr-leica.xml", "compact-leica.xml"],
    "samsung": ["mil-samsung.xml", "slr-samsung.xml", "compact-samsung.xml"],
    "sigma": ["mil-sigma.xml", "slr-sigma.xml", "compact-sigma.xml"],
    "hasselblad": ["mil-hasselblad.xml", "slr-hasselblad.xml"],
    "kodak": ["compact-kodak.xml"],
    "konicaminolta": ["slr-konica-minolta.xml", "compact-konica-minolta.xml"],
    "minolta": ["slr-konica-minolta.xml"],
    "casio": ["compact-casio.xml"],
    "dji": ["actioncams.xml"],
    "gopro": ["actioncams.xml"],
    "apple": ["misc.xml"],
]

/// Independent lens makers for a mirrorless body — where a lens not made by the camera's maker lives.
private let thirdPartyMil = [
    "mil-sigma.xml", "mil-tamron.xml", "mil-samyang.xml", "mil-zeiss.xml", "mil-tokina.xml", "misc.xml",
]

/// The same for an SLR (and a rangefinder).
private let thirdPartySlr = [
    "slr-sigma.xml", "slr-tamron.xml", "slr-tokina.xml", "slr-samyang.xml", "slr-zeiss.xml",
    "slr-schneider.xml", "slr-vivitar.xml", "slr-soligor.xml", "slr-ussr.xml", "misc.xml",
]

/// The files a maker's cameras may be in, in the order worth trying; empty for a maker Lensfun does not know.
public func cameraFiles(_ makerKey: String) -> [String] {
    byMaker[makerKey] ?? []
}

/// The further files a lens may be in once the body is found in `cameraFile`
/// and its own maker's file had no match: the independent makers for that
/// kind of body. A compact, an action camera or a phone has its lens in its
/// own file, so there is nowhere further to look.
public func lensFiles(_ cameraFile: String) -> [String] {
    if cameraFile.hasPrefix("mil-") || cameraFile == "om-system.xml" { return thirdPartyMil }
    if cameraFile.hasPrefix("slr-") || cameraFile.hasPrefix("rf-") { return thirdPartySlr }
    return []
}

public func lensfunUrl(_ file: String) -> String {
    lensfunBase + file
}
