// The connect form under the sources list — the web's form at the foot of
// `SourcesScreen.tsx`, plus the one field a native client needs and a browser
// on the instance's own site does not: the TOKEN. The app is a foreign client
// (`docs/winnow-bridge.md` §3.3): no same-site cookie reaches it, so what
// proves who is asking is a personal token made on the instance and pasted
// here — kept in this device's Keychain, and the form says so (§3.6 asks that
// wherever a token is kept, the screen SAYS where).
//
// The address is validated as it is typed (`ConnectDraft` → the kernel's
// `normalizeBaseUrl`); Allow makes ONE request, `/api/capabilities`, and
// nothing is stored unless it answers. A 401 is the instance refusing the
// token, said as that with a way to the instance to make another.

import SwiftUI
import AtelierKit

struct ConnectView: View {
    @Environment(ConnectionStore.self) private var store
    @Environment(\.palette) private var palette

    @Binding var address: String
    /// Bumped by a row's Reconnect: the token field takes the focus.
    var tokenFocus: Int = 0
    var onConnected: () -> Void = {}

    @State private var token = ""
    @State private var busy = false
    @State private var error: String?
    @State private var refusedLogin: String?
    @FocusState private var focused: Field?

    private enum Field { case address, token }

    var body: some View {
        let draft = ConnectDraft(address: address)
        let already = draft.sourceId.flatMap { store.connection($0) }
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(store.connections.isEmpty ? "Connect a Winnow" : "Connect another")

            addressField
            addressHint(draft, already: already)

            SecureField("Token", text: $token)
                .font(Brand.mono(16))
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .focused($focused, equals: .token)
                .onSubmit { allow(draft) }
                .fieldBox(palette)
            Text(tokenHint(draft))
                .font(Brand.sans(12))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    allowButton(draft, already: already)
                    oneRequest
                }
                VStack(alignment: .leading, spacing: 8) {
                    allowButton(draft, already: already)
                    oneRequest
                }
            }

            if let refusedLogin {
                refused(refusedLogin, host: draft.sourceId)
            }
            if let error {
                Text(error)
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .overlay(
            RoundedRectangle(cornerRadius: Brand.paperRadius + 4)
                .strokeBorder(palette.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
        .onChange(of: tokenFocus) { _, _ in
            token = ""
            refusedLogin = nil
            error = nil
            focused = .token
        }
    }

    private var addressField: some View {
        TextField("https://winnow.example", text: $address)
            .font(Brand.mono(16))
            .autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
            .textContentType(.URL)
            #endif
            .focused($focused, equals: .address)
            .onSubmit { focused = .token }
            .fieldBox(palette)
    }

    @ViewBuilder
    private func addressHint(_ draft: ConnectDraft, already: WinnowConnection?) -> some View {
        if let problem = draft.problem {
            Text(problem)
                .font(Brand.sans(12))
                .foregroundStyle(palette.danger)
        } else if let id = draft.sourceId {
            Text("Will be listed as source “\(id)”." + (already != nil ? " Already connected — allowing again refreshes what it can do." : ""))
                .font(Brand.sans(12))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text("An instance becomes a source: its pictures and clips browsed by day, beside your own files — and, when it offers the document bucket, your rolls, trips and projects kept there.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func tokenHint(_ draft: ConnectDraft) -> String {
        let kept = "Made on the instance, for this device. It is kept in this device’s Keychain — never in a document or a file — and sent only to the address above."
        if draft.baseUrl != nil && token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Without a token, only an instance that asks nobody to sign in will answer. " + kept
        }
        return kept
    }

    private func allowButton(_ draft: ConnectDraft, already: WinnowConnection?) -> some View {
        Button(busy ? "Asking…" : already != nil ? "Allow again" : "Allow") { allow(draft) }
            .buttonStyle(SourceButtonStyle(kind: .solid))
            .disabled(draft.baseUrl == nil || busy)
            .keyboardShortcut(.defaultAction)
    }

    private var oneRequest: some View {
        (Text("One request is made — ") + Text("/api/capabilities").font(Brand.mono(12))
            + Text(" — and nothing is stored unless it answers."))
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func refused(_ login: String, host: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("That Winnow did not accept this token. Make a new one there, for this device, then allow again.")
                .fixedSize(horizontal: false, vertical: true)
            if let url = URL(string: login) {
                Link(destination: url) {
                    Text("Open \(host ?? "the instance")")
                        .font(Brand.sans(14, weight: .semibold))
                        .underline()
                        .foregroundStyle(palette.accentInk)
                }
            }
        }
        .font(Brand.sans(14))
        .foregroundStyle(palette.warn)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.warn.opacity(0.1)))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.warn.opacity(0.35), lineWidth: 1))
    }

    private func allow(_ draft: ConnectDraft) {
        guard draft.baseUrl != nil, !busy else { return }
        busy = true
        error = nil
        refusedLogin = nil
        let asked = address
        let secret = token
        Task { @MainActor in
            let outcome = await store.connect(address: asked, token: secret)
            busy = false
            switch outcome {
            case .connected:
                address = ""
                token = ""
                focused = nil
                onConnected()
            case .refused(let login):
                refusedLogin = login
            case .failed(let text):
                error = text
            }
        }
    }
}

private extension View {
    /// The form's text box: paper, the strong line, the control radius.
    func fieldBox(_ palette: Palette) -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper))
            .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).strokeBorder(palette.lineStrong, lineWidth: 1))
            .textFieldStyle(.plain)
    }
}

#Preview {
    ConnectView(address: .constant("https://winnow.steeve.website"))
        .padding()
        .environment(ConnectionStore.preview())
}
