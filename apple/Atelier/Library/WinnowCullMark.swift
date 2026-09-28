// Winnow's CULLING in the Library's instance tab — READ, never written: the
// native twin of the web's `CullMark.tsx` and the `CullLine` beside Develop's
// filmstrip (`RollEditor.tsx`), over the kernel's `Sources/Winnow/Culling.swift`.
//
// Culling is Winnow's job (`docs/lightroom-gaps.md` §8, item 33, the
// maintainer's answer of 2026-09-23): Atelier SHOWS what a row says — a flag
// for a pick or a reject, the stars as a count, the label as a dot — and
// FILTERS on it, and never sets it. Nothing here is a target.
//
// Where it departs from the web: the web reads culling in Develop's filmstrip
// only; the Library's instance tab lists the same rows, which carry
// `verdict`, `star` and `color_label` already (`GRID_SELECT` joins `ratings`
// into every `/api/assets` row), so the tab marks its tiles and narrows by the
// same filters. The filter narrows what the grid draws AND what the lightbox
// pages through — one list, so an index means one thing. A row Winnow said
// nothing about passes `all` and `not rejected` only (`passesCull`).

import SwiftUI
import AtelierKit

extension LabelColour {
    /// The label as a swatch — DATA colours, the ones a photographer knows
    /// from Lightroom (the web's `SWATCH`), never interface tokens: they must
    /// read the same on paper and at night.
    var swatch: Color {
        switch self {
        case .red: return Color(hex: 0xD4493C)
        case .yellow: return Color(hex: 0xE2BD2F)
        case .green: return Color(hex: 0x4F9A52)
        case .blue: return Color(hex: 0x3F78C8)
        case .purple: return Color(hex: 0x9361C1)
        }
    }
}

/// Winnow's word on one picture, as small as it can be said. Draws nothing
/// for a picture Winnow has not culled.
struct WinnowCullMark: View {
    let culling: Culling?
    /// Laid on a picture: its own ground, so it reads over any pixels.
    var onMedia = false

    @Environment(\.palette) private var palette

    var body: some View {
        if let culling, shows(culling) {
            let colour = labelColour(culling.color)
            let said = "Winnow: \(describeCulling(culling))"
            HStack(spacing: 2) {
                if culling.verdict == .pick {
                    Text("⚑").foregroundStyle(palette.ok)
                } else if culling.verdict == .reject {
                    Text("✕").foregroundStyle(palette.danger)
                }
                if culling.star > 0 { Text("★\(culling.star)") }
                if let colour {
                    Circle().fill(colour.swatch).frame(width: 6, height: 6)
                }
            }
            .font(Brand.mono(9))
            .monospacedDigit()
            .foregroundStyle(onMedia ? palette.ink : palette.inkSoft)
            .padding(.horizontal, onMedia ? 4 : 0)
            .padding(.vertical, onMedia ? 2 : 0)
            .background(onMedia ? palette.surface.opacity(0.85) : Color.clear, in: Capsule())
            .help(said)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(said)
        }
    }

    private func shows(_ c: Culling) -> Bool {
        c.verdict == .pick || c.verdict == .reject || c.star > 0 || labelColour(c.color) != nil
    }
}

/// `Winnow · 3 picks, 1 rejected · show picks ▾ (3 shown)` — what the day's
/// rows say, and the filter over them. Drawn only where a row answered.
struct LibraryCullLine: View {
    let counts: CullCounts
    let filter: CullFilter
    let onFilter: (CullFilter) -> Void
    /// How many rows the filter leaves, or nil with none on.
    let shown: Int?

    @Environment(\.palette) private var palette

    private var said: String {
        var parts: [String] = []
        if counts.picks > 0 { parts.append("\(counts.picks) pick\(counts.picks == 1 ? "" : "s")") }
        if counts.rejects > 0 { parts.append("\(counts.rejects) rejected") }
        if counts.starred > 0 { parts.append("\(counts.starred) starred") }
        return parts.isEmpty ? "nothing culled" : parts.joined(separator: ", ")
    }

    var body: some View {
        let on = filter != .all
        HStack(spacing: 6) {
            Text("Winnow · \(said)")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
                .lineLimit(1)
            Menu {
                ForEach(Array(cullFilters.enumerated()), id: \.offset) { _, option in
                    Button {
                        onFilter(option)
                    } label: {
                        if option == filter {
                            Label(menuLabel(option), systemImage: "checkmark")
                        } else {
                            Text(menuLabel(option))
                        }
                    }
                }
            } label: {
                Text(menuLabel(filter))
                    .font(Brand.mono(10))
                    .foregroundStyle(on ? palette.accentInk : palette.muted)
                    .underline(pattern: .dot)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Show in the grid, by Winnow's culling — read-only: culling stays Winnow's")
            .accessibilityLabel("Show in the grid, by Winnow's culling")
            if let shown {
                Text("(\(shown) shown)")
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.faint)
            }
            Spacer(minLength: 0)
        }
    }

    private func menuLabel(_ f: CullFilter) -> String {
        f == .all ? "show all" : "show \(cullFilterLabel(f).lowercased())"
    }
}

#Preview("Marks and the line") {
    VStack(alignment: .leading, spacing: 12) {
        WinnowCullMark(culling: Culling(verdict: .pick, star: 3, color: "red"))
        WinnowCullMark(culling: Culling(verdict: .reject, star: 0, color: nil), onMedia: true)
        LibraryCullLine(counts: CullCounts(known: 3, picks: 2, rejects: 1, starred: 1), filter: .picks,
                        onFilter: { _ in }, shown: 2)
    }
    .padding()
}
