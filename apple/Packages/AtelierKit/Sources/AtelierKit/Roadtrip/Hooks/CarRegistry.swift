// The cars a trip may drive — one registry line per model, the way the tools
// and the hook variants are listed. Port of
// `src/shared/roadtrip/hooks/car-registry.ts`.
//
// One entry today: the Toyota Land Cruiser Prado of the J120 series, built by
// `CarModel.swift`. A second car is a second model file over `Mesh3D` and one
// line here; its parts must stay CONVEX, or the painter's ordering breaks
// (`RenderOrderTests` is the gate that says so).

import Foundation

public struct CarModel: Sendable {
    public var id: CarModelId
    /// The make and the model, as said on screen.
    public var name: String
    /// The series and its years.
    public var series: String
    /// The footprint in model units — the shadow and the scale on the map read it.
    public var length: Double
    public var width: Double
    public var wheelRadius: Double
    public var build: @Sendable (CarGear) -> [Mesh3D.Part]

    public init(id: CarModelId, name: String, series: String, length: Double, width: Double,
                wheelRadius: Double, build: @escaping @Sendable (CarGear) -> [Mesh3D.Part]) {
        self.id = id; self.name = name; self.series = series
        self.length = length; self.width = width; self.wheelRadius = wheelRadius; self.build = build
    }
}

/// The web's `CAR_MODELS`.
public let carModels: [CarModel] = [
    CarModel(
        id: .pradoJ120,
        name: "Toyota Land Cruiser Prado",
        series: "J120 · 2003–2009",
        length: carLength,
        width: carWidth,
        wheelRadius: wheelRadius,
        build: { buildCar($0) }
    ),
]

/// The model an id names — the Prado for one this build does not know.
public func carModel(_ id: String) -> CarModel {
    carModels.first { $0.id.rawValue == id } ?? carModels[0]
}

/// The model a known id names.
public func carModel(_ id: CarModelId) -> CarModel {
    carModel(id.rawValue)
}
