// Looking a place up by name, against OpenStreetMap's Nominatim — the pure half
// of `src/shared/map/geocode.ts` (the URL, the parsing, the sentences) and the
// consent key of `use-place-search-pref.ts`. The one request itself is the
// app's (`URLSession`), exactly as the web keeps `searchPlaces` a thin `fetch`
// around these.
//
// THE RULES THIS MODULE EXISTS TO ENFORCE — the suite's SECOND network
// exception, and the first one that sends text the author typed
// (`docs/memory/local-first.md`):
// - Opt-in and OFF by default: the consent is a preference of this DEVICE
//   (`placeSearchPrefKey`, UserDefaults on the app's side), never a field of a
//   trip — a `.roadtrip.json` must not mail someone else's consent along.
// - No search-as-you-type: one deliberate gesture (Return, or the button) is
//   one request, which honours Nominatim's one-a-second cap.
// - Only the query string ever leaves. No photograph, no coordinate already
//   held, no trip.
// - Everything it offers is optional: a place typed by hand, with no
//   coordinates, is a complete place.
//
// Pure.

import Foundation

/// One candidate a search came back with. The web's `PlaceResult`.
public struct PlaceResult: Equatable, Sendable {
    /// The place said out loud — "Kalbarri".
    public var name: String
    /// Where it sits — "Western Australia, Australia".
    public var region: String
    public var lat: Double
    public var lon: Double

    public init(name: String, region: String, lat: Double, lon: Double) {
        self.name = name; self.region = region; self.lat = lat; self.lon = lon
    }
}

/// The one service this module can address. The web's `NOMINATIM_SEARCH`.
public let nominatimSearchUrl = "https://nominatim.openstreetmap.org/search"

/// What a person is told when the service cannot be reached at all. The web's
/// `OFFLINE_MESSAGE`.
public let placeSearchOfflineMessage =
    "Could not reach the place search — you may be offline. Type the place by hand instead."

/// How many candidates one search asks for. The web's `PLACE_RESULT_LIMIT`.
public let placeResultLimit = 5

/// What the author is told before anything can leave. The web's
/// `PLACE_SEARCH_NOTICE`.
public let placeSearchNotice =
    "Searching sends the words you type to OpenStreetMap’s Nominatim service. "
    + "Nothing else leaves this machine — not your photos, not their positions, "
    + "not the trip. You can always type a place by hand instead."

/// Where the consent is kept on this device — the web's `localStorage` key,
/// holding `on` or `off`. Anything but `on` is "no".
public let placeSearchPrefKey = "atelier.roadtrip.placeSearch"

/// `application/x-www-form-urlencoded`, as `URLSearchParams` writes a value:
/// ASCII letters, digits and `*-._` stay, a space is `+`, every other byte of
/// the UTF-8 is `%XX` (upper-case hex).
private func formEncoded(_ value: String) -> String {
    var out = ""
    for byte in value.utf8 {
        switch byte {
        case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"),
             UInt8(ascii: "0")...UInt8(ascii: "9"),
             UInt8(ascii: "*"), UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"):
            out.append(Character(UnicodeScalar(byte)))
        case UInt8(ascii: " "):
            out.append("+")
        default:
            out += String(format: "%%%02X", byte)
        }
    }
    return out
}

/// The one URL this module can build, so a spec can assert exactly what would
/// leave the machine. `format=jsonv2` is the documented stable projection;
/// `addressdetails=0` asks for less than the default, since the display name
/// is all that is drawn. Never fewer than one result.
public func nominatimUrl(_ query: String, limit: Int = placeResultLimit) -> String {
    let params: [(String, String)] = [
        ("q", query.trimmingCharacters(in: .whitespacesAndNewlines)),
        ("format", "jsonv2"),
        ("addressdetails", "0"),
        ("limit", String(max(1, limit))),
    ]
    let query = params.map { "\($0.0)=\(formEncoded($0.1))" }.joined(separator: "&")
    return "\(nominatimSearchUrl)?\(query)"
}

/// A part that is a postcode — `/^\d[\d\s-]*$/`.
private func isPostcode(_ part: String) -> Bool {
    guard let first = part.unicodeScalars.first, CharacterSet.decimalDigits.contains(first), first.isASCII else {
        return false
    }
    return part.unicodeScalars.allSatisfy { s in
        (s.isASCII && CharacterSet.decimalDigits.contains(s)) || s == "-" || CharacterSet.whitespaces.contains(s)
    }
}

/// "Kalbarri, Shire of Northampton, Western Australia, 6536, Australia" →
/// "Western Australia, Australia". The head is the place itself, postcodes are
/// noise on a badge, and the two outermost administrative levels are what a
/// reader actually wants under a place name.
public func regionFromDisplayName(_ displayName: String) -> String {
    let parts = displayName
        .split(separator: ",", omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty && !isPostcode($0) }
    return Array(parts.dropFirst().suffix(2)).joined(separator: ", ")
}

/// `typeof value === 'number' ? value : Number(value)`, finite or nil.
private func placeNumber(_ value: JSONValue?) -> Double? {
    let n = JSLoose.number(value)
    return n.isFinite ? n : nil
}

/// Nominatim's answer → the candidates that can be used. It never throws and
/// drops any row it cannot fully trust: a malformed response costs a result,
/// never the panel it is in. Unlike a DJI track, `0, 0` is NOT refused here —
/// there it means no fix, here it is a genuine point in the Gulf of Guinea.
public func parsePlaceResults(_ json: JSONValue?) -> [PlaceResult] {
    guard let rows = json?.arrayValue else { return [] }
    var out: [PlaceResult] = []
    for row in rows {
        guard let r = row.objectValue else { continue }
        guard let lat = placeNumber(r["lat"]), let lon = placeNumber(r["lon"]) else { continue }
        if abs(lat) > 90 || abs(lon) > 180 { continue }
        let display = r["display_name"]?.stringValue ?? ""
        let head = (r["name"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let fromDisplay = display.split(separator: ",", omittingEmptySubsequences: false).first
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
        let name = head.isEmpty ? fromDisplay : head
        if name.isEmpty { continue }
        out.append(PlaceResult(name: name, region: regionFromDisplayName(display), lat: lat, lon: lon))
    }
    return out
}

/// What a refusal says — 429 is the one a polite caller still meets, the
/// service being shared. The web's `searchPlaces` error sentences.
public func placeSearchRefusal(_ status: Int) -> String {
    status == 429
        ? "The place search is rate-limited right now — wait a moment, or type the place by hand."
        : "The place search answered \(status). You can type the place by hand instead."
}

/// A candidate's second line: its region and its coordinates to four places.
public func placeResultLine(_ result: PlaceResult) -> String {
    let coords = "\(ExifText.toFixed(result.lat, 4)), \(ExifText.toFixed(result.lon, 4))"
    return [result.region, coords].filter { !$0.isEmpty }.joined(separator: " · ")
}
