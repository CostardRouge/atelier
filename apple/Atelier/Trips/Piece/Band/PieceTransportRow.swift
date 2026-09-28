// The band's control row — the web's `DeckStrip.tsx`, its row half: ▶ (the
// whole piece, slide after slide, LOOPING — or the cut while it is open), the
// time, the open slide's name and what it plays, the loop pill (Piece ⇄
// Slide, `L`), a clip's speed and its Cut, the opener's ticks (`M`), ⋯ (move,
// remove, the closing card) and +.
//
// Rules kept (`roadtrip.md`, «Aiguille» and its phone revision of
// 2026-09-22):
// - On a phone every control is a finger's target: a 40-point play, 34-point
//   pills, ⋯ and + at 34; the row is 40 points (32 beside a pointer, with
//   28-point pills and a 32-point play). The words on the loop and Cut pills
//   fold to their glyphs there, the total time goes, and the ticks toggle
//   moves into ⋯ — a clip hook already puts the speed and the cut on the row,
//   and a seventh control left the slide's name no room at all.
// - The loop pill hides while the cut is open: the cut loops its own
//   stretch, whatever the pill says.
// - The speed is the Studio's own steps (`clipSpeeds`); other than 1× a clip
//   goes out without sound, and the row says so.
// - What the slide plays is said in the web's words: `5s · from 0:01.20 · 2× ·
//   no sound` on a clip, its cut and its screen time while cutting, `3s ·
//   image` on a still, the closing card's seconds alone.

import SwiftUI
import AtelierKit

struct PieceTransportRow: View {
    let model: PieceEditorModel
    let compact: Bool
    /// Where the band stands — the finger's while one holds it.
    let shown: Double
    /// The opener has ticks to hear (only on the hook).
    let hasSound: Bool

    @Environment(\.palette) private var palette
    @State private var playHover = false

    var body: some View {
        HStack(spacing: compact ? 6 : 8) {
            playButton
            timecode
            nameLine
            // What the loop runs over — hidden while the cut is open.
            if !model.trimOpen { loopPill }
            if model.isClipSlide {
                speedPill
                cutPill
            }
            if hasSound && !compact { soundPill }
            moreMenu
            addButton
        }
        .frame(height: compact ? 40 : 32)
    }

    // MARK: - the words

    /// `Hook`, `Picture 2`, `Closing card`.
    static func slideName(_ slide: DeckSlide) -> String {
        switch slide.kind {
        case .hook: return "Hook"
        case .cta: return "Closing card"
        case .content: return "Picture \(slide.position)"
        }
    }

    /// `5s`, `2.5s` — the web's `toFixed(1)` with a whole number's `.0` dropped.
    static func secondsWord(_ v: Double) -> String {
        let s = String(format: "%.1f", v)
        return (s.hasSuffix(".0") ? String(s.dropLast(2)) : s) + "s"
    }

    /// `2`, `0.25` — a speed as JavaScript prints the number.
    static func speedWord(_ v: Double) -> String {
        v == v.rounded() && abs(v) < 1e9 ? String(Int(v)) : String(v)
    }

    private var slideLoop: Bool { model.loopScope == .slide }

    /// What the open slide plays, in the web's words.
    private var detail: String {
        guard let slide = model.slide else { return "" }
        let length = model.slideSeconds
        if model.isClipSlide {
            let range = model.clipRange
            let speed = slide.speed
            let silent = speed != 1 ? " · no sound" : ""
            if model.trimOpen {
                let screen = PieceTransportRow.secondsWord(screenSecondsOf(range, speed))
                return "\(formatTimecode(range.start)) → \(formatTimecode(range.end)) · \(screen) on screen\(silent)"
            }
            let retimed = speed != 1 ? " · \(PieceTransportRow.speedWord(speed))×\(silent)" : ""
            return "\(PieceTransportRow.secondsWord(length)) · from \(formatTimecode(range.start))\(retimed)"
        }
        if slide.kind == .cta { return PieceTransportRow.secondsWord(length) }
        return "\(PieceTransportRow.secondsWord(length)) · \(slide.medium == .video ? "video" : "image")"
    }

    // MARK: - ▶ and the time

