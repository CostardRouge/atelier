// What the open roll does with its instance, laid on the workbench as ONE
// modifier (the workbench's own chain is long enough): the roll's fetch
// follows the open picture (`fetchNear`, re-asked when the open picture, the
// refs or the connections move), Winnow's culling is asked when the refs
// change and again when the app comes back to the foreground after a minute
// (the web's return to the tab), the day sheet is presented, the roll
// publishes the day it is on for the Library's instance tab, the looks' vault
// reads the connections again (a pack look is fetched from its instance), and
// the preset book's instance is asked whether it moved.

import SwiftUI
import AtelierKit

struct RollWinnowSurface: ViewModifier {
    @Bindable var editor: RollEditor
    @Binding var pickingDay: Bool
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $pickingDay) {
                // Picked FROM, so a sheet (`frontend.md`); the connections handed
                // on as the shell's Library sheet hands them.
                daySheet.environment(ConnectionStore.shared)
            }
            .onChange(of: editor.fetchKey, initial: true) { _, _ in editor.fetchNear() }
            .onChange(of: editor.cullKey, initial: true) { _, _ in
                Task { await editor.askCulling(maxAge: cullFreshMs) }
            }
            .onChange(of: scenePhase) { _, phase in
                // Back from Winnow: ask again what is older than a minute.
                if phase == .active { Task { await editor.askCulling(maxAge: cullFreshMs) } }
            }
            .publishMediaScope(editor.mediaScope)
            .task {
                // The vault reads the connections again, so a pack look this
                // device lacks is fetched from the instance it is kept on;
                // the preset book's instance is asked on the first look at it.
                LookLibrary.shared.refreshHosts()
                await editor.presets.resume()
            }
    }

    /// The sheet opens on the open picture's day, else the last picture's.
    private var daySheet: some View {
        let lastModified = editor.picture?.ref.lastModified ?? editor.pictures.last?.ref.lastModified ?? 0
        return WinnowDaySheet(initialDay: pictureDay(lastModified), held: editor.pictures.map(\.ref),
                              onCancel: { pickingDay = false }) { refs, host in
            pickingDay = false
            editor.addDay(refs, from: host)
        }
    }
}
