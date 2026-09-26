// The Crop tab's state and verbs — the web's `use-crop-zone.ts` over the
// editor's ONE updater, plus the tab's other records (the border, the
// keystone, the lens and its measured profile) and "crop to this view".
//
// Rules kept (`develop-roll.md`, «The crop is a ZONE drawn over the whole
// picture», «Rotation under the zone», «Crop to the view»):
//
// - The zone is DERIVED from what the roll stores — `aspect` + a cover
//   `Framing`, through `zoneFromCrop` — never kept beside it, so an undo or a
//   batch verb moves it with no wiring. Every write goes back through
//   `cropFromZone` and `update`, so a drag, a chip and a turn are each ONE
//   undo step (the history's 700 ms coalescing under the picture's label).
// - Rotation works from an INTENT: the last zone the author DREW, shrunk just
//   enough at the new angle and never grown past it (`fitIntent`), so a
//   straighten to 3° and back to 0° gives the drawn zone back. The session
//   remembers what it last WROTE; when the stored crop differs (an undo, a
//   batch verb), the intent is re-read from the zone on screen.
// - An untouched picture opens on Free (`openingCropChip`) and Reset lands
//   there: a default chip that dirties nothing.
// - The crop stage's VIEW is inspection only (`CropView`, 1..8×): a pinch, the
//   wheel, the pill or `Z` move it and the crop is exactly what it was.
// - A lens profile is CALIBRATION, not an edit: applied by itself on the
//   SENSOR when the picture never decided, only offered on a camera render,
//   taken off as a `null` the web tells from "never decided" (absent).

import SwiftUI
import AtelierKit

extension RollEditor {
    // MARK: - reading

    /// The decoded picture the zone is measured on; nil while decoding.
    var cropSrc: PictureDims? {
        guard let size = decodedSize, size.width > 0, size.height > 0 else { return nil }
        return PictureDims(Double(size.width), Double(size.height))
    }

    /// The stored framing, the untouched one for nil.
    var cropFraming: Framing { picture?.framing ?? .default }
    var cropAspect: String { picture?.aspect ?? "original" }

    /// The zone the stored crop shows, in the turned picture's frame.
    var cropZone: CropZone? {
        guard let s = cropSrc else { return nil }
        return zoneFromCrop(s, pictureAspectRatio(cropAspect, s.width, s.height), cropFraming)
    }

    /// Whether the session speaks for the picture actually open.
    private var cropSessionCurrent: Bool { cropSession.pictureId == openId && openId != nil }

    /// The chip the open picture opens on — Free when untouched.
    private var openingChip: CropChip {
        openingCropChip(cropAspect, untouched: cropAspect == "original" && isDefaultFraming(picture?.framing))
    }

    /// The lit chip.
    var cropChip: CropChip { cropSessionCurrent ? cropSession.chip : openingChip }

    /// The picture's DISPLAYED shape — a quarter turn swaps it.
    private var cropShown: Double {
        guard let s = cropSrc else { return 1 }
        let odd = Int(abs(splitRotation(cropFraming.rotation).quarter).rounded()) % 180 == 90
        return odd ? s.height / s.width : s.width / s.height
    }

    /// The ratio a chip holds the zone to, nil in Free.
    private func chipRatio(_ chip: CropChip) -> Double? {
        if chip == "free" { return nil }
        if chip == "original" { return cropShown }
        return aspectPreset(chip).map { $0.w / $0.h }
    }

    /// The ratio the lit format holds the zone to, or nil in Free.
    var cropLock: Double? { chipRatio(cropChip) }

    var cropLevelling: Bool { cropSessionCurrent && cropSession.levelling }
    var cropRotating: Bool { cropSessionCurrent && cropSession.rotating }

    /// The crop stage's view, held inside the stage it last measured.
    var cropView: CropView {
        guard cropSessionCurrent else { return .fit }
        return clampCropView(cropSession.view, cropSession.box, cropSrc, cropFraming.rotation)
    }

    /// Anything departing from the whole picture as shot.
    var cropTouched: Bool { !isDefaultFraming(picture?.framing) || cropAspect != "original" }

    /// The stage's render as the WHOLE picture the crop stage turns under its
    /// zone — nil while the render on screen is still the CROPPED picture the
    /// crop tool is replacing (one render after the tab opens).
    var cropWholeStage: CGImage? {
        guard activeTool == .crop, let image = stage else { return nil }
        if let framed = cropSession.framedStage, framed == ObjectIdentifier(image) { return nil }
        return image
    }

