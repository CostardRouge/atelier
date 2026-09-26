// Where you are in Trips — the web's hash route (`#/roadtrip/<trip>/<day>/<piece>`)
// as a NavigationStack path. The day rides along so Back lands on the day you
// were on, and a day is addressable, as on the web (`roadtrip.md`, «Road Trip
// addresses everything in the hash»). The `roadtrip` slug stays the web's
// everywhere it is written down; the screen says Trips.

import Foundation

enum TripsRoute: Hashable {
    /// A trip's overview, on `day` (`YYYY-MM-DD`) when one is open.
    case trip(id: String, day: String?)
    /// A piece of a trip, opened from `day`.
    case piece(tripId: String, day: String?, postId: String)
}
