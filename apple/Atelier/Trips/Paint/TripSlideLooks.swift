// Which look each picture of a piece is painted through — the render half of
// the web's `use-trip-grade.ts` (`lutFor`, `filmFor`) and `use-grade-cubes.ts`:
// the grade a picture WEARS (its own, else the piece's, else the trip's —
// `gradeShownBy`, the kernel's chain) baked with THAT picture's develop into
// ONE cube, and the film texture of the same rung.
//
// Rules kept (`roadtrip.md`, «A look is written on one of THREE rungs»):
// - The closing card is drawn, not photographed: it is never graded.
// - A collage's cells share the slide's grade, each baked with ITS develop.
// - A look this device cannot resolve (a pack look the vault does not hold,
//   a built-in this build lacks) stays in the stack and is SAID
//   (`missingWords`), never graded as nothing in silence — the render plan's
//   own resolver (`DevelopLooks`), so the Develop stage and a Trips export
//   read the same vault.
// - Every distinct grade the deck wears is resolved ahead of a render
//   (`prepare`): a pack lattice is read from the vault asynchronously, and a
//   paint is synchronous.
// - A cube is baked once per grade × develop × interpolation and kept; the
//   key it is kept under is also the key a `BadgeSource` holds its graded
//   picture under, so a redraw costs neither a bake nor a render.

import AtelierKit
import Foundation

final class TripSlideLooks: @unchecked Sendable {
    let looks: DevelopLooks
    /// How a lattice is read between its points — the device's preference.
    let interpolation: Interpolation

    private let lock = NSLock()
    private var cubes: [String: CubeLut?] = [:]
    private var order: [String] = []
    /// Composed cubes kept: a 33³ bake is ~430 KB, a 65³ pack look ~3 MB.
    private static let kept = 24

    init(looks: DevelopLooks = .shared, interpolation: Interpolation = .tetrahedral) {
        self.looks = looks
        self.interpolation = interpolation
    }

    /// A trip's look as the render plan's resolver takes it.
    static func rollGrade(_ grade: TripGrade) -> RollGrade {
        RollGrade(layers: grade.layers, output: grade.output, film: grade.film?.json)
    }

    /// Every distinct grade `post` wears — the trip's, the piece's, the hook's
    /// own and every slide's own.
    static func gradesWorn(_ trip: TripDoc, _ post: TripPost) -> [TripGrade] {
        var all: [TripGrade] = [trip.grade]
        if let g = post.grade { all.append(g) }
        if let g = post.badge.grade { all.append(g) }
        for slide in post.slides { if let g = slide.grade { all.append(g) } }
        var seen: Set<String> = []
        return all.filter { seen.insert(gradeKey($0)).inserted }
    }

    /// Resolve every pack look the piece wears, ahead of a render.
    func prepare(_ trip: TripDoc, _ post: TripPost) async {
        for grade in TripSlideLooks.gradesWorn(trip, post) {
            await looks.prepare(TripSlideLooks.rollGrade(grade))
        }
    }

    /// The grade one picture wears, or nil for the closing card.
    func grade<P: GradedPicture>(_ picture: P, _ trip: TripDoc, _ post: TripPost) -> TripGrade? {
        if picture.kind == .cta { return nil }
        return gradeShownBy(trip, post, pictureKeyOf(picture))
    }

    /// The key a picture's cube is kept under: its grade, its develop, the
    /// interpolation. Nil for a picture nothing grades.
    func key<P: GradedPicture>(_ picture: P, _ trip: TripDoc, _ post: TripPost,
                               develop: DevelopSettings??  = .none) -> String? {
        guard let grade = self.grade(picture, trip, post) else { return nil }
        let dev: DevelopSettings? = develop ?? picture.develop
        let developKey = dev.map { $0.json.serialized() } ?? "as-shot"
        return "\(gradeKey(grade))|\(developKey)|\(interpolation.rawValue)"
    }

    /// The cube one picture is rendered through — its grade baked with its
    /// develop (`develop` overrides the picture's own, for a collage's cell).
    /// Nil when nothing would change a pixel, and for the closing card.
    func cube<P: GradedPicture>(_ picture: P, _ trip: TripDoc, _ post: TripPost,
                                develop: DevelopSettings?? = .none) -> CubeLut? {
        guard let grade = self.grade(picture, trip, post),
              let key = self.key(picture, trip, post, develop: develop) else { return nil }
        lock.lock()
        if let hit = cubes[key] {
            lock.unlock()
            return hit
        }
        lock.unlock()
        let dev: DevelopSettings? = develop ?? picture.develop
        let look = looks.resolve(TripSlideLooks.rollGrade(grade))
        let baked = composeLutStack(look.layers, output: look.output, interpolation: interpolation, develop: dev)
        lock.lock()
        cubes[key] = .some(baked)
        order.append(key)
        if order.count > TripSlideLooks.kept {
            let drop = order.removeFirst()
            cubes[drop] = nil
        }
        lock.unlock()
        return baked
    }

    /// The film TEXTURE one picture wears — the twin of `cube`, down to the
    /// rung; nil for the closing card and for a grade with none.
    func film<P: GradedPicture>(_ picture: P, _ trip: TripDoc, _ post: TripPost) -> FilmTexture? {
        grade(picture, trip, post)?.film
    }

    /// What of a picture's look does not grade on this device, in words.
    func missingWords<P: GradedPicture>(_ picture: P, _ trip: TripDoc, _ post: TripPost) -> [String] {
        guard let grade = self.grade(picture, trip, post) else { return [] }
        return looks.missingWords(TripSlideLooks.rollGrade(grade))
    }

    /// A grader the caller owns for one picture: its cube and its film node,
    /// or nil when neither would change a pixel. `key` is what a
    /// `BadgeSource` holds the graded picture under.
    func grader<P: GradedPicture>(_ picture: P, _ trip: TripDoc, _ post: TripPost,
                                  develop: DevelopSettings?? = .none) -> (grader: FrameGrader, key: String)? {
        let baked = self.cube(picture, trip, post, develop: develop)
        let node = FilmPass(self.film(picture, trip, post))
        guard baked != nil || node != nil, let base = self.key(picture, trip, post, develop: develop) else { return nil }
        let filmKey = node.map { $0.texture.json.serialized() } ?? "no-film"
        let made = FrameGrader(lut: baked, interpolation: interpolation, film: node)
        return (made, "\(base)|\(filmKey)")
    }
}
