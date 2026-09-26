// The geometry a picture carries, and the ONE place its order is decided —
// the web's `src/shared/render/picture-geometry.ts` — plus the geometry
// family's BUILDER: what a picture's stored records contribute to the graph,
// and WHERE, in the web's order (`use-develop-picture.ts`, `roll-render.ts`).
//
// Three passes move pixels, and which runs first is a real decision: the
// CAMERA's own `WarpRectilinear` first of all — the correction the FILE states
// for the body that shot it, about an optical centre that need not be the
// frame's — then the LENS, which un-bends the picture into something
// rectilinear, then the KEYSTONE, since only a rectilinear picture has straight
// verticals for a perspective correction to make parallel. Calibration, then
// judgement. The stage, a snapshot, a filmstrip cell and the export all build
// this list here, and two of them disagreeing is how a preview stops
// predicting a file.
//
// The web's `cloneGeometry` has no port: the records are Swift values, so a
// held copy can never alias a caller's draft.

import AtelierKit
import CoreImage
import Foundation

struct PictureGeometry: Equatable {
    /// The CAMERA's own warp, read out of a DNG (`calibrationAt`) — never stored
    /// on a document and never edited. Nil for every picture not developed that far.
    var cameraWarp: CameraWarp?
    /// Distortion, lateral CA and vignetting — the sliders.
    var lens: LensCorrection?
    /// A MEASURED profile (Lensfun) in the lens pass's units, applied in the
    /// same pass under the sliders — already `profileInEffect`.
    var lensProfile: LensProfileTerms?
    /// The perspective correction.
    var keystone: Keystone?

    init(cameraWarp: CameraWarp? = nil, lens: LensCorrection? = nil,
         lensProfile: LensProfileTerms? = nil, keystone: Keystone? = nil) {
        self.cameraWarp = cameraWarp
        self.lens = lens
        self.lensProfile = lensProfile
        self.keystone = keystone
    }

    /// A picture's geometry from its STORED records — the keystone, the lens
    /// and the lens profile the roll carries on the picture (`carried`, read by
    /// the kernel's own readers, which clamp and fall back as the web's do) —
    /// and from its FILE's calibration at the rung it stands on.
    ///
    /// `onSensor`: the picture is developed from the sensor's data. A measured
    /// profile applies there by itself, and on a camera render only where the
    /// author said so (`profileInEffect`, `lens-profiles.md`): a body often
    /// corrects its own JPEG, and correcting it again bends it the other way.
    init(picture: RollPicture, calibration: CalibrationAt = .nothing, onSensor: Bool) {
        let applied = readLensProfile(picture.carried["lensProfile"]).flatMap { $0 }
        self.init(cameraWarp: calibration.warp,
                  lens: lensOrNull(picture.carried["lens"]),
                  lensProfile: profileInEffect(applied, onSensor),
                  keystone: keystoneOrNull(picture.carried["keystone"]))
    }
}

/// Does this picture need the GPU for its SHAPE, whatever its look?
func hasGeometry(_ g: PictureGeometry?) -> Bool {
    guard let g else { return false }
    return !isIdentityWarp(g.cameraWarp) || !isDefaultLens(g.lens)
        || !isIdentityProfile(g.lensProfile) || !isDefaultKeystone(g.keystone)
}

/// Compare by VALUE, a neutral record and none alike — what keeps a grader
/// keyed on the geometry from rebuilding for an identical drag step.
func sameGeometry(_ a: PictureGeometry?, _ b: PictureGeometry?) -> Bool {
    sameWarp(a?.cameraWarp, b?.cameraWarp)
        && sameLens(a?.lens, b?.lens)
        && sameProfileTerms(a?.lensProfile, b?.lensProfile)
        && sameKeystone(a?.keystone, b?.keystone)
}

