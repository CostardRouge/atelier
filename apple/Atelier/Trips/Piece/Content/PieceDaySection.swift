// The Content tab's DAY section — the web's `panels/ContentTab.tsx`, «Day»:
// the day the piece tells, where it lands in the trip, a range when the piece
// covers several days, and the picture's OWN date offered beside it.
//
// Rules kept (`roadtrip.md`, «The day a piece tells is measured from the
// picture»):
// - Every number the badge draws is a subtraction from this day, so a picture
//   filed under the wrong day reads confidently wrong. The picture's date is
//   MEASURED — its EXIF, else what its source vouched for at ingest, else the
//   file's date, labelled as the weak guess it is (`readCaptureDate`) — and
//   OFFERED ("file it under that day"); nothing here rewrites the piece on
//   its own. A picture dated outside the trip is called out.
// - The day belongs to the PIECE, not to a slide: this section is never
//   inside the hook-only branch, or it would vanish on a carousel's second
//   picture (`roadtrip.md`, «A control about the PIECE»).
// - A range is the rare case: "Through" appears once there is one, or once
//   it is asked for; "One day" clears it.
//
// The date read is the open slide's lead file — the Library's ticked picture,
// or a collage's lead by name (`leadRef`) — its head read off the main actor,
// once per file.

import SwiftUI
import AtelierKit

struct PieceDaySection: View {
    let model: PieceEditorModel
    let trip: TripDoc
    let post: TripPost
    /// What the picture under the open slide says about its own day.
    @State private var captured: CaptureDate?
    /// "This piece covers several days…" was asked for.
    @State private var wantRange = false
    @Environment(\.palette) private var palette

    private var showRange: Bool { wantRange || post.endDate != nil }

    var body: some View {
        DevelopSection(id: "piece.day", title: "Day", info: ["Everything the badge says is counted from this day."],
                       remember: .local) {
            fromRow
            if showRange {
                throughRow
            } else {
                ContentFieldRow("") {
                    Button("This piece covers several days…") { wantRange = true }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
        }
        .task(id: fileKey) { await readCaptured() }
    }

    // MARK: - the day

    private var fromRow: some View {
        ContentFieldRow(showRange ? "From" : "Day") {
            TripDateField(label: "The day this piece tells", value: dateBinding, min: nil, max: nil)
            Text(verbatim: pieceDayOfTrip(trip, post))
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .fixedSize()
        } hint: {
            if let offer = captureOffer(trip, post, captured) {
                offerHint(offer)
            }
        }
    }

    private var dateBinding: Binding<IsoDate> {
        Binding(
            get: { model.post?.date ?? post.date },
            set: { next in model.updatePost { $0.date = next } }
        )
    }

    /// "The picture is dated 27 Mar 2025 (the camera’s own record)", its offer
    /// and, for a day outside the trip, why every count would be wrong.
    private func offerHint(_ offer: CaptureOffer) -> some View {
        let dated = Text(verbatim: "The picture is dated ")
            + Text(verbatim: offer.dateText).foregroundStyle(palette.ink)
            + Text(verbatim: " \(offer.sourceWords)")
        return VStack(alignment: .leading, spacing: 3) {
            dated
                .font(Brand.sans(11))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            if offer.elsewhere {
                Button("file it under that day") {
                    model.updatePost { $0.date = offer.date }
                }
                .buttonStyle(DevelopLinkButtonStyle())
            }
            if offer.outsideTrip {
                ContentHint(captureOutsideTripWords, tone: .danger)
            }
        }
    }

    // MARK: - a range

    private var throughRow: some View {
        ContentFieldRow("Through") {
            TripDateField(label: "Through", value: endBinding, min: post.date, max: nil)
            Button("One day") {
                model.updatePost { $0.endDate = nil }
                wantRange = false
            }
            .buttonStyle(DevelopLinkButtonStyle())
        }
    }

    private var endBinding: Binding<IsoDate> {
        Binding(
            get: { model.post?.endDate ?? "" },
            set: { next in model.updatePost { $0.endDate = next.isEmpty ? nil : next } }
        )
    }

    // MARK: - the picture's own date

    /// Which file the date is read from — a new one reads again.
    private var fileKey: String {
        guard let ref = model.leadRef else { return "" }
        return "\(ref.name)|\(ref.size)|\(ref.lastModified)"
    }

    /// Its head read off the main actor, once per file; the kernel answers
    /// with the rung that dated it. The last answer stays up while the next
    /// is read, as the web's does — a blink says nothing.
    private func readCaptured() async {
        guard let ref = model.leadRef, let url = model.url(for: ref) else {
            captured = nil
            return
        }
        let read = await Task.detached(priority: .utility) { () -> CaptureDate? in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            var head: Data?
            if let handle = try? FileHandle(forReadingFrom: url) {
                head = try? handle.read(upToCount: exifSliceBytes)
                try? handle.close()
            }
            return readCaptureDate(ref, head: head)
        }.value
        guard !Task.isCancelled else { return }
        captured = read
    }
}

#Preview("Day") {
    let model = PieceEditorFixtures.model()
    VStack(alignment: .leading) {
        if let trip = model.trip, let post = model.post {
            PieceDaySection(model: model, trip: trip, post: post)
        }
    }
    .frame(width: 360)
    .padding(16)
    .darkroom()
}
