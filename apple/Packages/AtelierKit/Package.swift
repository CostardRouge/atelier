// swift-tools-version: 5.9
//
// AtelierKit — the suite's KERNEL, ported from `src/shared/` module by module,
// each with its TypeScript twin's specs. Pure Swift, no Apple framework: it
// builds and tests on Linux, which is where this project is written, and the
// app (`apple/Atelier/`) is one consumer of it beside the tests.
//
// The rule that shapes every file: a stored document must keep MEANING what it
// meant. A develop, a curve, a cube composed here must land on the same numbers
// the web app lands on — the specs pin the bit-identical cases, and where a
// port would drift by an ulp the test says so before a picture does.
import PackageDescription

let package = Package(
    name: "AtelierKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AtelierKit", targets: ["AtelierKit"]),
    ],
    targets: [
        .target(
            name: "AtelierKit",
            path: "Sources/AtelierKit"
        ),
        .testTarget(
            name: "AtelierKitTests",
            dependencies: ["AtelierKit"],
            path: "Tests/AtelierKitTests"
        ),
    ]
)
