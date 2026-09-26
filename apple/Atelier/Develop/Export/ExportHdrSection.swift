// HDR delivery — the web's HDR section of `ExportPanel.tsx` (`hdr.md`): an
// Ultra HDR JPEG is an ordinary JPEG carrying a small gain map, MEASURED from
// a second render of the picture developed darker — never invented — and
// called Ultra HDR only after the file is read back and holds. Only a picture
// from a RAW has anything above white to carry; a render leaves plain, said.
//
// What the display can show is DETECTED and said in one sentence, rather than
// drawn: the stage shows the SDR base, as the web's does.

import SwiftUI
import AtelierKit
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct ExportHdrSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    static let info = [
        "An Ultra HDR JPEG is an ordinary JPEG — every viewer shows it — carrying a small second picture, the gain map: how much brighter each pixel may go on a display with headroom. A viewer that reads gain maps (Photos, a recent browser on an HDR screen) lifts the highlights; everything else shows the base.",
        "The map is measured, never invented: the picture is developed again, darker by the stops asked, and where the SDR ran out at white the sensor’s own highlights are what the map carries. Only a picture from a RAW has them — an 8-bit render holds nothing above white and leaves as a plain JPEG, said in the run. The file is read back and its map checked against the rendition before it is called Ultra HDR. A HEIC leaves plain: Ultra HDR is a JPEG.",
    ]

    var body: some View {
        let export = editor.exportSettings
        let run = editor.exportRun
        DevelopSection(id: "hdr", title: "HDR", info: ExportHdrSection.info, marked: export.hdr) {
            VStack(alignment: .leading, spacing: 3) {
                Toggle(isOn: Binding(get: { export.hdr }, set: { on in editor.setExport { $0.hdr = on } })) {
                    Text("Deliver Ultra HDR JPEG")
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.ink)
                }
                .toggleStyle(.switch)
                .accessibilityLabel("Ultra HDR")
                ExportHint(HdrDisplay.line)
            }
            if export.hdr {
                ExportRow("Reach") {
                    VStack(alignment: .leading, spacing: 3) {
                        Picker("HDR reach", selection: Binding(get: { export.hdrStops }, set: { stops in
                            editor.setExport { $0.hdrStops = stops }
                        })) {
                            ForEach(RollExport.hdrStopsLimits.min...RollExport.hdrStopsLimits.max, id: \.self) { stops in
                                Text(stops == 1 ? "1 stop" : "\(stops) stops").tag(stops)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .fixedSize()
                        ExportHint("how far above white the map may reach — the RAW is developed this much darker to find what is there")
                    }
                }
                if run.format == .heic {
                    ExportHint("The format under Deliver is HEIC: every picture leaves plain. Ultra HDR is a JPEG.", tone: .warn)
                }
            }
            if let line = ExportHdrSection.describe(run.hdr), !run.running {
                Text(line)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The last run's HDR outcome in one line, or nil when none was asked.
    static func describe(_ hdr: RollRunHdr?) -> String? {
        guard let hdr else { return nil }
        if hdr.asked == 0 { return "no picture in the run was from a RAW, so none carried a gain map" }
        let head = "\(hdr.ultra) of \(hdr.asked) left as Ultra HDR"
        if hdr.ultra == 0 { return "\(head) — the others had nothing above white" }
        let reach = " · up to \(String(format: "%.1f", hdr.headroom)) stops above white"
        let check = hdr.checked.map { " · read back within \(String(format: "%.2f", $0)) stops" } ?? ""
        return head + reach + check
    }
}

/// What THIS display can show of an HDR picture — the web's `hdr-display.ts`,
/// asked of the screen: its extended-range headroom. The stage stays the SDR
/// base, and the sentence says so rather than drawing a preview that pretends.
enum HdrDisplay {
    @MainActor static var headroom: Double {
        #if os(iOS)
        return Double(UIScreen.main.potentialEDRHeadroom)
        #elseif os(macOS)
        return Double(NSScreen.main?.maximumPotentialExtendedDynamicRangeColorComponentValue ?? 1)
        #else
        return 1
        #endif
    }

    @MainActor static var line: String {
        headroom > 1.05
            ? "This display shows HDR, but the stage draws SDR only: it shows the base, the file glows in a viewer that can."
            : "This display shows SDR: the file’s headroom shows on an HDR screen, in a viewer that reads gain maps."
    }
}

#Preview("HDR") {
    ScrollView {
        ExportHdrSection(editor: ExportPreview.editor())
            .padding(14)
    }
    .frame(width: 360, height: 400)
    .darkroom()
}
