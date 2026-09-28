// The camera credit, composed à la carte — the web's `panels/CameraPanel.tsx`:
// which facts, in what order, in which of eight layouts, where and how big,
// over a picture whose own EXIF supplies every value.
//
// Rules kept (`roadtrip.md`, «The camera credit is a seventh piece, MEASURED
// and opt-in» and its plate paragraph):
// - The credit is opt-in (`showExif`): a badge is a signature. Beside the
//   switch, the REAL line, or why there is none — a hand-written Camera
//   piece wins and says so, a picture that records none of the facts ticked
//   and one that records nothing at all are told apart.
// - What is STORED is the choice (`PostBadge.camera`, read defensively by
//   `readPlateSpec`); the values are measured from the hook picture at every
//   render (`model.hookExif`, the file's head over what its source vouched
//   for) and never written anywhere. A piece that never opens these rows
//   keeps the plain line it always drew; the first control touched writes the
//   whole choice.
// - The layouts are tiles drawn with the real facts through the badge's own
//   elements and renderer (`CameraPlateTile`).
// - A body's display name is written ONCE, on the TRIP (`cameraNames`),
//   keyed by the name the file gives — a DJI still says `FC8482`, and a
//   table of models shipped here would be an invented one.
// - An edge bar can take a soft dark band along its edge, as a shade of the
//   piece, while there is room for one (four at most).

import SwiftUI
import AtelierKit

struct CameraPlatePanel: View {
    let model: PieceEditorModel
    let trip: TripDoc
    let post: TripPost
    /// The tab's one focus — the body's name types.
    let focus: FocusState<ContentTextField?>.Binding
    @Environment(\.palette) private var palette

    /// The choice, read defensively — junk lands on the defaults.
    private var spec: CameraPlateSpec { readPlateSpec(post.badge.camera?.json) }

    /// The hook picture's effective EXIF, or nil while it is read and for a
    /// clip nothing vouched for — an mp4 has no EXIF head to find, and the
    /// web never reads one (`useEffectiveExif`).
    private var exif: ExifData? {
        guard let read = model.hookExif else { return nil }
        let clip = model.hookRef.map { BadgeSources.isClip($0.name) } ?? false
        if clip && read.via == nil { return nil }
        return read.exif
    }

    var body: some View {
        let spec = self.spec
        let facts = cameraFacts(exif, names: trip.cameraNames)
        VStack(alignment: .leading, spacing: 10) {
            creditRow(spec, facts)
            if post.badge.showExif {
                layoutRow(spec, facts)
                factsRow(spec, facts)
                placeRow(spec)
                sizeRow(spec)
                if let raw = facts.rawBody {
                    bodyRow(raw)
                }
                if spec.layout == .bar && post.badge.shades.count < maxShades {
                    shadeRow(spec)
                }
            }
        }
    }

    /// The whole choice written onto the piece, one field changed.
    private func write(_ change: (inout CameraPlateSpec) -> Void) {
        var next = spec
        change(&next)
        model.patchBadge { $0.camera = next }
    }

    // MARK: - the switch

    private func creditRow(_ spec: CameraPlateSpec, _ facts: CameraFacts) -> some View {
        let hint = cameraCreditHint(override: post.badge.textOverrides[.exif], line: factsLine(facts, spec.fields),
                                    exifRead: exif != nil)
        return ContentFieldRow("Credit") {
            OverlayPanelToggle("Credit the camera", isOn: post.badge.showExif, words: "On the picture") { on in
                model.patchBadge { $0.showExif = on }
            }
        } hint: {
            ContentModeHint(hint: hint)
        }
    }

    // MARK: - the layouts

    private func layoutRow(_ spec: CameraPlateSpec, _ facts: CameraFacts) -> some View {
        let words = cameraWordsOf(trip.badgeWords.camera)
        let columns = [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)]
        let hint = plateLayouts.first { $0.id == spec.layout }?.hint
        return ContentFieldRow("Layout", alignTop: true) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
                ForEach(plateLayouts, id: \.id) { option in
                    CameraPlateTile(option: option, facts: facts, fields: spec.fields, words: words, theme: trip.theme,
                                    pressed: spec.layout == option.id) {
                        write { $0.layout = option.id }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Camera layout")
        } hint: {
            if let hint { ContentHint(hint) }
        }
    }

    // MARK: - the facts, ticked and ordered

