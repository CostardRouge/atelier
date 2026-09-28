// The app's WidgetKit extension (`Atelier-Widgets` in `project.yml`, embedded
// in the iOS app): today it holds ONE thing, the Live Activity an export shows
// while it runs in the background (`ExportActivityWidget`). It links neither
// the kernel nor the app; what it draws arrives as `ExportActivityAttributes`
// (`apple/Shared/ExportActivity.swift`), compiled into both.

import SwiftUI
import WidgetKit

@main
struct AtelierWidgetBundle: WidgetBundle {
    var body: some Widget {
        ExportActivityWidget()
    }
}
