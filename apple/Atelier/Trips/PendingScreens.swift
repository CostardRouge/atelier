// PENDING SCREENS — the stand-ins the Trips shell pushes until the tasks that
// own them land, the way Develop's inspector was built (one block per task;
// that task DELETES ITS BLOCK and defines the real view under the SAME name
// and initialiser, the last one deletes the file). The initialisers are the
// CONTRACT the shell's `navigationDestination(for: TripsRoute.self)` calls.
// Everything here SAYS what is coming — never a blank.

import SwiftUI

// MARK: - the stand-ins' shared face

struct PendingTripsScreen: View {
    let title: String
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(Brand.sans(20, weight: .semibold)).foregroundStyle(palette.ink)
            Text(text).font(Brand.sans(14)).foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(palette.paper)
    }
}
