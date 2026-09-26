// Naming a place from its coordinates, offline — the last step of the
// itinerary deduction, and the one that decides whether its proposals can be
// read at all. A leg that comes out as "2025-11-02 → 2025-11-05" is a row
// nobody can accept or refuse; "Kalbarri" is. Port of
// `src/shared/roadtrip/gazetteer.ts`.
//
// **It is an index that ships with the app, never a lookup going out.**
// Reverse-geocoding a deduced leg would send the coordinates of someone's
// photographs, a larger claim on their data than a name is worth, so the
// answer comes from the committed file (`public/geo/cities.json`, GeoNames
// CC BY 4.0 — the attribution rides inside it; do not strip it). READING that
// file is the app's (the web's `load-gazetteer.ts`); this module is the pure
// half: validate the rows, then search them.
//
// **No answer is a real answer.** Past `maxKm` this returns nil, and the leg
// keeps a span and no place — the anti-fabrication line the whole tool holds.

import Foundation

public struct GazetteerCity: GeoLocated, Equatable, Sendable {
    /// The place as GeoNames says it out loud ("Kalbarri").
    public var name: String
    /// ISO 3166-1 alpha-2, to tell two places of one name apart.
    public var country: String
    public var lat: Double
    public var lon: Double
    public var population: Double
    /// A district or suburb (GeoNames `PPLX`) rather than a place in its own
    /// right — named only when nothing else is near.
    public var section: Bool

    public init(name: String, country: String, lat: Double, lon: Double, population: Double, section: Bool) {
        self.name = name; self.country = country; self.lat = lat; self.lon = lon
        self.population = population; self.section = section
    }
}

/// Two cities this close to each other are, for naming purposes, the same
/// answer — so something other than distance has to decide. Without it a leg
/// sitting between a town and its suburb is named after whichever is a
/// kilometre nearer, which is not the name a person would have written.
/// Measured against the real index (Perth / Northbridge, Broome / Cable
/// Beach): neither distance nor population alone is enough, and the contest
/// in `nearestCity` is what gets both right. The web's `TIE_KM`.
public let gazetteerTieKm = 5.0

/// How far a leg may be from a city and still be called by its name. The
/// web's `DEFAULT_MAX_KM`.
public let gazetteerDefaultMaxKm = 90.0

/// The committed file, validated — `{ attribution, count, cities: [[name,
/// country, lat, lon, population, section], …] }`. Rows it cannot read are
/// dropped rather than failing the whole index: a gazetteer that refuses to
/// load takes the naming of every leg with it, while a dropped row costs one
/// name.
public func parseGazetteer(_ raw: JSONValue?) -> [GazetteerCity] {
    guard let rows = raw?.objectValue?["cities"]?.arrayValue else { return [] }

    var cities: [GazetteerCity] = []
    cities.reserveCapacity(rows.count)
    for row in rows {
        guard let cells = row.arrayValue else { continue }
        func cell(_ i: Int) -> JSONValue? { i < cells.count ? cells[i] : nil }
        guard let name = cell(0)?.stringValue, !name.isEmpty else { continue }
        guard let lat = cell(2)?.finiteNumber, let lon = cell(3)?.finiteNumber else { continue }
        if lat < -90 || lat > 90 || lon < -180 || lon > 180 { continue }
        let population = cell(4)?.finiteNumber.flatMap { $0 > 0 ? $0 : nil } ?? 0
        let section = cell(5) == .number(1) || cell(5) == .bool(true)
        cities.append(GazetteerCity(name: name, country: cell(1)?.stringValue ?? "", lat: lat, lon: lon,
                                    population: population, section: section))
    }
    return cities
}

/// Degrees of longitude between two meridians, the short way round.
private func lonGap(_ a: Double, _ b: Double) -> Double {
    let gap = abs(a - b).truncatingRemainder(dividingBy: 360)
    return gap > 180 ? 360 - gap : gap
}

private let kmPerDegree = 111.32

/// The nearest city to `point`, or nil when none is within `maxKm`.
///
/// A bounding box in degrees rejects almost every row before any trigonometry:
/// the index is 135 000 cities and a trip asks about thirty legs. The box is
/// deliberately generous — it only has to be a superset, and `haversineKm`
/// settles what is actually inside.
public func nearestCity<P: GeoLocated>(_ cities: [GazetteerCity], _ point: P,
                                       maxKm: Double = gazetteerDefaultMaxKm) -> GazetteerCity? {
    let latWindow = maxKm / kmPerDegree
    // Near a pole, and for a window that spans the globe, the longitude filter
    // stops meaning anything — drop it rather than compute a wrong bound.
    let cosLat = cos(point.lat * Double.pi / 180)
    let lonWindow = cosLat > 0.02 ? maxKm / (kmPerDegree * cosLat) : 181

    var near: [(city: GazetteerCity, km: Double)] = []
    var bestKm = Double.infinity

    for city in cities {
        if abs(city.lat - point.lat) > latWindow { continue }
        if lonWindow <= 180 && lonGap(city.lon, point.lon) > lonWindow { continue }
        let km = haversineKm(point, city)
        if km > maxKm { continue }
        near.append((city, km))
        if km < bestKm { bestKm = km }
    }

    // Two passes, so the answer cannot depend on the order the rows arrived in:
    // the nearest sets the bar, then everything within `gazetteerTieKm` of it
    // competes. The contest, in order: a place beats a SECTION of a place,
    // then the bigger population, then the nearer, then the name — so the
    // answer is total.
    let tied = near.filter { $0.km <= bestKm + gazetteerTieKm }
    guard var best = tied.first else { return nil }
    for candidate in tied.dropFirst() {
        if candidate.city.section != best.city.section {
            if !candidate.city.section { best = candidate }
        } else if candidate.city.population != best.city.population {
            if candidate.city.population > best.city.population { best = candidate }
        } else if candidate.km != best.km {
            if candidate.km < best.km { best = candidate }
        } else if gazetteerNameBefore(candidate.city.name, best.city.name) {
            best = candidate
        }
    }
    return best.city
}

/// JavaScript's `<` on two strings: UTF-16 code units, never a locale — so an
/// accented name sorts the same on both clients.
private func gazetteerNameBefore(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
}

// MARK: - The EXIF side's reading

/// A delivered picture's GPS is a point the gazetteer can answer about
/// (`Exif/DeliveryPlace.swift` names the place a file is written with).
extension GpsCoord: GeoLocated {}

/// The web's two constants under one name, as `DeliveryPlace.swift` reads
/// them — the same values as `gazetteerTieKm` / `gazetteerDefaultMaxKm`.
public enum Gazetteer {
    public static let tieKm = gazetteerTieKm
    public static let defaultMaxKm = gazetteerDefaultMaxKm
}
