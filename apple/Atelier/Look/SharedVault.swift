// The ONE vault of purchased and uploaded looks on this device, held outside
// any actor so both of its readers take the same one: the look pickers
// (`LookLibrary`, on the main actor) and the render plan
// (`DevelopLooks`, read from the render's own thread). Two vaults over one
// folder would each keep their own cache and their own listeners — a pack
// imported in the gallery would not reach the stage until a restart.
//
// The store is `FilePackStore` (`Application Support/Atelier/looks/`); the
// instances that can keep a pack are a snapshot `LookLibrary` refreshes from
// the connections.

import AtelierKit

enum SharedVault {
    /// The instances that can keep a pack, as the connections last stood.
    static let hosts = PackHostBox()
    /// The vault itself — the kernel's actor over this device's store.
    static let vault = PackVault(store: FilePackStore(), hosts: { hosts.get() })
}