    /// The border's two margins move together.
    var borderMarginsLinked: Bool {
        if cropSessionCurrent { return cropSession.linkedMargins }
        return picture?.border.map { $0.margin.x == $0.margin.y } ?? true
    }

    func setBorderMarginsLinked(_ on: Bool) {
        ensureCropSession()
        cropSession.linkedMargins = on
    }

    /// Turn the border on (the last one this picture wore in this visit, else
    /// white margins) or off.
    func setBorderOn(_ on: Bool) {
        ensureCropSession()
        borderBinding.wrappedValue = on ? (cropSession.lastBorder ?? .default) : nil
    }

    // MARK: - the session, keyed per picture

    /// Re-seed the session when another picture is open — the web's hook is
    /// keyed per picture, so a chip, an intent or a view never follows.
    func ensureCropSession() {
        guard !cropSessionCurrent else { return }
        cropSession.reseed(for: openId, chip: openingChip, border: picture?.border)
    }

    // MARK: - writing the zone

    /// A zone written as the roll stores it: the aspect it names and the cover
    /// framing that shows it, at the picture's angle and flips unless `turned`.
    private func writeZone(_ z: CropZone, chip chipNow: CropChip? = nil,
                           turned: (rotation: Double, flipX: Bool, flipY: Bool)? = nil) {
        guard let s = cropSrc, let id = openId else { return }
        let chipValue = chipNow ?? cropChip
        let ratio = z.w / z.h
        let own = s.width / s.height
        let aspectId = chipValue == "original" && abs(ratio / own - 1) < 1e-3 ? "original" : aspectIdFor(ratio)
        let f = cropFraming
        let g = turned ?? (rotation: f.rotation, flipX: f.flipX, flipY: f.flipY)
        let next = cropFromZone(s, z, g.rotation, g.flipX, g.flipY)
        cropSession.writtenAspect = aspectId
        cropSession.writtenFraming = next
        let stored: Framing? = isDefaultFraming(next) ? nil : next
        update { patchPicture($0, id) { p in
            p.aspect = aspectId
            p.framing = stored
        } }
    }

    /// The intent, or — when the crop moved under this session — the zone on screen.
    private func currentIntent() -> CropZone? {
        let a = cropAspect
        let f = cropFraming
        let ownWrite = cropSession.writtenAspect == a && cropSession.writtenFraming.map { sameFraming($0, f) } == true
        if cropSession.intent == nil || !ownWrite {
            cropSession.intent = cropZone
        }
        return cropSession.intent
    }

    /// A zone the author drew — written through, and remembered as the intent.
    func cropSetZone(_ z: CropZone) {
        ensureCropSession()
        cropSession.intent = z
        writeZone(z)
    }

    /// A zone from OUTSIDE the crop stage (crop to this view): the chip goes
    /// to Free, since the shape is the screen's and no format was chosen.
    func cropTo(_ z: CropZone) {
        ensureCropSession()
        cropSession.chip = "free"
        cropSession.intent = z
        writeZone(z, chip: "free")
    }

    /// A format chip: the centre kept, the largest zone of that ratio that fits there.
    func cropSetChip(_ next: CropChip) {
        ensureCropSession()
        cropSession.chip = next
        guard let s = cropSrc, let z = cropZone, let ratio = chipRatio(next) else { return }
        // Free changes nothing but what may now be changed.
        let fitted = fitAround(z.cx, z.cy, ratio, 1, cropFraming.rotation, s)
        cropSession.intent = fitted
        writeZone(fitted, chip: next)
    }

    /// The chip a turned shape keeps: a preset whose turned twin is one too.
    private func twinChip(_ ratio: Double) -> CropChip? {
        aspectPresets.first { abs($0.w / $0.h / ratio - 1) < 1e-3 }?.id
    }

    /// Portrait ↔ landscape about the centre (`X`).
    func cropSwap() {
        ensureCropSession()
        guard let s = cropSrc, let z = cropZone else { return }
        let c = cropChip
        // A preset keeps its chip when its turned twin is one too (3:2 ↔ 2:3);
        // otherwise the swapped shape becomes a Free one.
        let nextChip: CropChip = (c == "free" || c == "original") ? "free" : (twinChip(z.h / z.w) ?? "free")
        cropSession.chip = nextChip
        let fitted = fitAround(z.cx, z.cy, z.h, z.w, cropFraming.rotation, s, cap: 1)
        cropSession.intent = fitted
        writeZone(fitted, chip: nextChip)
    }

