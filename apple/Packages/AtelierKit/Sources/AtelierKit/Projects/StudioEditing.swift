// The Studio editor's own arithmetic — the pure half of the web's
// `src/tools/studio/StudioEditor.tsx`, `StudioTool.tsx`,
// `ProjectSettingsModal.tsx` and `ProjectGallery.tsx`, which on the web lives
// inline in component bodies, and the rate clamp of
// `src/shared/media/use-video-transport.ts` (`clampPlaybackRate`) and the
// arrow keys of `src/shared/media/TrimBar.tsx`.
//
// Kept here, rather than in the SwiftUI shell, so the rules are spec'd on
// Linux like every other kernel module and the views only draw them:
// - an element added from the palette is staggered so two never land on one
//   spot — except an intro preset, which is composed where it means to be, and
//   which brings its scene into being;
// - the playhead's time in the element windows' clock is the media time minus
//   the in point (windows count from the first EXPORTED frame);
// - a drag on the stage moves the anchor by the pointer's travel over the
//   frame's pixels, clamped to the frame, snapped to the grid when the grid
//   snaps, else to the light edge-and-centre snap — never when bypassed;
// - `I` / `O` cut at the playhead, Shift gives a handle back to the clip's own
//   end; ← → step the playhead a frame, Shift a second, inside the range;
// - "forget the missing media" prunes the matched-by-name missing refs and
//   recounts the reconciliation locally, never re-listing the folder;
// - the settings modal's cadence draft (a factor and a direction, 1…600) and
//   its capture-time shift (a sign, hours, minutes) rebuilt into the
//   document's numbers;
// - every sentence the editor prints about its media, its save and a file
//   about to be imported, word for word.

import Foundation

// MARK: - what the Studio edits

/// Clips with or without telemetry, and stills — the web's `STUDIO_KINDS`. A
/// photo is a media a project holds beside its clips, never a second kind of
/// project.
public let studioKinds: [AssetKind] = [.videoTelemetry, .video, .photo]

/// The inspector's five tabs, in the web's order (`TABS`).
public enum StudioTab: String, CaseIterable, Sendable {
    case overlay, style, grade, info, export

    public var label: String {
        switch self {
        case .overlay: return "Overlay"
        case .style: return "Style"
        case .grade: return "Grade"
        case .info: return "Info"
        case .export: return "Export"
        }
    }
}

// MARK: - the transport

private let minPlaybackRate = 0.0625
private let maxPlaybackRate = 16.0

/// A preview rate the player can honour: anything absent, unreadable or not
/// positive plays at 1, the rest is held inside 1/16 … 16 — the web's
/// `clampPlaybackRate`.
public func clampPlaybackRate(_ rate: Double) -> Double {
    guard rate.isFinite, rate > 0 else { return 1 }
    return min(maxPlaybackRate, max(minPlaybackRate, rate))
}

/// The rate that undoes a clip's own conform: a 4× slow clip at 4×, a 10×
/// lapse at 1/10 — playing at `1 / scale`.
public func realtimePlaybackRate(_ scale: Double) -> Double {
    clampPlaybackRate(1 / scale)
}

/// The preview speed the transport offers: a viewing choice, never the
/// document's. `realtime` tracks the clip's own cadence, so it stays right
/// when the clip changes.
public enum PreviewSpeed: Hashable, Sendable {
    case rate(Double)
    case realtime
}

/// The rate the player runs at for a preview speed.
public func previewRate(_ speed: PreviewSpeed, realtimeRate: Double) -> Double {
    switch speed {
    case .rate(let r): return clampPlaybackRate(r)
    case .realtime: return realtimeRate
    }
}

/// A rate as the menu prints it — two decimals at most, `real (4×)`.
public func realtimeSpeedLabel(_ realtimeRate: Double) -> String {
    "real (\(studioNumber((realtimeRate * 100).rounded() / 100))×)"
}

/// The DELIVERED-speed menu: the standard steps, plus the one that undoes this
/// clip's own conform when that is not already among them, ascending.
public func deliveredSpeedChoices(_ realtimeRate: Double) -> [Double] {
    var set = Set(speedChoices)
    if realtimeRate != 1 { set.insert((realtimeRate * 100).rounded() / 100) }
    return set.sorted()
}

/// The playhead in the element windows' clock: seconds from the first
/// exported frame, never below 0.
public func windowPlayhead(_ time: Double, _ range: TrimRange) -> Double {
    max(0, time - range.start)
}

/// ← → on the playhead: one frame, Shift a second (at least one frame), kept
/// inside the range — the TrimBar's seek slider.
public func steppedPlayhead(_ time: Double, forward: Bool, shift: Bool, step: Double, range: TrimRange) -> Double {
    let delta = shift ? max(step, 1) : step
    let next = forward ? time + delta : time - delta
    return clampPlayhead(next, range)
}

