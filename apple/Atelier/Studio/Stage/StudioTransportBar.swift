// The transport under the stage — the web's band in `StudioEditor.tsx`: two
// groups, and the row wraps between them rather than pushing the last tool
// past the edge: the RAIL (play, the clock, the trim bar, the length) and
// the TOOLS (↻ loop the range, ⌾ capture this frame, the preview speed,
// A/B). Under them, on a line of its own that is ALWAYS drawn — appearing on
// the first drag, it would resize the row and move the rail under the finger
// mid-gesture — the trim readout, or, untrimmed, how to make one.
//
// A still has no transport to offer (no play, no trim, no cadence, no
// shutter — the export IS the still); what survives is the one control about
// the picture rather than about time: the A/B wipe.

import SwiftUI
import AtelierKit

struct StudioTransportBar: View {
    @Bindable var editor: StudioEditor
    let onGrab: () -> Void
    let grabbing: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        if editor.isPhoto {
            still
        } else if editor.activeVideo != nil {
            clip
        }
    }

    // MARK: - a still

    private var still: some View {
        HStack(spacing: 8) {
            Text("STILL")
                .font(Brand.mono(10))
                .kerning(1)
                .foregroundStyle(palette.faint)
            Spacer(minLength: 0)
            abButton
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }

    // MARK: - a clip

    private var clip: some View {
        let playback = editor.playback
        let readout = trimReadout(editor.range, playback.duration, learned: editor.trimLearned)
        return VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    rail
                    tools
                }
                VStack(alignment: .leading, spacing: 8) {
                    rail
                    tools
                }
            }
            HStack(spacing: 8) {
                if readout.trimmed {
                    Text("TRIM")
                        .font(Brand.mono(10))
                        .kerning(1.2)
                        .foregroundStyle(palette.muted)
                    Text(readout.text)
                        .font(Brand.mono(11))
                        .monospacedDigit()
                        .foregroundStyle(palette.accentInk)
                        .help("Trimmed range — only this part previews and exports")
                    Button {
                        editor.clearTrim()
                    } label: {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.system(size: 11, weight: .semibold))
                            .frame(width: 22, height: 22)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(palette.accentInk)
                    .accessibilityLabel("Clear the trim")
                    .help("Use the whole clip again")
                } else {
                    Text(readout.text)
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.faint)
                }
                Spacer(minLength: 0)
            }
            .frame(height: 18)
            .padding(.leading, 46)
            .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }

    private var rail: some View {
        let playback = editor.playback
        return HStack(spacing: 12) {
            Button {
                editor.togglePlay()
            } label: {
                Image(systemName: playback.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.paper)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(palette.ink))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playback.playing ? "Pause" : "Play")
            .help("Play / pause (Space)")
            Text(formatTimecode(playback.time))
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
                .frame(minWidth: 56)
            StudioTrimBar(duration: playback.duration, time: playback.time, range: editor.range,
                          minLength: editor.frameStep, step: editor.frameStep,
                          onSeek: { editor.seek($0) },
                          onScrub: { editor.playback.setScrubbing($0) },
                          onRangeChange: { editor.applyRange($0) })
                .frame(minWidth: 140)
            Text(formatDuration(playback.duration))
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
        }
    }

    private var tools: some View {
        HStack(spacing: 8) {
            pill(on: editor.loop, help: "Loop the trimmed range instead of stopping on the out point") {
                editor.loop.toggle()
            } label: {
                Text("↻")
            }
            .accessibilityLabel("Loop the range")
            pill(on: false, help: "Save this frame as a JPEG, overlays and look burned in") {
                onGrab()
            } label: {
                Text(grabbing ? "…" : "⌾")
            }
            .disabled(grabbing || editor.stage.image == nil)
            .accessibilityLabel("Capture frame")
            speedMenu
            abButton
        }
        .fixedSize()
    }

    /// Preview speed — viewing only; the delivered speed lives in the Export tab.
    private var speedMenu: some View {
        let realtime = editor.realtimeRate
        let rate = previewRate(editor.previewSpeed, realtimeRate: realtime)
        let label: String = {
            if case .realtime = editor.previewSpeed { return realtimeSpeedLabel(realtime) }
            return "\(StudioTransportBar.number(rate))×"
        }()
        return Menu {
            ForEach(speedChoices, id: \.self) { speed in
                Button("\(StudioTransportBar.number(speed))×") { editor.setPreviewSpeed(.rate(speed)) }
            }
            if realtime != 1 {
                Button(realtimeSpeedLabel(realtime)) { editor.setPreviewSpeed(.realtime) }
            }
        } label: {
            Text(label)
                .font(Brand.mono(11))
                .kerning(0.6)
                .foregroundStyle(rate == 1 ? palette.muted : palette.accentInk)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(rate == 1 ? palette.paper : palette.accentWash))
                .overlay(Capsule().stroke(rate == 1 ? palette.lineStrong : palette.accent, lineWidth: 1))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Preview speed — the readouts and the export are untouched")
        .accessibilityLabel("Preview speed")
    }

    private var abButton: some View {
        pill(on: editor.compareOn, help: "Compare original vs composed — drag the divider on the stage") {
            editor.setCompare(!editor.compareOn)
        } label: {
            Text("A/B")
        }
        .accessibilityLabel("Compare original and composed")
        .accessibilityAddTraits(editor.compareOn ? .isSelected : [])
    }

    private func pill<Content: View>(on: Bool, help: String, action: @escaping () -> Void,
                                     @ViewBuilder label: () -> Content) -> some View {
        Button(action: action) {
            label()
                .font(Brand.mono(11))
                .kerning(0.8)
                .foregroundStyle(on ? palette.accentInk : palette.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(on ? palette.accentWash : palette.paper))
                .overlay(Capsule().stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(help)
    }

    /// A rate as the web writes a number: `1`, `0.25`.
    private static func number(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(n)
    }
}