    /// The largest zone of the current format, centred — the double-click.
    func cropMaximize() {
        ensureCropSession()
        guard let s = cropSrc, let z = cropZone else { return }
        let fitted = maxZone(chipRatio(cropChip) ?? z.w / z.h, cropFraming.rotation, s)
        cropSession.intent = fitted
        writeZone(fitted)
    }

    /// Back to the whole picture as shot — on Free, which dirties nothing.
    func cropReset() {
        ensureCropSession()
        guard let id = openId else { return }
        cropSession.chip = "free"
        cropSession.intent = cropSrc.map { CropZone(cx: 0, cy: 0, w: $0.width, h: $0.height) }
        cropSession.writtenAspect = "original"
        cropSession.writtenFraming = .default
        update { patchPicture($0, id) { p in
            p.aspect = "original"
            p.framing = nil
        } }
    }

    // MARK: - turning

    /// The picture at `deg`, the zone refitted from the intent.
    private func cropTurnTo(_ deg: Double) {
        guard let s = cropSrc, let aim = currentIntent() else { return }
        let rotation = wrapDegrees(deg)
        let f = cropFraming
        writeZone(fitIntent(aim, rotation, s), turned: (rotation: rotation, flipX: f.flipX, flipY: f.flipY))
        cropSession.pulse()
    }

    /// The fine straighten, −45..45 within the current quarter: the picture
    /// turns UNDER the zone, which is refitted from the intent.
    func cropStraighten(_ fine: Double) {
        ensureCropSession()
        let quarter = splitRotation(cropFraming.rotation).quarter
        cropTurnTo(quarter + min(45, max(-45, fine)))
    }

    /// A quarter turn, the zone turning with the picture — exact, no refit.
    func cropQuarterTurn(_ dir: Int) {
        ensureCropSession()
        guard let z = cropZone, let aim = currentIntent() else { return }
        let turnedZone = quarterTurnZone(z, dir)
        cropSession.intent = quarterTurnZone(aim, dir)
        let c = cropChip
        let nextChip: CropChip = (c == "free" || c == "original") ? c : (twinChip(turnedZone.w / turnedZone.h) ?? "free")
        cropSession.chip = nextChip
        let f = cropFraming
        let quarter = wrapDegrees(f.rotation + 90 * Double(dir))
        writeZone(turnedZone, chip: nextChip, turned: (rotation: quarter, flipX: f.flipX, flipY: f.flipY))
    }

    /// Mirror what the frame shows; the zone is mirrored with it — the angle
    /// negated, the centre across that axis (`flipFraming`'s rule).
    func cropFlip(_ axis: Character) {
        ensureCropSession()
        guard let z = cropZone, let aim = currentIntent() else { return }
        cropSession.intent = flipZone(aim, axis)
        let f = cropFraming
        let flipX = axis == "x" ? !f.flipX : f.flipX
        let flipY = axis == "y" ? !f.flipY : f.flipY
        writeZone(flipZone(z, axis), turned: (rotation: wrapDegrees(-f.rotation), flipX: flipX, flipY: flipY))
    }

    /// A Level line drawn on the stage, in the zone's frame: the fine angle corrected by it.
    func cropLevel(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
        ensureCropSession()
        let delta = levelDelta(x1, y1, x2, y2)
        cropSession.levelling = false
        if delta == 0 { return }
        let split = splitRotation(cropFraming.rotation)
        cropTurnTo(split.quarter + min(45, max(-45, split.fine + delta)))
    }

    func cropSetLevelling(_ on: Bool) {
        ensureCropSession()
        cropSession.levelling = on
    }

    // MARK: - the crop stage's view (inspection only)

    /// The stage measured itself: the view is held inside it.
    func cropLayout(box: AtelierKit.Size) {
        ensureCropSession()
        cropSession.box = box
        let held = clampCropView(cropSession.view, box, cropSrc, cropFraming.rotation)
        if held != cropSession.view { cropSession.view = held }
    }

    /// Every write of the view, clamped where it is written.
    func cropSetView(_ change: (CropView) -> CropView) {
        ensureCropSession()
        let rotation = cropFraming.rotation
        let held = clampCropView(cropSession.view, cropSession.box, cropSrc, rotation)
        cropSession.view = clampCropView(change(held), cropSession.box, cropSrc, rotation)
    }

