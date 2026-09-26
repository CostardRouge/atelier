// The editor's side of the complete pixel path (`FullDevelopRenderPlan`):
// installing it, hearing what each render drew from, and the RAW LADDER the
// fidelity chip offers — the web's `PictureWorkbench.tsx` around `onBase`,
// `onRawDecoded` and the chip's rows.
//
// Rules kept (`raw.md`):
// - `proxy` is the ABSENCE of a base: going back to it takes the base, its
//   gain and its white balance off; climbing keeps the numbers and SAYS that
//   they now act on another material.
// - The measured exposure is STORED the moment it is known, once: a stored
//   gain is never overwritten by a later decode's measurement, so the export
//   applies the stage's number (preview = export).
// - A rung is offered only where the FILE carries its opcode (`rungsFor`),
//   and the chip names the rung really drawn, not the one asked for.

import AtelierKit
import CoreGraphics
import Foundation

/// What the fidelity chip needs to draw the capture's files and the ladder.
struct BaseChipModel {
    var rows: [Rendition] = []
    var current: String?
    var base: DevelopBase = .proxy
    var rungs: [DevelopBase] = []
    var status: String?
    var gain: Double?
    var calibration: String?
}

extension RollEditor {
    /// Install the complete pixel path — once, when the editor opens. The
    /// plan tells the editor what each render drew from, and asks for another
    /// render when something it drew without (a subject's map) has arrived.
    /// It shares the Layers tab's subject model — one answer per picture and
    /// frame, whichever asks first — and reads the tab's seam
    /// (`LayerLooking`: its subjects, the open layer's wash and blink), which
    /// is what makes the tab's own render stand down (`planDrawsLayers`).
    func installFullRenderPlan() {
        guard !(renderPlan is FullDevelopRenderPlan) else { return }
        let plan = FullDevelopRenderPlan(subjects: layerEdit.subjects)
        plan.layerLooking = layerEdit.looking
        plan.onInvalidate = { [weak self] in
            Task { @MainActor in self?.requestRender() }
        }
        plan.onSource = { [weak self] id, facts in
            Task { @MainActor in self?.adoptSourceFacts(id, facts) }
        }
        setRenderPlan(plan)
    }

    /// The plan the editor draws through, when it is the complete one.
    var fullRenderPlan: FullDevelopRenderPlan? { renderPlan as? FullDevelopRenderPlan }

    /// A render drew from `facts`: remembered for the chip, and a measured
    /// exposure stored on the open picture's develop — once.
    func adoptSourceFacts(_ id: String, _ facts: DevelopSourceFacts) {
        sourceFacts[id] = facts
        guard id == openId, facts.onSensor, let gain = facts.measuredGain,
              isRawDevelop(developDraft), developDraft.rawGain == nil else { return }
        var d = developDraft
        d.rawGain = gain
        setDevelopDraft(d)
        let ev = log2(gain)
        let reading = ev != 0 ? "\(signed(ev, digits: 1)) EV" : "at its white"
        tell("RAW · \(facts.width)×\(facts.height) · metered \(reading)")
    }

    // MARK: - what is on screen

    /// The open picture's RAW, when the file in hand is one this device read.
    var openRaw: RawAccess? {
        guard let id = openId else { return nil }
        return pool.held(id)?.decoded.raw
    }

    /// The rung really DRAWN — the sensor's once a render drew from it, else
    /// the proxy (the render, or the file): what the chip names.
    var shownBase: DevelopBase {
        guard let id = openId, isRawDevelop(developDraft), let facts = sourceFacts[id], facts.onSensor else {
            return .proxy
        }
        return facts.rung
    }

    /// The pixels on screen, and the file's own where it holds more — for the chip.
    var shownPixels: FidelityPixels? {
        guard let id = openId else { return nil }
        if shownBase != .proxy, let facts = sourceFacts[id] {
            return FidelityPixels(width: facts.width, height: facts.height, viaRawPreview: false, full: facts.full)
        }
        guard let size = decodedSize else { return nil }
        let decoded = pool.held(id)?.decoded
        let full = decoded?.raw?.sensor.map { PixelSize(width: Int($0.width.rounded()), height: Int($0.height.rounded())) }
        return FidelityPixels(width: Int(size.width), height: Int(size.height),
                              viaRawPreview: decoded?.viaRawPreview ?? false, full: full)
    }

    /// The chip's rows and ladder for the open picture: the render inside
    /// its RAW and its sensor with the rungs its file can reach — nothing
    /// for a picture that is not a RAW here (the name stays text).
    var baseChip: BaseChipModel {
        guard let p = picture, let raw = openRaw else { return BaseChipModel() }
        let measured = decodedSize.map { PixelSize(width: Int($0.width), height: Int($0.height)) }
        let sensor = raw.sensor.map { PixelSize(width: Int($0.width.rounded()), height: Int($0.height.rounded())) }
        let rows = renditionsOf(captureInput(CaptureFacts(file: p.ref, measured: measured, sensor: sensor)))
        let wantsRaw = isRawDevelop(developDraft)
        let drawn = sourceFacts[p.id]?.onSensor == true
        return BaseChipModel(
            rows: rows,
            current: rows.first { $0.role != .sensor }?.id,
            base: wantsRaw ? developBase(developDraft) : .proxy,
            rungs: raw.rungs,
            status: wantsRaw && !drawn ? "decoding the sensor’s data…" : nil,
            gain: wantsRaw ? developDraft.rawGain : nil,
            calibration: raw.calibration?.summary
        )
    }

    // MARK: - the ladder

    /// Climb to a rung, or come back to the proxy — the web's `onBase`.
    func setBase(_ next: DevelopBase) {
        guard picture != nil else { return }
        var d = developDraft
        if next == .proxy {
            guard isRawDevelop(d) else { return }
            d.base = nil
            d.rawGain = nil
            d.carried["rawWb"] = nil
            setDevelopDraft(d)
            return
        }
        guard openRaw != nil else { return }
        let climbing = !isRawDevelop(d)
        d.base = next
        setDevelopDraft(d)
        if climbing && !isDefaultDevelop(withoutBase(d)) {
            tell("your numbers now act on the RAW — another starting point")
        }
    }
}
