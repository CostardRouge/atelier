// The Studio's Export tab in words and numbers — what `StudioEditor.tsx`
// computes inline around its Output · Variants · Export sections (the rows'
// menus and hints, the button, the line over the bar), lifted out of the view
// so the native panel says exactly what the web says and a spec holds it. The
// web has no spec of its own for these: each is pinned from its JSX, and the
// few sentences the native panel adds (a cancelled run, the *Delivers* row
// over a file on this device) are marked as such.
//
// Rules the words carry (`studio.md`):
// - a variant NEVER upscales (`variantOutputSize`), so a row that asks for
//   more than the source holds says what it really gets (`resolutionShortfall`);
// - a cadence above the source's duplicates frames, never interpolates;
// - a re-timed variant ships silent, because the clip's sound is copied;
// - the *Delivers* row asks its question against the LARGEST frame the
//   variants will write (the web's `stillFrame`).

import Foundation

/// `${n}`: an integer-valued number prints without `.0`.
private func exportPanelNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

// MARK: - the frame the variants write

/// The largest frame the variants will write from a `srcW`×`srcH` source —
/// the frame the *Delivers* row asks its question against (the web's
/// `stillFrame`, by area, the first of equals kept). Nil with no source size
/// or no variant.
public func largestVariantFrame(_ variants: [ExportVariant], _ srcW: Double, _ srcH: Double) -> Size? {
    guard srcW > 0, srcH > 0, srcW.isFinite, srcH.isFinite else { return nil }
    var best: Size?
    for variant in variants {
        let out = variantOutputSize(variant, srcW, srcH)
        if let held = best, out.width * out.height <= held.width * held.height { continue }
        best = out
    }
    return best
}

// MARK: - a variant row's menus

/// The Format menu's words for an aspect id: `Source frame`, or a preset's
/// `9:16 — Reels · TikTok · Shorts`; an id this build does not know is shown
/// as itself rather than dropped.
public func variantFormatLabel(_ aspectId: String) -> String {
    if aspectId == "source" { return "Source frame" }
    guard let preset = aspectPreset(aspectId) else { return aspectId }
    return "\(preset.id) — \(preset.label)"
}

/// The Format menu's ids, in the web's order: the source frame, then every
/// preset — plus the row's own id when it is none of them (a newer build's).
public func variantFormatChoices(current: String? = nil) -> [String] {
    var ids = ["source"] + aspectPresets.map(\.id)
    if let current, !ids.contains(current) { ids.append(current) }
    return ids
}

/// The Resolution menu: Source · 1080p · 720p — plus the row's own short
/// side when it is another (a stored 480 stays on screen, never snapped).
public func variantResolutionChoices(current: VariantResolution? = nil) -> [VariantResolution] {
    var list: [VariantResolution] = [.source, .shortSide(1080), .shortSide(720)]
    if let current, !list.contains(current) { list.append(current) }
    return list
}

/// `Source`, `1080p`.
public func variantResolutionLabel(_ resolution: VariantResolution) -> String {
    switch resolution {
    case .source: return "Source"
    case .shortSide(let lines): return "\(exportPanelNumber(lines))p"
    }
}

/// The Frame rate menu's first row: `Source (29.97 fps)`, or `Source` while
/// the clip's cadence is unknown.
public func frameRateSourceLabel(_ sourceFps: Double?) -> String {
    guard let fps = sourceFps, fps > 0 else { return "Source" }
    return "Source (\(exportPanelNumber(fps)) fps)"
}

/// The Frame rate menu: the source's own, then the delivery choices — plus
/// the row's own rate when it is none of them.
public func frameRateMenu(current: ExportFrameRate? = nil) -> [ExportFrameRate] {
    var list: [ExportFrameRate] = [.source] + frameRateChoices.map { .fps(Double($0)) }
    if let current, !list.contains(current) { list.append(current) }
    return list
}

/// A Speed menu row: `Normal`, `2×`, `4× — real time` (the one that undoes
/// this clip's own conform).
public func speedOptionLabel(_ speed: Double, realtimeRate: Double) -> String {
    let name = speed == 1 ? "Normal" : "\(exportPanelNumber(speed))×"
    return speed != 1 && speed == realtimeRate ? "\(name) — real time" : name
}

// MARK: - a variant row's hints

