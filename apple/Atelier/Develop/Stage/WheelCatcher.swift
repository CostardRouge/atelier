// The Mac's scroll wheel and trackpad scroll, read by the kernel's ONE
// reading of the hand (`ZoomGestureMachine`, `frontend.md` «Two uses, one
// hand») — SwiftUI hands a view no wheel event on macOS 14. A transparent
// view over the stage claims ONLY scroll-wheel events in its hit test, so
// every click, drag and hover still reaches the SwiftUI stage under it; the
// trackpad's pinch stays SwiftUI's `MagnifyGesture`.
//
// Grammar, the web's: ⌘/ctrl-wheel zooms about the pointer, a bare vertical
// wheel zooms too (`.any` — a viewer has nothing else to do with it), a
// shift-wheel or a sideways sweep pans.

#if os(macOS)
import AppKit
import SwiftUI
import AtelierKit

struct WheelCatcher: NSViewRepresentable {
    let target: LookingZoom
    /// False leaves the wheel to the page — no picture, or a tool has the pointer.
    var enabled = true

    func makeCoordinator() -> Coordinator {
        Coordinator(machine: ZoomGestureMachine(target: target, options: ZoomGestureOptions(wheel: .any)))
    }

    func makeNSView(context: Context) -> WheelView {
        let view = WheelView()
        view.machine = context.coordinator.machine
        view.enabled = enabled
        return view
    }

    func updateNSView(_ view: WheelView, context: Context) {
        view.enabled = enabled
    }

    final class Coordinator {
        let machine: ZoomGestureMachine
        init(machine: ZoomGestureMachine) { self.machine = machine }
    }

    final class WheelView: NSView {
        var machine: ZoomGestureMachine?
        var enabled = true

        override var isFlipped: Bool { true }

        /// Only a wheel event lands here; every other event falls through to
        /// the SwiftUI stage underneath.
        override func hitTest(_ point: NSPoint) -> NSView? {
            guard enabled, NSApp.currentEvent?.type == .scrollWheel else { return nil }
            return super.hitTest(point)
        }

        override func scrollWheel(with event: NSEvent) {
            guard enabled, let machine else {
                super.scrollWheel(with: event)
                return
            }
            let at = convert(event.locationInWindow, from: nil)
            // A line-based wheel (a mouse) is in lines; the web reads pixels.
            let scale: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 16
            let flags = event.modifierFlags
            let wheel = GestureWheel(
                x: Double(at.x), y: Double(at.y),
                deltaX: Double(-event.scrollingDeltaX * scale), deltaY: Double(-event.scrollingDeltaY * scale),
                ctrlKey: flags.contains(.control), metaKey: flags.contains(.command), shiftKey: flags.contains(.shift)
            )
            if !machine.onWheel(wheel) { super.scrollWheel(with: event) }
        }
    }
}
#endif