/// The passes, in order, for a picture of this shape: camera warp → lens →
/// keystone. Empty when nothing is corrected — a caller then runs the look
/// alone, or nothing at all.
///
/// `aspectRatio` is the SOURCE's: the corrections run at source density before
/// any crop — a keystone resampled after the crop would resample a resample,
/// and a lens corrected after one would be radial about the wrong centre.
func geometryPasses(_ g: PictureGeometry?, aspectRatio: Double) -> [RenderPass] {
    guard let g else { return [] }
    var passes: [RenderPass] = []
    // Only the ASPECT matters to the camera warp: its normalising radius is a
    // distance in the same pixels it then divides out, so (ar, 1) is the frame.
    if let camera = CameraWarpPass.make(g.cameraWarp, aspectRatio, 1) {
        passes.append(camera)
    }
    // A file that states its OWN rectilinear warp has had its distortion taken
    // out by the time the lens pass runs: a measured profile on top would bend
    // it back the other way. The file's calibration wins; the sliders stay.
    let profile = isIdentityWarp(g.cameraWarp) ? g.lensProfile : nil
    if let lens = LensPass.make(g.lens, aspectRatio: aspectRatio, profile: profile) {
        passes.append(lens)
    }
    if let keystone = g.keystone, !isDefaultKeystone(keystone),
       let pass = KeystonePass.make(keystone, aspectRatio: aspectRatio) {
        passes.append(pass)
    }
    return passes
}

/// Everything the geometry family draws for ONE picture, and WHERE — the web's
/// order, which the Develop integration lays into `FrameGrader`'s two lists:
///
///     before: [source…] + repair + denoise/defringe
///     after:  [shape…] + adjustment layers + sharpen/presence
///             + [finish…] + [looking…] + a mask's wash
///
/// The gain map goes FIRST of all (ahead of the repair: a copied pixel is then
/// copied from corrected data); the warps FIRST after the cube, at source
/// density; the post-crop vignette after the sharpen, an effect on the finished
/// picture; the clipping view after everything that shapes the picture, so it
/// marks what the picture really holds.
struct GeometryFamilyPasses {
    /// `before` the cube, first of all: the camera's own shading.
    var source: [RenderPass] = []
    /// `after` the cube, first: camera warp → lens → keystone.
    var shape: [RenderPass] = []
    /// `after`, past the sharpen and presence: the post-crop vignette.
    var finish: [RenderPass] = []
    /// `after`, past `finish` and under a mask's wash — the STAGE only; a
    /// snapshot, the histogram and an export never ask for it.
    var looking: [RenderPass] = []

    init(source: [RenderPass] = [], shape: [RenderPass] = [], finish: [RenderPass] = [], looking: [RenderPass] = []) {
        self.source = source
        self.shape = shape
        self.finish = finish
        self.looking = looking
    }

    /// A picture's passes from its stored records (`carried`: `keystone`, `lens`,
    /// `lensProfile`, `vignette`; `aspect` and `framing` for the vignette's
    /// frame), its file's calibration at its rung, and the stage's clipping
    /// switch. `sourceWidth` × `sourceHeight` is the source's shape — only its
    /// aspect is read.
    init(picture: RollPicture, sourceWidth: Double, sourceHeight: Double,
         calibration: CalibrationAt = .nothing, onSensor: Bool = false, clipping: Bool = false) {
        let ar = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1
        let geometry = PictureGeometry(picture: picture, calibration: calibration, onSensor: onSensor)
        var source: [RenderPass] = []
        if let gain = GainMapPass.make(calibration.gain) { source.append(gain) }
        let frameRatio = pictureAspectRatio(picture.aspect, sourceWidth, sourceHeight)
        let recorded = postVignetteOrNull(picture.carried["vignette"])
        var finish: [RenderPass] = []
        if let vignette = PostVignettePass.make(recorded, sourceWidth: sourceWidth, sourceHeight: sourceHeight,
                                                frameRatio: frameRatio, framing: picture.framing) {
            finish.append(vignette)
        }
        var looking: [RenderPass] = []
        if clipping { looking.append(ClippingPass.shared) }
        self.init(source: source, shape: geometryPasses(geometry, aspectRatio: ar), finish: finish, looking: looking)
    }
}
