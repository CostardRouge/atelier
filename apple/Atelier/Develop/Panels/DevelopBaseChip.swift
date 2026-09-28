// THE CAPTURE'S FILES, under the fidelity chip — port of `DevelopBaseMenu`
// (`src/shared/develop/DevelopBase.tsx`, 2026-09-21, replacing the four-rung
// ladder of 2026-09-20 — `docs/capture-renditions.md` §9.1).
//
// One list: the source's proxy where there is one, then what the camera
// delivered — a JPEG, a HEIF, the render inside a RAW — then the sensor, with
// the calibration rungs nested under it, since they are amounts of the
// SENSOR's own calibration and mean nothing on a render. A row this renderer
// cannot draw is listed blocked and says why; a row not in hand says what
// fetching it costs before it is pressed. The rows are the kernel's
// (`renditionsOf`, `Media/Renditions.swift`), the chip's words too
// (`pictureFidelity`, `Develop/PictureFidelity.swift`).
//
// It hangs off the NAME of the file: the name and the chip answer the same
// question — which bytes are on screen — so they are one control, and the
// rendition costs no pill of its own (which is what lets a phone reach it).
// With nothing to choose — one file, no rung — the name stays TEXT: a
// chevron over a menu that cannot change anything is a dead end.
//
// The choice goes back through two callbacks and nothing else: a file below
// the sensor (`onRendition`, the rendition's id) or a rung of the sensor
// (`onBase`); the host decides what either writes (`RollPicture.rendition`,
// `DevelopSettings.base`).

import SwiftUI
import AtelierKit

struct DevelopBaseChip: View {
    let name: String
    let chip: String?
    let rows: [Rendition]
    let current: String?
    let base: DevelopBase
    let rungs: [DevelopBase]
    let status: String?
    let gain: Double?
    let calibration: String?
    let onRendition: (String) -> Void
    let onBase: (DevelopBase) -> Void

    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - name: the open file's name — the trigger's first words.
    ///   - chip: `pictureFidelity(...).chip`, the name's suffix; nil before anything is measured.
    ///   - rows: every rendition of the capture, in `renditionsOf`'s order.
    ///   - current: the rendition on screen, when the develop is below the sensor.
    ///   - base: the rung the develop stands on; `.proxy` while a rendition is on screen.
    ///   - rungs: which rungs the RAW can honestly offer, lowest first (`rungsFor`); empty with no sensor.
    ///   - status: what is happening to get the chosen bytes on screen — fetching, decoding — or nil.
    ///   - gain: the metered exposure once the sensor is decoded (`rawGain`); nil before.
    ///   - calibration: what the RAW's own calibration asks for (`RawCalibration.summary`), nil when none.
    init(name: String, chip: String?, rows: [Rendition], current: String?, base: DevelopBase, rungs: [DevelopBase],
         status: String? = nil, gain: Double? = nil, calibration: String? = nil,
         onRendition: @escaping (String) -> Void, onBase: @escaping (DevelopBase) -> Void) {
        self.name = name
        self.chip = chip
        self.rows = rows
        self.current = current
        self.base = base
        self.rungs = rungs
        self.status = status
        self.gain = gain
        self.calibration = calibration
        self.onRendition = onRendition
        self.onBase = onBase
    }

