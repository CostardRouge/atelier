// «Situer cette photo» — where one picture was taken, and the ONE thing the
// trip could do about it. The native twin of the web's `LocatePicturePanel.tsx`
// and of the read `TripOverview.tsx` runs before it (`readCapture` +
// `gazetteerOrEmpty` + `locatePicture`).
//
// Rules kept (`roadtrip.md`, «Situer cette photo»):
// - It reads the picture's OWN EXIF, on this device — the file's head, else
//   what a source vouched for it with — and names the point from the city
//   index that ships with the app. Nothing is sent anywhere.
// - It SAYS what it measured before it proposes: the day and where the day
//   came from (the camera's record, an instance's, or the file's date — a weak
//   guess), the coordinates, the nearest city and how far.
// - It PROPOSES one edit to the leg of the picture's own day, or says why
//   nothing is offered (no position, 0/0, no date, outside the trip, nothing
//   near enough, already named) — never applied on its own.
// - Accepting writes through the stage editors that already exist (the
//   proposal's own `apply`), then the host goes to that day with the touched
//   leg open: a change nobody can see is a change nobody can check.
// - A clip is refused with the reason: its flight log is not read here.
//
// Exposed for the overview and the Library to open later:
// `LocatePictureSheet(store:tripId:fileURL:onDone:)`.

import SwiftUI
import AtelierKit

/// Where accepting took the trip: the day the picture measured, and the leg
/// the edit touched — for the host to go to and open.
struct LocatedLeg: Equatable {
    var day: IsoDate?
    var stageId: String
}

struct LocatePictureSheet: View {
    let store: TripsStore
    let tripId: String
    let fileURL: URL
    /// Nil when closed without accepting.
    let onDone: (LocatedLeg?) -> Void

    @Environment(\.palette) private var palette
    @State private var reading: LocateRead?

    var body: some View {
        let proposal = reading?.location?.proposal
        StagesSheetFrame(
            title: "Locate this picture",
            lede: "\(fileURL.lastPathComponent) — read on this device, named from the city index that ships with the app. Nothing is sent anywhere, and nothing changes until you accept.",
            cancelTitle: proposal == nil ? "Close" : "Cancel",
            onCancel: { onDone(nil) }
        ) {
            content
        } verb: {
            if let proposal {
                Button("Accept") { accept(proposal) }
                    .buttonStyle(StagesButtonStyle(kind: .primary))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .task(id: fileURL) { await read() }
    }

    @ViewBuilder
    private var content: some View {
        if let problem = reading?.problem {
            muted(problem)
        } else if let reading, let location = reading.location, let trip = store.trip(tripId) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("What the picture says")
                measuredLine(reading.capture.map { formatIsoDate($0.date) } ?? "no date",
                             reading.capture.map(captureDayWords) ?? "nothing dates it")
                measuredLine(reading.coords.map(formatCoords) ?? "no position",
                             locateCityLine(location))
            }
            if let proposal = location.proposal {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("What accepting would do")
                    Text(proposal.label)
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(proposal.detail)
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                muted(locateSilenceWords(trip, location))
            }
        } else {
            Text("reading the picture…")
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
        }
    }

    private func measuredLine(_ value: String, _ aside: String?) -> some View {
        let head = Text(value).foregroundStyle(palette.ink)
        let tail = aside.map { Text(" · \($0)").foregroundStyle(palette.muted) } ?? Text("")
        return (head + tail)
            .font(Brand.mono(12))
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private func muted(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(14))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - reading, on this device

    private func read() async {
        reading = nil
        let url = fileURL
        let name = url.lastPathComponent
        if classifyPart(name) == .video {
            reading = LocateRead(problem: "Only a photograph carries a position of its own — a clip’s flight log is not read here.")
            return
        }
        // One read of the file's head answers both questions; the index is
        // read only now, never at launch.
        let read = await Task.detached(priority: .userInitiated) { () -> (Capture, [GazetteerCity]) in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let ref = RollStore.mediaRef(of: url)
            var head: Data?
            if let handle = try? FileHandle(forReadingFrom: url) {
                head = try? handle.read(upToCount: exifSliceBytes)
                try? handle.close()
            }
            let capture = readCapture(ref, head: head)
            return (capture, PlaceIndex.cities ?? [])
        }.value
        guard !Task.isCancelled, let trip = store.trip(tripId) else { return }
        let capture = read.0
        let location = locatePicture(LocateInput(trip: trip, date: capture.date?.date, coords: capture.coords,
                                                 cities: read.1))
        reading = LocateRead(capture: capture.date, coords: capture.coords, location: location)
    }

    private func accept(_ proposal: LocateProposal) {
        guard let trip = store.trip(tripId) else { return }
        let result = proposal.apply(trip)
        StagesEdit.write(store, tripId, result.stages)
        store.sealHistory()
        onDone(LocatedLeg(day: reading?.location?.date, stageId: result.selectedId))
    }
}

/// What the picture said, once read.
private struct LocateRead {
    var capture: CaptureDate?
    var coords: GeoPoint?
    var location: PictureLocation?
    /// Why there is nothing to read at all.
    var problem: String?

    init(capture: CaptureDate? = nil, coords: GeoPoint? = nil, location: PictureLocation? = nil, problem: String? = nil) {
        self.capture = capture; self.coords = coords; self.location = location; self.problem = problem
    }
}

#Preview("Locate") {
    StagesPreviewHost { store, _ in
        LocatePictureSheet(store: store, tripId: StagesFixtures.trip.id,
                           fileURL: URL(fileURLWithPath: "/tmp/DJI_0101.JPG"), onDone: { _ in })
    }
}