    private var playButton: some View {
        let size: CGFloat = compact ? 40 : 32
        let playing = model.stagePlaying
        return Button {
            model.togglePlay()
        } label: {
            Image(systemName: playing ? "pause.fill" : "play.fill")
                .font(.system(size: compact ? 15 : 12, weight: .bold))
                .foregroundStyle(palette.paper)
                .frame(width: size, height: size)
                .background(Circle().fill(playHover ? palette.accent : palette.ink))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { playHover = $0 }
        .help(playHelp)
        .accessibilityLabel(playLabel(playing))
    }

    private func playLabel(_ playing: Bool) -> String {
        if playing { return "Pause" }
        if model.trimOpen { return "Play the cut" }
        return slideLoop ? "Play this slide" : "Play the piece"
    }

    private var playHelp: String {
        if model.trimOpen { return "Play the cut, looping (Space)" }
        return slideLoop ? "Play this slide, looping (Space)" : "Play the whole piece, slide after slide, looping (Space)"
    }

    private var timecode: some View {
        HStack(spacing: 0) {
            Text(formatTimecode(shown)).foregroundStyle(palette.inkSoft)
            if !compact {
                Text(" / \(formatTimecode(model.deck.seconds))").foregroundStyle(palette.muted)
            }
        }
        .font(Brand.mono(10.5))
        .monospacedDigit()
        .fixedSize()
    }

    private var nameLine: some View {
        let name = model.slide.map(PieceTransportRow.slideName) ?? ""
        let title: Text = Text(name).font(Brand.sans(12)).foregroundStyle(palette.ink)
        let said: Text = Text(" · \(detail)").font(Brand.mono(9.3)).foregroundStyle(palette.muted)
        let line: Text = title + said
        return line
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
            .help(detail)
    }

    // MARK: - the pills

    /// A pill of the row: a caption's height beside a pointer, a finger's on a phone.
    private func pill<Content: View>(on: Bool, square: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
        let height: CGFloat = compact ? 34 : 28
        return content()
            .font(Brand.mono(compact ? 12 : 10.5))
            .tracking(0.4)
            .foregroundStyle(on ? palette.accentInk : palette.muted)
            .padding(.horizontal, square ? 0 : (compact ? 10 : 8))
            .frame(minWidth: square ? height : nil)
            .frame(height: height)
            .background(Capsule().fill(on ? palette.accentWash : palette.paper))
            .overlay(Capsule().strokeBorder(on ? palette.accent : palette.lineStrong, lineWidth: 1))
            .contentShape(Capsule())
    }

    private var loopPill: some View {
        let on = slideLoop
        return Button {
            model.toggleLoopScope()
        } label: {
            pill(on: on) {
                HStack(spacing: 4) {
                    Image(systemName: on ? "repeat.1" : "repeat")
                        .font(.system(size: 11, weight: .semibold))
                    if !compact { Text(on ? "Slide" : "Piece") }
                }
            }
        }
        .buttonStyle(.plain)
        .help(on ? "Looping this slide — click for the whole piece (L)" : "Looping the whole piece — click for this slide only (L)")
        .accessibilityLabel(on ? "Looping this slide — loop the whole piece" : "Looping the whole piece — loop this slide")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var speedPill: some View {
        let current = model.slide?.speed ?? 1
        let word = "\(PieceTransportRow.speedWord(current))×"
        return Menu {
            Picker("Clip speed", selection: speed) {
                ForEach(clipSpeeds, id: \.self) { s in
                    Text("\(PieceTransportRow.speedWord(s))×").tag(s)
                }
            }
            .pickerStyle(.inline)
        } label: {
            pill(on: current != 1) {
                Text(word)
            }
            // On a phone a FIXED width: a pill among pills, never sized on
            // its widest word.
            .frame(width: compact ? 56 : nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("The speed this slide plays at — on the stage and in the file. Other than 1× it goes out without sound")
        .accessibilityLabel("Clip speed")
        .accessibilityValue(word)
    }

    private var speed: Binding<Double> {
        Binding(get: { model.slide?.speed ?? 1 }, set: { model.setClipSpeed($0) })
    }

    private var cutPill: some View {
        let on = model.trimOpen
        return Button {
            model.setTrimming(!on)
        } label: {
            pill(on: on) {
                HStack(spacing: 4) {
                    Image(systemName: on ? "checkmark" : "scissors")
                        .font(.system(size: 11, weight: .semibold))
                    if !compact { Text(on ? "Done" : "Cut") }
                }
            }
        }
        .buttonStyle(.plain)
        .help(on ? "Back to the piece" : "Cut this clip: its in and out points (I · O at the playhead)")
        .accessibilityLabel(on ? "Done" : "Cut")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var soundPill: some View {
        let on = model.soundOn
        return Button {
            model.soundOn.toggle()
        } label: {
            pill(on: on, square: true) {
                Image(systemName: on ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.system(size: 11, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .help(on ? "Mute the ticks (M)" : "Hear the ticks (M)")
        .accessibilityLabel(on ? "Mute the opener’s ticks" : "Hear the opener’s ticks")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: - ⋯ and +

    private var iconSize: CGFloat { compact ? 34 : 28 }

    private var moreMenu: some View {
        let slide = model.slide
        let ci = slide?.kind == .content ? model.slideIndex - 1 : -1
        let contentCount = model.slides.filter { $0.kind == .content }.count
        let hasCard = model.slides.contains { $0.kind == .cta }
        let includeCta = model.post?.includeCta ?? false
        let name = slide.map(PieceTransportRow.slideName) ?? "this slide"
        return Menu {
            if ci >= 0 {
                Button("Move earlier") { model.moveSlide(from: ci, to: ci - 1) }
                    .disabled(ci == 0)
                Button("Move later") { model.moveSlide(from: ci, to: ci + 1) }
                    .disabled(ci >= contentCount - 1)
            }
            // On a phone the ticks toggle lives here rather than on the row.
            if hasSound && compact {
                Button(model.soundOn ? "Mute the opener’s ticks" : "Hear the opener’s ticks") {
                    model.soundOn.toggle()
                }
            }
            if !includeCta {
                Button("Close with the call to action") { model.setIncludeCta(true) }
            } else {
                Button(hasCard ? "Edit the closing card…" : "Write the closing card…") { model.editClosingCard() }
                Button("End on the last picture") { model.setIncludeCta(false) }
            }
            if ci >= 0 {
                Button("Remove this picture", role: .destructive) { model.removeSlide() }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(palette.inkSoft)
                .frame(width: iconSize, height: iconSize)
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("More for \(name)")
        .accessibilityLabel("More for \(name)")
    }

    private var addButton: some View {
        Button {
            model.addSlide()
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(palette.inkSoft)
                .frame(width: iconSize, height: iconSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Add the active picture to this piece")
        .accessibilityLabel("Add the active picture to this piece")
    }
}