    var body: some View {
        let files = fileItems
        let ladder = rungItems
        let choosable = (files + ladder).filter { !$0.disabled }.count
        if choosable <= 1 {
            words
                .help(name)
        } else {
            Menu {
                Section {
                    ForEach(files) { item in button(item) }
                }
                if !ladder.isEmpty {
                    Section {
                        ForEach(ladder) { item in button(item) }
                    }
                }
                if let calibration {
                    // What the FILE asks for, said once at the foot: numbers a
                    // person can check against the picture, not a promise.
                    Section {
                        Text("this file asks for \(calibration)")
                    }
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    words
                    Text(verbatim: "▾")
                        .font(Brand.mono(9))
                        .foregroundStyle(palette.faint)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .accessibilityLabel("What this picture is developed from")
            .accessibilityValue(chip.map { "\(name), \($0)" } ?? name)
            .help(name)
        }
    }

    private var words: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(name)
                .font(Brand.mono(12))
                .foregroundStyle(palette.inkSoft)
                .lineLimit(1)
                .truncationMode(.tail)
            if let chip {
                Text(chip.uppercased())
                    .font(Brand.mono(9))
                    .kerning(1.1)
                    .foregroundStyle(palette.faint)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
    }

    private func button(_ item: ChipItem) -> some View {
        Button(action: item.action) {
            if item.marked {
                Label(item.titleLine, systemImage: "checkmark")
            } else {
                Text(item.titleLine)
            }
            Text(item.hint)
        }
        .disabled(item.disabled)
    }

    // MARK: - the rows

    private var onSensor: Bool { base.rung > 0 }
    private var sensor: Rendition? { rows.first { $0.role == .sensor } }

    /// The files below the sensor: the proxy and what the camera delivered.
    private var fileItems: [ChipItem] {
        rows.filter { $0.role != .sensor }.map { row in
            let marked = !onSensor && row.id == current
            let hint: String
            if marked, let status {
                hint = status
            } else {
                hint = row.role == .proxy ? Self.adds(.proxy) : Self.describeDelivered(row)
            }
            return ChipItem(
                id: row.id,
                marked: marked,
                title: row.role == .proxy ? "Proxy" : row.name,
                facts: renditionFacts(row),
                hint: hint,
                disabled: row.blocked != nil,
                action: { onRendition(row.id) }
            )
        }
    }

    /// The sensor's rungs, nested under it: its name on the first, an arrow on the rest.
    private var rungItems: [ChipItem] {
        guard let sensor else { return [] }
        return rungs.filter { $0 != .proxy }.map { rung in
            let marked = onSensor && rung == base
            let hint: String
            if marked {
                if let gain, gain != 0 {
                    let ev = log2(gain)
                    let reading = ev != 0 ? "\(signed(ev, digits: 1)) EV" : "at its white"
                    hint = "metered \(reading)"
                } else {
                    hint = status ?? "decoding the sensor’s data…"
                }
            } else if rung == .gain && !onSensor && !sensor.here {
                let weight = sensor.bytes.map { " · \(formatBytes($0))" } ?? ""
                hint = "opens \(sensor.name) from its instance\(weight), held for this session"
            } else {
                hint = Self.adds(rung)
            }
            return ChipItem(
                id: rung.rawValue,
                marked: marked,
                title: rung == .gain ? "\(sensor.name) → \(rung.label)" : "→ \(rung.label)",
                facts: rung == .gain ? renditionFacts(sensor) : "",
                hint: hint,
                disabled: false,
                action: { onBase(rung) }
            )
        }
    }

    // MARK: - words

    /// What each rung ADDS to the one below — the web's `BASE_ADDS`, the line
    /// a person reads before climbing it.
    static func adds(_ rung: DevelopBase) -> String {
        switch rung {
        case .proxy:
            return "the 8-bit picture every browser decodes — the render your camera wrote, or your source’s proxy. It clips at white."
        case .gain:
            return "the sensor’s own data at sixteen bits, metered by its brightest tone. A real white balance, and the highlights above white are there to bring back."
        case .gainMap:
            return "and the shading grid the body was calibrated for — up to 2.5 stops at the corners on a DJI, a different figure per channel."
        case .gainMapWarp:
            return "and the rectilinear warp beside it: the magnification and the lateral colour fringe the same file states."
        }
    }

    /// What a delivered row IS, in the words under its name.
    private static func describeDelivered(_ row: Rendition) -> String {
        if let blocked = row.blocked { return blocked }
        let fetched = row.here ? "" : " — fetched from its instance and held for this session"
        if row.reach == .embedded { return "the 8-bit render your camera wrote inside the RAW\(fetched)" }
        return "the file itself, 8-bit, drawn as it is\(fetched)"
    }
}

/// One row of the menu.
private struct ChipItem: Identifiable {
    let id: String
    let marked: Bool
    let title: String
    let facts: String
    let hint: String
    let disabled: Bool
    let action: () -> Void

    var titleLine: String { facts.isEmpty ? title : "\(title) · \(facts)" }
}

extension DevelopBaseChip {
    /// The chip from what the workbench KNOWS, through the kernel's own
    /// readers: the capture's files (`captureInput` → `renditionsOf`), the
    /// chip's words (`pictureFidelity`) and the rungs (`rungsFor`).
    ///
    /// `developBase` is the develop's own material; the chip stands on it only
    /// where a sensor is reachable — the web's `wantsRaw`.
    init(facts: CaptureFacts, file: FidelityFile, pixels: FidelityPixels? = nil, current: String?,
         developBase: DevelopBase?, calibration: RawCalibration?, status: String? = nil, gain: Double? = nil,
         onRendition: @escaping (String) -> Void, onBase: @escaping (DevelopBase) -> Void) {
        let rows = renditionsOf(captureInput(facts))
        let hasSensor = rows.contains { $0.role == .sensor }
        let wanted = developBase ?? .proxy
        let base: DevelopBase = hasSensor && wanted.rung > 0 ? wanted : .proxy
        self.init(
            name: file.name,
            chip: pictureFidelity(file, developBase, pixels).chip,
            rows: rows,
            current: current,
            base: base,
            rungs: hasSensor ? rungsFor(calibration) : [],
            status: status,
            gain: gain,
            calibration: calibration?.summary,
            onRendition: onRendition,
            onBase: onBase
        )
    }
}

#Preview("The capture's files") {
    DevelopPreviewState(DevelopBase.proxy) { base in
        DevelopBaseChip(
            name: "DJI_0101.JPG",
            chip: "proxy · 8-bit · 2048 × 1152",
            rows: DevelopPanelFixtures.renditions,
            current: "proxy",
            base: base.wrappedValue,
            rungs: [.proxy, .gain, .gainMap, .gainMapWarp],
            gain: base.wrappedValue.rung > 0 ? 1.6 : nil,
            calibration: "a gain map up to 5.93× at the corners · a 4.93 % warp",
            onRendition: { _ in base.wrappedValue = .proxy },
            onBase: { base.wrappedValue = $0 }
        )
        DevelopBaseChip(name: "IMG_0042.HEIC", chip: "HEIC · 8-bit", rows: [], current: nil, base: .proxy,
                        rungs: [], onRendition: { _ in }, onBase: { _ in })
            .padding(.top, 16)
    }
}