    /// Zoom the view about a stage point, kept still.
    func cropZoomView(to zoom: Double, anchor: CGPoint) {
        guard let s = cropSrc, let box = cropSession.box else { return }
        let rotation = cropFraming.rotation
        cropSetView { zoomCropViewAbout($0, zoom, AtelierKit.Point(Double(anchor.x), Double(anchor.y)), box, s, rotation) }
    }

    func cropPanView(dx: Double, dy: Double) {
        cropSetView { CropView(zoom: $0.zoom, x: $0.x + dx, y: $0.y + dy) }
    }

    // MARK: - the border

    /// The picture's border (`RollPicture.border`), nil for none.
    var borderBinding: Binding<RollBorder?> {
        Binding(
            get: { self.picture?.border },
            set: { value in
                guard let id = self.openId else { return }
                self.ensureCropSession()
                if let value { self.cropSession.lastBorder = value }
                self.update { patchPicture($0, id) { $0.border = value } }
            }
        )
    }

    /// What the file will be once the crop sits on its border, at the roll's
    /// first target — the web's `deliveredLayout` + `capFor`, in the decoded
    /// picture's own pixels.
    var borderDeliveredSize: (width: Int, height: Int)? {
        guard let z = cropZone else { return nil }
        let full = borderLayout(z.w, z.h, picture?.border)
        let long = max(full.w, full.h)
        guard long > 0 else { return nil }
        let cap = longEdgeFor(roll?.export.primary.size, width: full.w, height: full.h)
        let k = cap.map { min(1, Double($0) / long) } ?? 1
        let w = max(1, Int((full.w * k).rounded()))
        let h = max(1, Int((full.h * k).rounded()))
        return (w, h)
    }

    // MARK: - the keystone and the lens

    /// The perspective — nil on the picture the moment it does nothing.
    var keystoneBinding: Binding<Keystone?> {
        Binding(
            get: { keystoneOrNull(self.picture?.carried["keystone"]) },
            set: { value in
                let json: JSONValue? = value.flatMap { isDefaultKeystone($0) ? nil : keystoneJSON($0) }
                self.carriedBinding("keystone").wrappedValue = json
            }
        )
    }

    /// The lens sliders — nil on the picture the moment they do nothing (a
    /// midpoint alone only says WHERE a lift would bite).
    var lensBinding: Binding<LensCorrection?> {
        Binding(
            get: { lensOrNull(self.picture?.carried["lens"]) },
            set: { value in
                let json: JSONValue? = value.flatMap { isDefaultLens($0) ? nil : lensJSON($0) }
                self.carriedBinding("lens").wrappedValue = json
            }
        )
    }

    // MARK: - the lens's measured profile (Lensfun)

    /// What the open picture says about its glass.
    var openShot: ShotLens? {
        guard let id = openId else { return nil }
        return ShotLens(exif: pool.exif[id])
    }

    /// Developed from the SENSOR's data — the system's RAW developer here.
    var developsOnSensor: Bool {
        guard let id = openId else { return false }
        return pool.held(id)?.decoded.isRaw ?? false
    }

    /// The stored profile: `.none` never decided, `.some(nil)` taken off.
    var storedLensProfile: LensProfileApplied?? {
        readLensProfile(picture?.carried["lensProfile"])
    }

    /// The profile on the picture, or nil to take it off (a `null` the web
    /// tells from "never decided").
    func setLensProfile(_ profile: LensProfileApplied?) {
        carriedBinding("lensProfile").wrappedValue = profile?.json ?? .null
    }

    /// What re-asks the lookup: the glass, the consent, the material, the picture.
    var lensLookupKey: String {
        // The material is known once the picture is decoded.
        let decoded = decodedSize == nil ? "decoding" : "decoded"
        guard let shot = openShot else { return "none|\(openId ?? "")|\(decoded)" }
        return "\(shot.key)|\(LensfunStore.shared.allowed)|\(developsOnSensor)|\(openId ?? "")|\(decoded)"
    }

