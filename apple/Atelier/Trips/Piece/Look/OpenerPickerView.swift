// Choosing the piece's OPENER — which hook variant draws its first slide. Port
// of `src/tools/roadtrip/panels/HookPicker.tsx`.
//
// Rules kept (`roadtrip.md`, «The picker»; `docs/hook-engine.md`):
// - Cards, never a menu: a look you cannot see before adopting is a look you
//   adopt by trial. Each card carries the variant's own SKETCH of what it does
//   (`OpenerSketchView`, the openers' task) — not a render of this piece: the
//   stage beside the picker already shows the real thing.
// - A variant this piece cannot feed is greyed WITH THE REASON on its card
//   (`hookUnmet`), never hidden: a variant you cannot find is a feature that
//   does not exist.
// - The chosen variant's own options mount UNDER the cards
//   (`OpenerOptionsView`, the openers' task), so the panel below always
//   belongs to the card above. The badge has no options, so no panel.
// - Only the FIRST layer is written (`setHookVariant`): a click on the card
//   already chosen keeps its settings, a real change starts from the
//   variant's defaults, and a stored stack survives.
// - The picker is the variant panel's HOST: a panel never opens the Library
//   or asks an instance itself, so the chooser of the pictures an opener
//   flashes or pins (`OpenerPicturesSheet`) is presented HERE, when the panel
//   asks through `\.chooseOpenerPictures` — the web's
//   `HookPanelHost.choosePictures`.

import SwiftUI
import AtelierKit

struct OpenerPickerView: View {
    let model: PieceEditorModel

    /// The opener's picture chooser, asked for by its options panel.
    @State private var choosingPictures = false

    /// Spelled out: a private `@State` would make the memberwise one private.
    init(model: PieceEditorModel) {
        self.model = model
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(hookVariants, id: \.id) { variant in
                    OpenerCard(variant: variant, active: variant.id == currentId, unmet: unmet(variant)) {
                        choose(variant)
                    }
                }
            }
            if showsOptions {
                OpenerOptionsView(model: model)
            }
        }
        .environment(\.chooseOpenerPictures, ChooseOpenerPicturesAction { choosingPictures = true })
        .sheet(isPresented: $choosingPictures) {
            OpenerPicturesSheet(model: model)
                .darkroom()
        }
    }

    /// The variant the piece's first layer names; "" when it names none.
    private var currentId: String {
        model.post?.badge.hook.first?.id ?? ""
    }

    /// A variant with options of its own — every one but the badge, which has
    /// none and so no panel. An id this build does not know shows none either.
    private var showsOptions: Bool {
        guard let current = hookVariantById(currentId) else { return false }
        return current.id != defaultHookId
    }

    private func unmet(_ variant: HookVariant) -> String? {
        guard let ctx = model.hookState?.ctx else { return nil }
        return hookUnmet(variant, ctx)
    }

    private func choose(_ variant: HookVariant) {
        model.patchBadge { badge in
            badge.hook = setHookVariant(badge.hook, variant)
        }
    }
}

/// One variant's card: its sketch, its name, and its line — or, greyed, why
/// this piece cannot run it.
private struct OpenerCard: View {
    let variant: HookVariant
    let active: Bool
    let unmet: String?
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                sketch
                words
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ground, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(edge, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        }
        .buttonStyle(.plain)
        .disabled(unmet != nil)
        .opacity(unmet != nil ? 0.55 : 1)
        .help(unmet ?? variant.tagline)
        .accessibilityLabel("\(variant.name): \(unmet ?? variant.tagline)")
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    /// The web's 4.6 × 2.2 rem box on the frame's ground.
    private var sketch: some View {
        OpenerSketchView(variantId: variant.id)
            .frame(width: 74, height: 35)
            .background(palette.frame)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .accessibilityHidden(true)
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: variant.name)
                .font(Brand.sans(13, weight: .semibold))
                .foregroundStyle(palette.ink)
            Text(verbatim: unmet ?? variant.tagline)
                .font(Brand.sans(11))
                .foregroundStyle(unmet != nil ? palette.accentInk : palette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var ground: Color {
        active && unmet == nil ? palette.accentWash : palette.paper
    }

    private var edge: Color {
        active && unmet == nil ? palette.accent : palette.line
    }
}

// MARK: - the host's verb

/// The picker's verb for the opener's picture chooser — handed to the
/// variant's options (`OpenerOptionsView`) through the environment; calling it
/// presents `OpenerPicturesSheet(model:)` over the inspector. The chooser
/// reads what the opener holds and writes back through the model itself.
struct ChooseOpenerPicturesAction {
    let run: () -> Void
    func callAsFunction() { run() }
}

private struct ChooseOpenerPicturesKey: EnvironmentKey {
    static let defaultValue: ChooseOpenerPicturesAction? = nil
}

extension EnvironmentValues {
    /// Set by the Look tab's opener picker; nil anywhere else.
    var chooseOpenerPictures: ChooseOpenerPicturesAction? {
        get { self[ChooseOpenerPicturesKey.self] }
        set { self[ChooseOpenerPicturesKey.self] = newValue }
    }
}

#Preview("Opener picker") {
    let model = PieceEditorFixtures.model()
    ScrollView {
        OpenerPickerView(model: model)
            .padding(16)
    }
    .frame(width: 360, height: 520)
    .darkroom()
}