/// What a play press does at the playhead: sitting on (or outside) the out
/// point, play means REPLAY the range from its in point.
public func playStartTime(_ time: Double, _ range: TrimRange?) -> Double? {
    guard let range else { return nil }
    if time >= range.end - trimEpsilon || time < range.start { return range.start }
    return nil
}

/// What playing past the out point comes to: loop back to the in point, or
/// stop exactly ON the handle, so the next press replays from the in point.
public enum OutPointAction: Equatable, Sendable {
    case keepPlaying
    case loop(to: Double)
    case stop(at: Double)
}

public func outPointAction(_ time: Double, _ range: TrimRange?, loop: Bool) -> OutPointAction {
    guard let range, time >= range.end - trimEpsilon else { return .keepPlaying }
    return loop ? .loop(to: range.start) : .stop(at: range.end)
}

/// `I` / `O` at the playhead, Shift releasing a handle to the clip's own end —
/// nil when the key is neither, or the clip has no length yet.
public func trimKeyRange(_ key: String, shift: Bool, current: TrimRange?, at: Double, duration: Double,
                         frameStep: Double) -> TrimRange? {
    guard duration > 0 else { return nil }
    let range = current ?? fullRange(duration)
    switch key.lowercased() {
    case "i": return setStart(range, shift ? 0 : at, duration, frameStep)
    case "o": return setEnd(range, shift ? duration : at, duration, frameStep)
    default: return nil
    }
}

/// The per-clip trims with `key`'s range written — or removed when the whole
/// clip is kept again. The same map comes back when nothing changed.
public func writeClipTrim(_ trims: [String: SavedTrim], _ key: String, _ range: TrimRange,
                          _ duration: Double) -> [String: SavedTrim] {
    guard let saved = saveTrim(range, duration) else {
        if trims[key] == nil { return trims }
        var rest = trims
        rest[key] = nil
        return rest
    }
    if trims[key] == saved { return trims }
    var next = trims
    next[key] = saved
    return next
}

/// The line under the trim bar — ALWAYS drawn, so the row never resizes under
/// a pointer: the cut when there is one, else "Full clip" and, until the
/// gesture has been learned, how to make one.
public struct TrimReadout: Equatable, Sendable {
    public var trimmed: Bool
    public var text: String
}

public func trimReadout(_ range: TrimRange, _ duration: Double, learned: Bool) -> TrimReadout {
    if isTrimmed(range, duration) {
        let length = String(format: "%.1f", trimDuration(range))
        return TrimReadout(trimmed: true,
                           text: "\(formatTimecode(range.start)) → \(formatTimecode(range.end)) · \(length)s")
    }
    return TrimReadout(trimmed: false,
                       text: learned ? "Full clip" : "Full clip — drag the handles, or press I / O to cut at the playhead")
}

// MARK: - the deck

/// An element from the palette placed on the deck: staggered down the frame
/// so it does not land on the last one (0.06 per element, at most 0.5, never
/// past 0.95) — except an intro preset, composed where it means to be.
public func studioPlacedElement(_ element: OverlayElement, deckCount: Int) -> OverlayElement {
    let offset = element.sceneId != nil ? 0 : min(0.5, Double(deckCount) * 0.06)
    var placed = element
    placed.y = min(0.95, element.y + offset)
    return placed
}

/// Add an element: placed, appended, and — for an intro element whose scene
/// does not exist yet — the scene created with it (three seconds), because the
/// palette is the only place an intro starts.
public func studioAddElement(_ element: OverlayElement, elements: [OverlayElement],
                             scenes: [OverlayScene]) -> (elements: [OverlayElement], scenes: [OverlayScene], added: OverlayElement) {
    var nextScenes = scenes
    if let sceneId = element.sceneId, findScene(scenes, sceneId) == nil {
        nextScenes.append(createIntroScene(end: 3))
    }
    let placed = studioPlacedElement(element, deckCount: elements.count)
    return (elements + [placed], nextScenes, placed)
}

/// Drop a scene and every element that lived in it.
public func studioRemoveScene(_ id: String, elements: [OverlayElement],
                              scenes: [OverlayScene]) -> (elements: [OverlayElement], scenes: [OverlayScene]) {
    (elements.filter { $0.sceneId != id }, scenes.filter { $0.id != id })
}

