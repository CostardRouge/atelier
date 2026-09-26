// The run's TARGETS — the web's `ExportTargets.tsx` (audit item 28): the
// first writes into the folder chosen at the click, each other one into a
// sub-folder named after it, every file keeping its picture's own name. Each
// picture is rendered once and cut to every target.
//
// A size's number is typed and COMMITTED on Return or when the field is left
// (`SizeValueField`): clamped per keystroke, "2048" would pass through 2, 20
// and 204 and be pushed up to the minimum on the way (`develop-output.md`).

import SwiftUI
import AtelierKit

struct ExportTargetsView: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        let targets = editor.exportSettings.targets
        let clashes = ExportTargetsView.clashes(targets)
        VStack(alignment: .leading, spacing: 12) {
            ForEach(targets.indices, id: \.self) { i in
                if i > 0 { Hairline() }
                TargetBlock(editor: editor, index: i, target: targets[i], count: targets.count, clash: clashes.contains(i))
            }
            if targets.count < maxTargets {
                ExportRow("Also write") {
                    Menu {
                        ForEach(targetPresets.indices, id: \.self) { i in
                            Button(targetPresets[i].label) { add(i) }
                        }
                    } label: {
                        Text("Add a target…")
                            .font(Brand.sans(12, weight: .semibold))
                            .foregroundStyle(palette.inkSoft)
                    }
                    .menuStyle(.button)
                    .fixedSize()
                }
            }
        }
    }

    /// A preset as a new target of its own — a second one of one name gets a
    /// number, or the two would share a sub-folder.
    private func add(_ preset: Int) {
        let made = targetPresets[preset].target
        editor.setExport { export in
            guard export.targets.count < maxTargets else { return }
            var taken = Set<String>()
            for (k, t) in export.targets.enumerated() where k > 0 {
                taken.insert(targetFolder(t.name, index: k).lowercased())
            }
            var name = made.name
            var n = 2
            while taken.contains(name.lowercased()) {
                name = "\(made.name) \(n)"
                n += 1
            }
            var target = made
            target.name = name
            export.targets.append(target)
        }
    }

    /// The targets whose sub-folder an earlier one already writes into.
    static func clashes(_ targets: [ExportTarget]) -> Set<Int> {
        var seen = Set<String>()
        var out = Set<Int>()
        for (i, t) in targets.enumerated() where i > 0 {
            let folder = targetFolder(t.name, index: i).lowercased()
            if seen.contains(folder) { out.insert(i) }
            seen.insert(folder)
        }
        return out
    }
}

/// One target: where it writes, its size, its quality, its screen sharpening,
/// whether it carries the watermark.
private struct TargetBlock: View {
    @Bindable var editor: RollEditor
    let index: Int
    let target: ExportTarget
    let count: Int
    let clash: Bool
    @Environment(\.palette) private var palette
    @FocusState private var naming: Bool