    private func factsRow(_ spec: CameraPlateSpec, _ facts: CameraFacts) -> some View {
        ContentFieldRow("Facts", alignTop: true) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(cameraFieldRows(spec.fields), id: \.id) { info in
                    CameraFactRow(info: info, chosen: spec.fields, value: cameraFactValue(facts, info.id),
                                  recorded: facts.facts[info.id] != nil) { next in
                        write { $0.fields = next }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Facts credited")
        }
    }

    // MARK: - where it sits, how big

    private func placeRow(_ spec: CameraPlateSpec) -> some View {
        let underBadge = spec.place == .badge
        let anchor = post.badge.layout.anchor
        return ContentFieldRow("Place", alignTop: true) {
            HStack(alignment: .top, spacing: 10) {
                Button("Under the badge") { write { $0.place = .badge } }
                    .buttonStyle(DevelopPillButtonStyle(on: underBadge))
                    .accessibilityAddTraits(underBadge ? .isSelected : [])
                CameraCellGrid(selection: spec.place, badgeAnchor: anchor) { cell in
                    write { $0.place = .cell(cell) }
                }
            }
        } hint: {
            ContentHint(cameraPlaceHint(spec, badgeAnchor: anchor))
        }
    }

    private func sizeRow(_ spec: CameraPlateSpec) -> some View {
        DevelopRangeSlider("Size", value: spec.size, in: minPlateSize...maxPlateSize, step: 0.05, reset: 1,
                           printed: plateSizeLabel(spec.size)) { size in
            write { $0.size = size }
        }
        .accessibilityHint("Camera credit size")
    }

    // MARK: - the body's name, on the trip

    private func bodyRow(_ raw: String) -> some View {
        let alias = Binding(
            get: { cameraBodyAlias(model.trip?.cameraNames, raw) },
            set: { value in model.changeTrip { $0.cameraNames = withCameraBodyAlias($0.cameraNames, raw, value) } }
        )
        return ContentFieldRow("Body") {
            TextField("Body", text: alias, prompt: Text(verbatim: raw))
                .textFieldStyle(.roundedBorder)
                .font(Brand.sans(13))
                .autocorrectionDisabled()
                .focused(focus, equals: .body)
                .onSubmit { focus.wrappedValue = nil }
                .accessibilityLabel("What this trip calls \(raw)")
        } hint: {
            ContentHint("What this trip calls “\(raw)” — written once, used on every piece.")
        }
    }

    // MARK: - a shade under an edge bar

    private func shadeRow(_ spec: CameraPlateSpec) -> some View {
        ContentFieldRow("") {
            Button {
                model.patchBadge { badge in
                    guard badge.shades.count < maxShades else { return }
                    badge.shades.append(cameraBarShade(spec))
                }
            } label: {
                Label("Shade under the bar", systemImage: "plus")
            }
            .buttonStyle(DevelopPillButtonStyle())
        } hint: {
            ContentHint("A soft dark band along that edge, so the bar reads over any sky.")
        }
    }
}

/// One fact of the list: its tick, its name and what this picture records
/// for it, and — once ticked — the arrows that move it in the credit.
struct CameraFactRow: View {
    let info: CameraFieldInfo
    let chosen: [CameraField]
    let value: String
    let recorded: Bool
    /// The new order of the chosen facts.
    let onChange: ([CameraField]) -> Void
    @Environment(\.palette) private var palette

    private var picked: Bool { chosen.contains(info.id) }

    var body: some View {
        HStack(spacing: 8) {
            Toggle(isOn: Binding(get: { picked }, set: { want in onChange(cameraFieldsToggled(chosen, info.id, want)) })) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: info.label)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                    Text(verbatim: value)
                        .font(Brand.mono(10))
                        .foregroundStyle(recorded ? palette.inkSoft : palette.faint)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .toggleStyle(CheckToggleStyle())
            Spacer(minLength: 0)
            if picked { arrows }
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 8).fill(palette.paper))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.line, lineWidth: 1))
        .opacity(picked ? 1 : 0.65)
    }

    private var arrows: some View {
        let up = cameraFieldsMoved(chosen, info.id, -1)
        let down = cameraFieldsMoved(chosen, info.id, 1)
        return HStack(spacing: 2) {
            arrow("arrow.up", "Move \(info.label) up", up)
            arrow("arrow.down", "Move \(info.label) down", down)
        }
    }

    private func arrow(_ symbol: String, _ label: String, _ next: [CameraField]?) -> some View {
        Button {
            if let next { onChange(next) }
        } label: {
            Image(systemName: symbol)
                .font(Brand.sans(11, weight: .semibold))
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(palette.inkSoft)
        .disabled(next == nil)
        .opacity(next == nil ? 0.35 : 1)
        .accessibilityLabel(label)
    }
}

#Preview("Camera") {
    let model = PieceEditorFixtures.model()
    ScrollView {
        ContentFocusPreview { focus in
            if let trip = model.trip, let post = model.post {
                CameraPlatePanel(model: model, trip: trip, post: post, focus: focus)
            }
        }
        .padding(16)
    }
    .frame(width: 360, height: 640)
    .darkroom()
}
