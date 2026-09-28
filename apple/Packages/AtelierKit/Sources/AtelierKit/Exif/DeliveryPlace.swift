// The PLACE a delivered picture was taken, named offline from its own GPS —
// port of `src/shared/exif/delivery-place.ts` (`docs/lightroom-gaps.md` §9,
// M4): written as XMP `photoshop:City`, `photoshop:Country` and
// `Iptc4xmpCore:CountryCode`, the fields every photo library searches by.
//
// The rules it keeps from the web module:
// - **Offline, like every place name in the suite**: the answer comes from the
//   committed GeoNames index (`Roadtrip/Gazetteer.swift`), never a
//   reverse-geocoding service, which would send the photographs'
//   coordinates out.
// - **A place is its own group, apart from the position**: *Share online*
//   drops the coordinates and keeps the town.
// - **A city only where one is near**: farther than `placeMaxKm` (30 km) from
//   any named place, no city — the index's own 90 km reach is right for a leg
//   of a trip and wrong for captioning ONE picture. The COUNTRY still comes
//   from the nearest town within those 90 km; past them, nothing at all.
// - A country's English name comes from its ISO code — the web asks
//   `Intl.DisplayNames`, this asks Foundation's `Locale` (ICU, the same CLDR
//   data; a CLDR release apart, a name can differ, e.g. "Turkey" against a
//   newer browser's "Türkiye"). A code the runtime cannot name comes back as
//   the code itself.

import Foundation

/// How far a picture may be from a named place and still be captioned with it.
public let placeMaxKm: Double = 30

public struct DeliveryPlace: Equatable, Sendable {
    /// The town, or "" when none is within `placeMaxKm` and only the country is known.
    public var city: String
    /// The country's English name, from its ISO code.
    public var country: String
    /// ISO 3166-1 alpha-2, as IPTC stores it.
    public var countryCode: String

    public init(city: String, country: String, countryCode: String) {
        self.city = city; self.country = country; self.countryCode = countryCode
    }
}

private let englishRegions = Locale(identifier: "en")

/// A country's English name from its ISO code — the code itself where the runtime cannot say.
public func countryName(_ code: String) -> String {
    let upper = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if upper.isEmpty { return "" }
    return englishRegions.localizedString(forRegionCode: upper) ?? upper
}

/// Where `gps` was, by the index — a town and its country, the country alone,
/// or nil when nothing is near.
public func placeFor(_ cities: [GazetteerCity], _ gps: GpsCoord?, maxKm: Double = placeMaxKm) -> DeliveryPlace? {
    guard let gps, gps.lat.isFinite, gps.lon.isFinite, !cities.isEmpty else { return nil }
    let city = nearestCity(cities, gps, maxKm: maxKm)
    let found = city ?? nearestCity(cities, gps, maxKm: Gazetteer.defaultMaxKm)
    let countryCode = found?.country.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
    guard found != nil, city != nil || !countryCode.isEmpty else { return nil }
    return DeliveryPlace(city: city?.name ?? "", country: countryName(countryCode), countryCode: countryCode)
}
