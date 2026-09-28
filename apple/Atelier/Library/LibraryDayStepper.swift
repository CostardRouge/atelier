// The instance tab's day — the native twin of the web's `DayPicker.tsx`: a
// stepper `‹ day ›` whose middle opens the MONTH as the instance holds it.
//
// - With a tool publishing, it opens on the tool's day and the arrows look at
//   the day before / after WITHOUT moving it — the Library's own override,
//   worn in the accent while it looks elsewhere, with `↺ <the tool's day>` to
//   follow the tool again. Out of a span of several days the arrows step from
//   its edges. With no publisher it is simply the day being browsed.
// - The line under it says where the view sits against the ANCHOR ("the day
//   before", "day 2 of 3", "open in Trips") or against today, then what the
//   instance answered — a dot that pulses while it asks, so "asking" is never
//   the same picture as "nothing here".
// - Nothing is shot after today: the forward arrow says so rather than asking.
// - The month reads two ways, a click apart and remembered
//   (`atelier.library.month-view`): a STRIP says where the shooting was (one
//   bar a day, a floor so a quiet day still shows — `densityStrip`), a
//   CALENDAR which weekday it fell on. Under both, a lane marks the tool's own
//   days in the accent and the span it belongs to (`MediaScope.within`) in a
//   stronger line — marks only, nothing is listed by them. A month is ONE
//   `calendar()` request, in the tab's half.

import SwiftUI
import AtelierKit

struct LibraryDayStepper: View {
    /// What the tab shows.
    let span: DaySpan
    let onDay: (String) -> Void
    /// What the tool publishes, when one does.
    let published: MediaScope?
    /// True while the tab looks elsewhere than the tool.
    let overridden: Bool
    let onReset: () -> Void
    /// The instance's answer is still coming.
    let asking: Bool
    /// How many files it holds there; nil for no answer.
    let count: Int?
    let client: WinnowClient?
    let host: String
    let half: LibraryHalf?

    @Environment(\.palette) private var palette
    @State private var open = false

    var body: some View {
        let today = todayIso(Date(), in: .current)
        let anchor = published.map { DaySpan(from: $0.from, to: $0.to) }
        let single = span.from == span.to
        let whereLine = stepperWhere(day: span.from, anchor: anchor, publisher: published?.publisher,
                                     overridden: overridden, today: today)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 0) {
                arrow("‹", "The day before") { step(-1) }
                Rectangle().fill(palette.line).frame(width: 1)
                Button { open.toggle() } label: {
                    HStack(spacing: 4) {
                        if single {
                            Text(tripWeekdays[weekdayIndex(span.from) ?? 0]).foregroundStyle(palette.muted)
                            Text(formatIsoDate(span.from))
                        } else {
                            Text(spanLabel(span))
                        }
                        Text("▾").font(Brand.mono(8)).foregroundStyle(palette.faint)
                    }
                    .font(Brand.mono(12))
                    .foregroundStyle(overridden ? palette.accentInk : palette.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Pick a day from what \(host) holds")
                .popover(isPresented: $open, arrowEdge: .bottom) {
                    LibraryMonthPanel(span: span, published: published, today: today, client: client, host: host,
                                      half: half) { day in
                        onDay(day)
                        open = false
                    }
                    .presentationCompactAdaptation(.popover)
                }
                Rectangle().fill(palette.line).frame(width: 1)
                arrow("›", "The day after") { step(1) }
                    .disabled(span.to >= today)
            }
            .frame(height: 32)
            .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(overridden ? palette.accent : palette.line, lineWidth: 1))
            HStack(spacing: 6) {
                LibraryAskingDot(asking: asking, lit: (count ?? 0) > 0)
                Text("\(whereLine) · \(stepperCount(asking: asking, count: count))")
                    .font(Brand.sans(11))
                    .foregroundStyle(overridden ? palette.accentInk : palette.muted)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if overridden, let published {
                    Button("↺ \(published.label)", action: onReset)
                        .buttonStyle(.plain)
                        .font(Brand.mono(10))
                        .foregroundStyle(palette.muted)
                        .underline()
                        .help("Back to what \(published.publisher) has open — \(published.label)")
                }
            }
        }
    }

    private func arrow(_ glyph: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph)
                .font(Brand.sans(15))
                .foregroundStyle(palette.muted)
                .frame(width: 32)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }

    /// One step out of what is shown — from a span's edges.
    private func step(_ direction: Int) {
        if let next = stepOut(span, direction) { onDay(next) }
    }
}