/// A dragged element's new anchor, from where it started and how far the
/// pointer travelled over a `width`×`height` frame: clamped to the frame, then
/// snapped — to the grid lines when the grid snaps, else to the light edge and
/// centre snap — unless `bypassSnap` (Alt on the web, Option on a Mac).
public func stageDragPosition(startX: Double, startY: Double, dxPx: Double, dyPx: Double, width: Double,
                              height: Double, grid: GridConfig, bypassSnap: Bool) -> Point {
    guard width > 0, height > 0 else { return Point(startX, startY) }
    let rawX = min(1, max(0, startX + dxPx / width))
    let rawY = min(1, max(0, startY + dyPx / height))
    if bypassSnap { return Point(rawX, rawY) }
    if grid.snap { return Point(snapToGrid(rawX, grid.cols), snapToGrid(rawY, grid.rows)) }
    return Point(snap(rawX), snap(rawY))
}

/// The A/B divider under a pointer, as a share of the frame's width.
public func wipeSplit(_ px: Double, width: Double) -> Double {
    guard width > 0 else { return 0.5 }
    return min(1, max(0, px / width))
}

/// A press that never travelled — a TAP, which on a phone raises the
/// inspector — within 4 px, the threshold every press-or-drag surface uses.
public func isStageTap(dx: Double, dy: Double) -> Bool {
    abs(dx) <= 4 && abs(dy) <= 4
}

// MARK: - the media

/// The media's facts beside its name: `1920×1080 · hvc1 · 30 fps` for a clip,
/// `4000×3000 · JPEG` for a still — what is ON THE STAGE, never the capture's.
public func studioMediaDetail(isPhoto: Bool, width: Int?, height: Int?, imageType: String? = nil,
                              codec: String? = nil, fps: Double? = nil) -> String {
    var parts: [String] = []
    if let width, let height, width > 0, height > 0 { parts.append("\(width)×\(height)") }
    if isPhoto {
        if let imageType, !imageType.isEmpty { parts.append(imageType) }
    } else {
        if let codec, !codec.isEmpty { parts.append(codec) }
        if let fps, fps > 0 { parts.append("\(studioNumber(fps)) fps") }
    }
    return parts.joined(separator: " · ")
}

/// Renames absorbed on open are SAID, never silent.
public func renamedMediaNotice(_ count: Int) -> String? {
    guard count > 0 else { return nil }
    let head = count == 1 ? "1 media file was renamed since last save"
        : "\(count) media files were renamed since last save"
    return "\(head) — recognised by content and adopted under the new name."
}

/// Missing and changed media: routine, not an error — missing alone is
/// informational, a change is worth attention (`needsAttention`).
public struct MediaTroubleNotice: Equatable, Sendable {
    public var text: String
    public var needsAttention: Bool
    public var offersForget: Bool
}

public func mediaTroubleNotice(missing: Int, changed: Int) -> MediaTroubleNotice? {
    guard missing > 0 || changed > 0 else { return nil }
    var text = ""
    if missing > 0 { text += "\(missing) media file\(missing > 1 ? "s" : "") not in this folder" }
    if missing > 0 && changed > 0 { text += " · " }
    if changed > 0 { text += "\(changed) changed since last save" }
    text += " — the project stays editable."
    if missing > 0 { text += " Moved, archived or deleted on purpose? Remove them below so this stops asking." }
    return MediaTroubleNotice(text: text, needsAttention: changed > 0, offersForget: missing > 0)
}

/// Drop the currently-missing media from the project's known list (matched by
/// name, case-insensitively) and recount the reconciliation LOCALLY — no
/// folder listed again, no permission asked. Nil when nothing is missing.
/// The trims are deliberately left alone: harmless to keep, and they let a
/// trim survive if the same file is ever added back.
public func forgetMissingMedia(_ media: ProjectMedia,
                               _ reconciliation: Reconciliation) -> (media: ProjectMedia, reconciliation: Reconciliation)? {
    let missingNames = Set(reconciliation.items.filter { $0.status == .missing }.map { $0.ref.name.lowercased() })
    guard !missingNames.isEmpty else { return nil }
    var next = media
    next.files = media.files.filter { !missingNames.contains($0.name.lowercased()) }
    let items = reconciliation.items.filter { $0.status != .missing }
    let renamed = items.filter { item in item.actual.map { $0.name != item.ref.name } ?? false }.count
    let counted = Reconciliation(
        items: items,
        found: items.filter { $0.status == .found }.count,
        changed: items.filter { $0.status == .changed }.count,
        missing: 0,
        renamed: renamed
    )
    return (next, counted)
}

/// The composition's aspect for the outro's preview: the project's destination
/// format, else the frame's own, else portrait.
public func studioOutroAspect(_ aspectId: String, frameAspect: Double?) -> Double {
    if let preset = aspectPreset(aspectId) { return preset.ratio }
    return frameAspect ?? 9.0 / 16.0
}