/// Under Resolution, when the source cannot give what the row asks. The
/// second sentence only while a proxy is being rendered from on purpose.
public func shortfallHint(_ shortfall: ResolutionShortfall, renderingFromProxy: Bool) -> String {
    let base = "\(exportPanelNumber(shortfall.asked))p was asked for; this source delivers \(exportPanelNumber(shortfall.delivered))p."
    return renderingFromProxy ? base + " Turn off “From proxy” to export from the original." : base
}

/// Under Frame rate, when the row asks for more frames than the clip holds.
public func frameRateHint(_ rate: ExportFrameRate, sourceFps: Double?) -> String? {
    guard let source = sourceFps, source > 0, case .fps(let asked) = rate, asked > source else { return nil }
    return "\(exportPanelNumber(asked)) fps from \(exportPanelNumber(source)) — frames are duplicated, not interpolated: no new motion."
}

/// Under Speed, when the row re-times the clip: what it will last and why it
/// leaves silent. `duration` is the clip's own, 0 while unknown.
public func speedHint(_ speed: Double, duration: Double) -> String? {
    let resolved = resolveSpeed(speed)
    guard resolved != 1 else { return nil }
    var line = "\(exportPanelNumber(resolved))× speed"
    if duration > 0 {
        line += " — \(formatDuration(retimedDuration(duration, speed))) instead of \(formatDuration(duration))"
    }
    return line + ", delivered without audio: a copied track would drift against a re-timed picture."
}

// MARK: - the Output rows

/// The *From proxy* row's hint over a clip an instance handed over as its
/// proxy. `proxyHeight` is what is on the stage.
public func fromProxyHint(sourceId: String, proxyHeight: Int?, fetchesOriginal: Bool) -> String {
    let height = proxyHeight.map { " (\($0)p)" } ?? ""
    let tail = fetchesOriginal
        ? " — the export fetches the original first, so the deliverables are full quality."
        : " — and delivering from it: faster, nothing large crosses the network, proxy quality."
    return "You are editing on \(sourceId)'s proxy\(height)\(tail)"
}

/// The *Delivers* row's hint over a still an instance handed over as its
/// proxy: the decision's reason first, or what is still to measure.
public func proxyDeliversHint(sourceId: String, reason: String?, measured: Bool) -> String {
    let lead: String
    if let reason, !reason.isEmpty {
        lead = "\(reason). "
    } else {
        lead = measured ? "" : "Measured once the picture is decoded. "
    }
    return lead + "You are editing on \(sourceId)’s proxy: the full-size original is fetched only where the proxy could not fill the frame your variants ask for, and kept for this session. A RAW is reached only through the render inside it, measured first — develop it on its RAW for the sensor itself."
}

// MARK: - the run

/// The Export button: `Export JPEG`, `Export 3 JPEGs`, `Export MP4`, `Export 2 MP4s`.
public func studioExportVerb(_ medium: VariantMedium, _ count: Int) -> String {
    let unit = medium == .photo ? "JPEG" : "MP4"
    return count > 1 ? "Export \(count) \(unit)s" : "Export \(unit)"
}

/// The button's tooltip.
public func studioExportHelp(_ medium: VariantMedium) -> String {
    medium == .photo
        ? "Render every variant as a JPEG, one after the other"
        : "Render every variant (H.264 MP4), one after the other"
}

/// The line over the bar while a run works: the capture being fetched, else
/// which variant and how far (`Variant 2/3 · 45%`), else `Exporting… 45%`.
/// `index` counts from 1.
public func studioExportProgressLine(fetchingFrom: String?, fetching: Bool, index: Int?, total: Int?,
                                     ratio: Double) -> String {
    if fetching { return "Fetching the original from \(fetchingFrom ?? "the source")… " }
    let percent = Int((max(0, min(1, ratio)) * 100 + 0.5).rounded(.down))
    if let index, let total, total > 1 { return "Variant \(index)/\(total) · \(percent)%" }
    return "Exporting… \(percent)%"
}

/// What a cancelled run says — the native panel's own sentence (the web's
/// run returns in silence): what was written stays, and says how much.
public func studioExportCancelledNote(written: Int, total: Int) -> String {
    if written <= 0 { return "Export cancelled — nothing was written." }
    if written == 1 { return "Export cancelled — 1 variant of \(total) written, kept where it landed." }
    return "Export cancelled — \(written) variants of \(total) written, kept where they landed."
}