/// The dot under the stepper: pulsing while asked, accent when something is there.
struct LibraryAskingDot: View {
    let asking: Bool
    let lit: Bool
    @Environment(\.palette) private var palette
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(asking ? palette.faint : (lit ? palette.accent : palette.faint))
            .frame(width: 6, height: 6)
            .opacity(asking && pulse ? 0.3 : 1)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - the month

struct LibraryMonthPanel: View {
    let span: DaySpan
    let published: MediaScope?
    let today: String
    let client: WinnowClient?
    let host: String
    let half: LibraryHalf?
    let onPick: (String) -> Void

    @Environment(\.palette) private var palette
    @AppStorage("atelier.library.month-view") private var view = "strip"
    @State private var month: String
    @State private var counts: [String: Int] = [:]
    @State private var bounds: CalendarBounds?
    @State private var busy = true
    @State private var failed = false
    @State private var hovered: String?

    init(span: DaySpan, published: MediaScope?, today: String, client: WinnowClient?, host: String, half: LibraryHalf?,
         onPick: @escaping (String) -> Void) {
        self.span = span
        self.published = published
        self.today = today
        self.client = client
        self.host = host
        self.half = half
        self.onPick = onPick
        _month = State(initialValue: monthKeyOf(span.from))
    }

    var body: some View {
        let shape = monthSpan(month)
        let strip = densityStrip(shape.days, counts)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Button { month = shiftMonth(month, -1) } label: { Image(systemName: "chevron.left") }
                    .disabled(bounds.map { monthKeyOf($0.min) >= month } ?? false)
                Text(monthLabel(month))
                    .font(Brand.sans(13, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .frame(maxWidth: .infinity)
                    .help(bounds.map { "\(host) holds media from \($0.min) to \($0.max)" } ?? "")
                Button { month = shiftMonth(month, 1) } label: { Image(systemName: "chevron.right") }
                    .disabled(month >= monthKeyOf(today))
                Button {
                    view = view == "strip" ? "calendar" : "strip"
                } label: {
                    Image(systemName: view == "strip" ? "calendar" : "chart.bar.xaxis")
                }
                .help(view == "strip" ? "Show the month as a calendar" : "Show the month as a strip")
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.inkSoft)
            Group {
                if view == "strip" {
                    stripBody(strip)
                } else {
                    calendarBody(shape)
                }
            }
            .opacity(busy ? 0.5 : 1)
            .allowsHitTesting(!busy)
            Text(monthStripLine(host: host, monthKey: month, busy: busy, failed: failed, hovered: hovered,
                                hoveredCount: hovered.map { counts[$0] ?? 0 } ?? 0, strip: strip))
                .font(Brand.mono(10))
                .foregroundStyle(failed ? palette.danger : palette.muted)
            if touchesMarks(shape) { marksKey }
        }
        .padding(14)
        .frame(width: 300)
        .background(palette.surface)
        .task(id: "\(month)|\(half?.rawValue ?? "all")") { await load() }
    }

