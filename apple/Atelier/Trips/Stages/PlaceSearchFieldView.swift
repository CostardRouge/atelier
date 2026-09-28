// A place name, with an optional lookup behind it — the native twin of the
// web's `PlaceSearchField.tsx` + `use-place-search-pref.ts` + `searchPlaces`.
//
// The suite's SECOND network exception (`docs/memory/local-first.md`), and the
// first one that sends text the author typed, so its rules are the web's to
// the letter:
// - The text field IS the feature; the search is the convenience. It is never
//   disabled, whatever the preference says, and a place typed by hand is a
//   complete place.
// - OFF by default. The consent is a preference of this DEVICE (UserDefaults,
//   the web's `localStorage` key `atelier.roadtrip.placeSearch`), never a field
//   of the trip, and it is asked for — with what would leave — the first time
//   a search is wanted.
// - One deliberate gesture (Return, or the button) is ONE request; nothing is
//   sent as you type. A second search cancels the first, so answers cannot
//   arrive out of order, and leaving the field cancels what is in flight.
// - Only the query leaves: no cookie (an ephemeral session), no coordinate, no
//   picture, no trip.
//
// One thing the native client does better, on purpose: Nominatim's usage
// policy asks for an identifying User-Agent, which a browser cannot set. This
// one names the app.

import SwiftUI
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import AtelierKit

struct PlaceSearchFieldView: View {
    @Binding var value: String
    /// A candidate was chosen — the caller decides what to keep.
    let onPick: (PlaceResult) -> Void
    var placeholder: String = ""
    var label: String
    /// Focus the name on appearing — for a place the author has just added.
    var autoFocus = false

    @Environment(\.palette) private var palette
    @AppStorage(placeSearchPrefKey) private var consent = "off"
    @State private var results: [PlaceResult]?
    @State private var busy = false
    @State private var problem: String?
    @State private var asking = false
    @State private var search: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var enabled: Bool { consent == "on" }
    private var query: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                TextField(label, text: $value, prompt: Text(placeholder))
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(13))
                    .focused($focused)
                    .onSubmit(ask)
                    .submitLabel(.search)
                    .accessibilityLabel(label)
                Button(action: ask) {
                    Group {
                        if busy {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium))
                        }
                    }
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(palette.paper))
                    .overlay(Circle().strokeBorder(palette.lineStrong, lineWidth: 1))
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(palette.inkSoft)
                .disabled(busy || query.isEmpty)
                .accessibilityLabel(enabled ? "Look \(query.isEmpty ? "this place" : query) up" : "Look this place up online")
                .help(enabled ? "Look “\(query)” up" : "Look this place up online")
            }
            if asking && !enabled {
                consentBox
            }
            if let problem {
                Text(problem)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let results, !results.isEmpty {
                candidates(results)
            }
        }
        .onAppear { if autoFocus { focused = true } }
        .onDisappear {
            search?.cancel()
            search = nil
        }
    }

    /// What the author is told before anything can leave.
    private var consentBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(placeSearchNotice)
                .font(Brand.sans(12))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 14) {
                Button("Turn on and search") {
                    consent = "on"
                    asking = false
                    run()
                }
                .buttonStyle(StagesButtonStyle(kind: .primary, small: true))
                Button("Keep typing by hand") { asking = false }
                    .buttonStyle(.plain)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.paper))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
    }

    private func candidates(_ list: [PlaceResult]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(list.enumerated()), id: \.offset) { index, result in
                if index > 0 { Hairline() }
                Button {
                    choose(result)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(result.name)
                            .font(Brand.sans(13))
                            .foregroundStyle(palette.ink)
                        Text(placeResultLine(result))
                            .font(Brand.mono(10))
                            .foregroundStyle(palette.faint)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.paper))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
    }

    // MARK: - the one request

    private func ask() {
        guard !query.isEmpty else { return }
        if enabled { run() } else { asking = true }
    }

    private func run() {
        let asked = query
        guard !asked.isEmpty else { return }
        search?.cancel()
        busy = true
        problem = nil
        search = Task { @MainActor in
            do {
                let found = try await PlaceSearch.search(asked)
                if Task.isCancelled { return }
                results = found
                if found.isEmpty { problem = "Nothing found for “\(asked)”." }
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
                results = nil
                problem = (error as? LocalizedError)?.errorDescription ?? placeSearchOfflineMessage
            }
            busy = false
        }
    }

    private func choose(_ result: PlaceResult) {
        onPick(result)
        results = nil
        problem = nil
    }
}

/// The one request — the web's `searchPlaces`, a thin wrapper around the
/// kernel's URL and parser (`Map/Geocode.swift`).
enum PlaceSearch {
    /// No cookie jar, no cache on disk: nothing of this app rides along.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    /// What Nominatim's policy asks a caller to say about itself.
    private static var userAgent: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "0"
        let id = Bundle.main.bundleIdentifier ?? "website.steeve.atelier"
        return "Atelier/\(version) (\(id))"
    }

    struct Refused: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func search(_ query: String) async throws -> [PlaceResult] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let url = URL(string: nominatimUrl(query)) else { return [] }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.httpShouldHandleCookies = false
        let answer: (Data, URLResponse)
        do {
            answer = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            // The bare transport error tells a person nothing they can act on.
            throw Refused(message: placeSearchOfflineMessage)
        }
        let (data, response) = answer
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw Refused(message: placeSearchRefusal(http.statusCode))
        }
        return parsePlaceResults(JSONValue.parse(data))
    }
}

private struct PlaceSearchPreview: View {
    @State private var name = "Kalbarri"

    var body: some View {
        PlaceSearchFieldView(value: $name, onPick: { _ in }, placeholder: "Kalbarri", label: "Place 1")
            .padding(16)
            .frame(width: 360)
    }
}

#Preview("Place search") {
    PlaceSearchPreview()
}