/// The develop sheet's one batch verb here, when there is another media.
public func developApplyToLabel(_ others: Int) -> String? {
    others > 0 ? "Apply to \(others) other media" : nil
}

// MARK: - the save badge

/// The local save state, as the badge says it — a dot and one word, the word
/// shown on a phone only where the state waits on the author.
public enum StudioSaveState: String, CaseIterable, Sendable {
    case saved
    case saving
    case unsaved
    case storageError = "storage-error"

    public var label: String {
        switch self {
        case .saved: return "Saved"
        case .saving: return "Saving…"
        case .unsaved: return "Edited"
        case .storageError: return "Storage unavailable — in-memory only"
        }
    }

    /// A decision nobody is asked to make does not get made.
    public var needsAction: Bool { self == .storageError }
}

// MARK: - the settings modal

/// The cadence as the author thinks of it — a factor and a direction — rather
/// than capture seconds per media second.
public struct CadenceDraft: Equatable, Sendable {
    public var mode: TimeScaleMode
    /// The clip plays slower than life (slow motion) — else faster (a lapse).
    public var slower: Bool
    /// "This clip plays N× …", at least 1.
    public var factor: Double

    public init(mode: TimeScaleMode, slower: Bool, factor: Double) {
        self.mode = mode; self.slower = slower; self.factor = factor
    }
}

/// The draft a settings modal opens on: the author's figure when it is manual,
/// else what the clip's telemetry measured, rounded to hundredths.
public func cadenceDraft(_ setting: TimeScaleSetting?, measured: TimeScaleReading) -> CadenceDraft {
    let start = setting?.mode == .manual ? (setting?.scale ?? 1) : measured.scale
    let slower = start <= 1
    let magnitude = slower ? 1 / start : start
    return CadenceDraft(mode: setting?.mode ?? .auto, slower: slower, factor: (magnitude * 100).rounded() / 100)
}

/// The setting the draft writes: a factor held inside 1…600 (an unreadable one
/// is 1), turned into capture seconds per media second.
public func timeScaleFromDraft(_ draft: CadenceDraft) -> TimeScaleSetting {
    guard draft.mode == .manual else { return .auto }
    let raw = draft.factor.isFinite && draft.factor != 0 ? draft.factor : 1
    let magnitude = min(600, max(1, raw))
    return TimeScaleSetting(mode: .manual, scale: draft.slower ? 1 / magnitude : magnitude)
}

/// What the "Follow the flight log" option says it will follow.
public func measuredCadenceLabel(_ measured: TimeScaleReading) -> String {
    if measured.basis == .none { return "nothing measurable in this clip — treated as real time" }
    return [describeTimeScale(measured.scale) ?? "real time", formatCadence(measured)]
        .compactMap { $0 }
        .joined(separator: " · ")
}

/// A capture-time shift's minutes as a sign, whole hours and the minutes left.
public func shiftParts(_ minutes: Double) -> (negative: Bool, hours: Int, minutes: Int) {
    let total = Int(minutes.rounded())
    return (total < 0, abs(total) / 60, abs(total) % 60)
}

/// The signed minutes a sign, hours and minutes make.
public func shiftMinutes(negative: Bool, hours: Int, minutes: Int) -> Double {
    let total = abs(hours) * 60 + abs(minutes)
    return Double(negative ? -total : total)
}

// MARK: - a project file on its way in

/// The confirmation's second line, before an imported file replaces the
/// project's portable half.
public func projectImportSummary(_ file: ProjectFile) -> String {
    let count = file.elements.count
    var text = "\(count) element\(count == 1 ? "" : "s") · \(file.settings.aspectId)"
    let layers = file.lutStack.count
    if layers > 0 { text += " · \(layers) LUT layer\(layers == 1 ? "" : "s")" }
    return text + " — the media and the project name stay as they are."
}

/// The confirmation's question.
public func projectImportQuestion(_ file: ProjectFile) -> String {
    let named = file.name.isEmpty ? " the imported file" : " “\(file.name)”"
    return "Replace this project's overlays, style, grade and format with\(named)?"
}

/// The name a project imported from a file takes: the file's own, else the
/// file name without `.json` / `.atelier.json`, else "Imported project".
public func importedProjectName(_ file: ProjectFile, fileName: String) -> String {
    let own = file.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if !own.isEmpty { return own }
    var fallback = fileName
    for suffix in [".atelier.json", ".json"] where fallback.lowercased().hasSuffix(suffix) {
        fallback = String(fallback.dropLast(suffix.count))
        break
    }
    return fallback.isEmpty ? "Imported project" : fallback
}

// MARK: - numbers

/// JavaScript's `${n}`: an integer-valued number prints without `.0`.
private func studioNumber(_ n: Double) -> String {
    if n.isFinite, n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
    return "\(n)"
}