    /// Look the open picture's lens up — from what this device keeps, else
    /// from Lensfun when allowed — and, on the sensor, apply what is found to
    /// a picture that never decided.
    func lookUpOpenLens() async {
        guard let shot = openShot, let id = openId else { return }
        let result = await LensfunStore.shared.lookUp(shot)
        guard openId == id, case .found(let camera, let lens) = result else { return }
        if developsOnSensor, case .none = storedLensProfile, let found = lensProfileFor(camera, lens, shot) {
            setLensProfile(found)
        }
    }

    /// What applying would put on the picture now.
    var lensProfileCandidate: LensProfileApplied? {
        guard let shot = openShot, case .found(let camera, let lens)? = LensfunStore.shared.answer(for: shot) else { return nil }
        return lensProfileFor(camera, lens, shot, onRender: !developsOnSensor)
    }

    // MARK: - crop to this view (the Adjust stage, zoomed)

    /// The zone the zoomed Adjust stage shows, or nil where it would change
    /// nothing: at the fit, over a legacy Whole framing, before a decode.
    func viewCrop(_ zoom: LookingZoom) -> (zone: CropZone, clamped: Bool)? {
        guard tab != .crop, zoom.zoomed, cropFraming.fit != .contain,
              let s = cropSrc, let shown = cropZone else { return nil }
        // The stage draws the crop itself, no border: its canvas IS the zone.
        let layout = borderLayout(shown.w, shown.h, nil)
        let rect = pictureRect(zoom.view, viewport: zoom.viewport, content: zoom.content)
        let window = visibleWindow(rect, viewport: zoom.viewport)
        return zoneFromView(shown, layout, window, cropFraming.rotation, s)
    }

    /// Make what the zoomed stage shows the crop; the view back at the fit AT
    /// ONCE, where the new picture is exactly what was on screen. False when
    /// there was nothing to crop.
    @discardableResult
    func cropToView(_ zoom: LookingZoom?) -> Bool {
        guard let zoom, let found = viewCrop(zoom) else { return false }
        cropTo(found.zone)
        zoom.reset()
        tell(found.clamped ? "cropped to the view · as close as a crop may go" : "cropped to the view · C to adjust")
        return true
    }

    /// The pill's row: nil where it would change nothing.
    func cropToViewAction(_ zoom: LookingZoom) -> (() -> Void)? {
        guard viewCrop(zoom) != nil else { return nil }
        return { [weak self] in _ = self?.cropToView(zoom) }
    }

    // MARK: - the tab's tool

    /// The Crop tab holds the stage's pointer: its tool is up while the tab
    /// is open, and put down when another tab is — never a tool another tab
    /// raised.
    func syncCropTool() {
        if tab == .crop {
            ensureCropSession()
            if activeTool != .crop {
                // An uncropped picture's render is already the whole picture.
                cropSession.framedStage = cropTouched ? stage.map { ObjectIdentifier($0) } : nil
                setTool(.crop)
            }
        } else if activeTool == .crop {
            cropSession.framedStage = nil
            setTool(.none)
        }
    }
}

// MARK: - the two records as the web writes them

/// The keystone, key for key as `JSON.stringify` writes the web's object.
private func keystoneJSON(_ k: Keystone) -> JSONValue {
    .object([
        "vertical": .number(k.vertical), "horizontal": .number(k.horizontal), "rotation": .number(k.rotation),
        "aspect": .number(k.aspect), "scale": .number(k.scale),
    ])
}

/// The lens sliders, key for key.
private func lensJSON(_ l: LensCorrection) -> JSONValue {
    .object([
        "distortion": .number(l.distortion), "distortion2": .number(l.distortion2),
        "chromaRed": .number(l.chromaRed), "chromaBlue": .number(l.chromaBlue),
        "vignette": .number(l.vignette), "vignetteMidpoint": .number(l.vignetteMidpoint),
    ])
}

/// The hooks the stage keeps for the Crop tab — ONE modifier on the always
/// mounted stage (`DevelopStageView`): the tab raises and lowers its tool,
/// and the open picture's lens is looked up whatever tab is open (a RAW that
/// never decided gets its profile the moment it is opened, as on the web).
struct CropTabHooks: ViewModifier {
    let editor: RollEditor

    func body(content: Content) -> some View {
        content
            .onChange(of: editor.tab, initial: true) { _, _ in editor.syncCropTool() }
            .onChange(of: editor.openId) { _, _ in
                editor.ensureCropSession()
                editor.syncCropTool()
            }
            .task(id: editor.lensLookupKey) { await editor.lookUpOpenLens() }
    }
}