    private func load() async {
        busy = true
        failed = false
        let shape = monthSpan(month)
        guard let client, !shape.days.isEmpty else {
            busy = false
            failed = client == nil
            return
        }
        do {
            let calendar = try await client.calendar(shape.from, shape.to, FilterQuery(half: half))
            if Task.isCancelled { return }
            var next: [String: Int] = [:]
            for day in calendar.days { next[day.date, default: 0] += day.count }
            counts = next
            if calendar.bounds != nil { bounds = calendar.bounds }
        } catch {
            if Task.isCancelled { return }
            counts = [:]
            failed = true
        }
        busy = false
    }

    // MARK: the two readings

    private func stripBody(_ strip: DensityStrip) -> some View {
        HStack(alignment: .bottom, spacing: 1) {
            ForEach(strip.bars, id: \.date) { bar in
                Button { onPick(bar.date) } label: {
                    VStack(spacing: 2) {
                        Spacer(minLength: 0)
                        Rectangle()
                            .fill(bar.count > 0 ? palette.accent.opacity(chosen(bar.date) ? 1 : 0.75) : palette.line)
                            .frame(height: max(3, 40 * CGFloat(bar.fill)))
                        mark(bar.date)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .overlay(alignment: .bottom) {
                        if chosen(bar.date) {
                            Rectangle().stroke(palette.ink, lineWidth: 1).frame(height: 44).offset(y: -5)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(bar.date > today)
                .onHover { inside in
                    if inside { hovered = bar.date } else if hovered == bar.date { hovered = nil }
                }
                .help("\(bar.date)\(bar.count > 0 ? " · \(bar.count) files" : "")")
            }
        }
    }

    private func calendarBody(_ shape: MonthSpan) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)
        return LazyVGrid(columns: columns, spacing: 2) {
            ForEach(tripWeekdays, id: \.self) { name in
                Text(String(name.prefix(1)))
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.faint)
            }
            ForEach(0..<shape.leading, id: \.self) { _ in Color.clear.frame(height: 30) }
            ForEach(shape.days, id: \.self) { day in
                let n = counts[day] ?? 0
                Button { onPick(day) } label: {
                    VStack(spacing: 2) {
                        Text(String(Int(day.suffix(2)) ?? 0))
                            .font(Brand.mono(11))
                            .foregroundStyle(n > 0 ? palette.ink : palette.faint)
                        Circle().fill(n > 0 ? palette.accent : Color.clear).frame(width: 4, height: 4)
                        mark(day)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 30)
                    .background(chosen(day) ? palette.paper2 : Color.clear, in: RoundedRectangle(cornerRadius: 4))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(day > today)
                .onHover { inside in
                    if inside { hovered = day } else if hovered == day { hovered = nil }
                }
            }
        }
    }

    // MARK: the marks

    private func chosen(_ day: String) -> Bool {
        day >= span.from && day <= span.to
    }

    /// The foot under a day: the tool's own days, else the span around them.
    @ViewBuilder
    private func mark(_ day: String) -> some View {
        if let published, day >= published.from, day <= published.to {
            Rectangle().fill(palette.accent).frame(height: 2)
        } else if let within = published?.within, day >= within.from, day <= within.to {
            Rectangle().fill(palette.lineStrong).frame(height: 2)
        } else {
            Color.clear.frame(height: 2)
        }
    }

    private func touchesMarks(_ shape: MonthSpan) -> Bool {
        guard let published, !shape.days.isEmpty else { return false }
        let from = published.within?.from ?? published.from
        let to = published.within?.to ?? published.to
        return !(to < shape.from || from > shape.to)
    }

    private var marksKey: some View {
        HStack(spacing: 10) {
            if let published {
                HStack(spacing: 4) {
                    Rectangle().fill(palette.accent).frame(width: 10, height: 2)
                    Text(published.label).font(Brand.sans(10)).foregroundStyle(palette.muted)
                }
                if let within = published.within {
                    HStack(spacing: 4) {
                        Rectangle().fill(palette.lineStrong).frame(width: 10, height: 2)
                        Text(within.label).font(Brand.sans(10)).foregroundStyle(palette.muted)
                    }
                }
            }
        }
    }
}
