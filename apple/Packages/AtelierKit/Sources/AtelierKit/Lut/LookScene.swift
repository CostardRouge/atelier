// The arithmetic and the words behind the look gallery's SCENE — the aimed
// look drawn on the host's own picture, above the grid. Port of
// `src/shared/lut/look-scene.ts`.
//
// Why the scene exists, and why it is CHEAPER than what it stands beside
// (`media-pipeline.md`, «The picker has a SCENE»): the grid draws every look
// on a shipped reference frame — right for comparing looks, silent about your
// picture — and "tiles on my picture" re-bakes EVERY visible tile, one
// lattice each. The scene resolves exactly ONE, the look being looked at. Scan
// on the reference, judge on your photograph.
//
// Pure: sizes in, a size out; a family in, a sentence or nil out. The
// picture, the grader and the wipe are the app's (`Look/LookSceneView.swift`).
// Left to the app: `asPreviewPicture`, which reads a DOM element's shape
// (`naturalWidth` on an `<img>`, a canvas's own pixels) — a native picture is
// a `CIImage` whose extent IS its measured size.

import Foundation

/// The most the scene ever draws: a 720p frame. A band a few hundred points
/// wide, so already generous at a retina density — and the whole reason the
/// scene is affordable: a buffer of 0.92 megapixels is ~7 MB, against the
/// 194 MB a 48-megapixel still costs at its own size.
public let scenePixels = 1280.0 * 720.0

/// The frame size for a source of `w`×`h`: its own size while it fits the
/// budget, scaled down by AREA with the aspect kept once it does not. The
/// aspect must be the SOURCE's — the render IS the picture, and a frame of the
/// band's shape would stretch a portrait photograph into it.
public func sceneFrame(_ w: Double, _ h: Double) -> Size {
    stageFrameSize(w, h, budget: scenePixels)
}

/// What the scene says about the look it is showing, beyond its name — or nil
/// when there is nothing to say.
///
/// One case, and it is the one thing only a preview on YOUR picture can tell:
/// a conversion look expects a LOG source, and read on a display-referred
/// photograph it comes out over-contrasted (`docs/lut-packs.md` §7's trap).
/// It says nothing the other way round: a creative look on log footage is a
/// choice, not a mistake, and a caution for it would be a fabrication.
public func sceneNote(_ family: PackFamily?, sourceIsLog: Bool) -> String? {
    guard family == .log, !sourceIsLog else { return nil }
    return "This conversion expects a log source. Yours is display-referred, which is why it comes out over-contrasted."
}