    private var folder: String { targetFolder(target.name, index: index) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if clash {
                ExportHint("two targets write into \(folder)/ — the second numbers its files", tone: .danger)
            }
            ExportRow("Size") { sizeRow }
            DevelopRangeSlider("Quality", value: target.quality, in: qualityLimits.min...qualityLimits.max, step: 0.01,
                               reset: ExportTarget.default.quality, printed: "\(Int((target.quality * 100).rounded())) %") { q in
                patch { $0.quality = q }
            }
            ExportRow("Sharpen") {
                VStack(alignment: .leading, spacing: 3) {
                    Picker("Sharpen for screen", selection: Binding(get: { target.sharpen }, set: { level in patch { $0.sharpen = level } })) {
                        ForEach(outputSharpenLevels, id: \.self) { level in
                            Text(TargetBlock.sharpenLabel(level)).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    if target.sharpen != .off {
                        ExportHint("for a screen, after the resize")
                    }
                }
            }
            Toggle(isOn: Binding(get: { target.watermark }, set: { on in patch { $0.watermark = on } })) {
                Text("Watermark")
                    .font(Brand.sans(13))
                    .foregroundStyle(palette.ink)
            }
            .toggleStyle(.switch)
            .accessibilityLabel("Watermark \(index == 0 ? "the chosen folder" : folder)")
        }
    }

    @ViewBuilder
    private var header: some View {
        if index == 0 {
            Text(count > 1 ? "The chosen folder" : "Where you choose, at the click")
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
        } else {
            HStack(spacing: 6) {
                Text("into")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                TextField("Target \(index + 1)", text: Binding(get: { target.name }, set: { name in
                    patch { $0.name = String(name.prefix(64)) }
                }))
                .textFieldStyle(.roundedBorder)
                .font(Brand.sans(13))
                .focused($naming)
                .onChange(of: naming) { _, focused in editor.textEditing = focused }
                .accessibilityLabel("Sub-folder")
                Text("/")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                Button {
                    remove()
                } label: {
                    Image(systemName: "trash")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove the \(folder) target")
                .help("Remove the \(folder) target")
            }
        }
    }

    private var sizeRow: some View {
        let mode = target.size?.mode.rawValue ?? "full"
        return HStack(spacing: 6) {
            Picker("Size", selection: Binding(get: { mode }, set: { setMode($0) })) {
                ForEach(TargetBlock.sizeModes) { option in
                    Text(option.label).tag(option.id)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .fixedSize()
            if let size = target.size {
                SizeValueField(editor: editor, mode: size.mode, value: size.value) { value in
                    patch { $0.size = ExportSize(mode: size.mode, value: value) }
                }
            }
        }
    }

    private func setMode(_ id: String) {
        guard let mode = SizeMode(rawValue: id) else {
            patch { $0.size = nil }
            return
        }
        let current = target.size
        patch { $0.size = convertSize(current, mode) }
    }

    /// One change to THIS target, through the roll's one updater.
    private func patch(_ change: (inout ExportTarget) -> Void) {
        let i = index
        editor.setExport { export in
            guard i < export.targets.count else { return }
            change(&export.targets[i])
        }
    }

    private func remove() {
        let i = index
        editor.setExport { export in
            guard i > 0, i < export.targets.count else { return }
            export.targets.remove(at: i)
        }
    }

    struct SizeOption: Identifiable {
        let id: String
        let label: String
    }

    static let sizeModes: [SizeOption] = [
        SizeOption(id: "full", label: "Full size"),
        SizeOption(id: "long", label: "Long edge"),
        SizeOption(id: "short", label: "Short edge"),
        SizeOption(id: "megapixels", label: "Megapixels"),
        SizeOption(id: "percent", label: "Percentage"),
    ]

    static func sharpenLabel(_ level: OutputSharpen) -> String {
        switch level {
        case .off: return "Off"
        case .low: return "Low"
        case .standard: return "Standard"
        case .high: return "High"
        }
    }
}

/// A size's number, typed and committed on Return or when the field is left;
/// a number out of reach is clamped, anything else puts the old one back.
private struct SizeValueField: View {
    @Bindable var editor: RollEditor
    let mode: SizeMode
    let value: Double
    let onCommit: (Double) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 4) {
            TextField("Size", text: $text)
                .textFieldStyle(.roundedBorder)
                .font(Brand.mono(13))
                .monospacedDigit()
                .frame(width: 76)
                .focused($focused)
                .onSubmit(commit)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
                .accessibilityLabel("Size in \(unit)")
            Text(unit)
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
        }
        .onAppear { text = SizeValueField.printed(value) }
        .onChange(of: value) { _, next in
            if !focused { text = SizeValueField.printed(next) }
        }
        .onChange(of: focused) { _, now in
            editor.textEditing = now
            if !now { commit() }
        }
    }

    private var unit: String {
        switch mode {
        case .long, .short: return "px"
        case .megapixels: return "MP"
        case .percent: return "%"
        }
    }

    private func commit() {
        let typed = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let raw: JSONValue = .object(["mode": .string(mode.rawValue), "value": .number(Double(typed) ?? .nan)])
        guard Double(typed) != nil, let read = readSize(raw) else {
            text = SizeValueField.printed(value)
            return
        }
        text = SizeValueField.printed(read.value)
        if read.value != value { onCommit(read.value) }
    }

    /// `2048`, `2.5` — as the web's number field shows it.
    static func printed(_ value: Double) -> String {
        DevelopNumbers.plain(value)
    }
}

#Preview("Targets") {
    ScrollView {
        ExportTargetsView(editor: ExportPreview.editor())
            .padding(14)
    }
    .frame(width: 360, height: 700)
    .darkroom()
}
