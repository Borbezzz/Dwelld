import SwiftUI
import RoomPlan
import WebKit
@main struct DwelldCaptureApp: App { var body: some Scene { WindowGroup { CaptureScreen() } } }
struct RoomView: UIViewRepresentable {
    let model: CaptureModel
    func makeUIView(context: Context) -> RoomCaptureView { model.view }
    func updateUIView(_ view: RoomCaptureView, context: Context) {}
}
struct LoginView: UIViewRepresentable {
    let webView: WKWebView; let url: URL
    func makeUIView(context: Context) -> WKWebView { webView.load(URLRequest(url: url)); return webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
struct CaptureScreen: View {
    @StateObject private var model = CaptureModel()
    @State private var host = "https://dwelld.vercel.app"
    @State private var roomId = ""
    @State private var newRoomName = ""
    @State private var inspectionType = "move-in"
    @State private var login = false
    var body: some View {
        VStack(spacing: 8) {
            Text("Dwelld LiDAR capture").font(.headline)
            if model.pairedSession.isEmpty {
            DisclosureGroup("Advanced server address") { TextField("HTTPS Dwelld address", text: $host).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder) }
            Picker("Room", selection: $roomId) { Text("Choose room").tag(""); ForEach(model.rooms) { Text($0.name).tag($0.id) } }
            HStack { TextField("New room name", text: $newRoomName).textFieldStyle(.roundedBorder); Button("Add room") { if let url = URL(string: host) { Task { await model.createRoom(base: url, name: newRoomName) } } }.disabled(newRoomName.trimmingCharacters(in: .whitespaces).isEmpty || model.uploading) }
            Picker("Inspection", selection: $inspectionType) { Text("Move-in").tag("move-in"); Text("Move-out").tag("move-out") }.pickerStyle(.segmented)
            Button("Refresh rooms") { if let url = URL(string: host) { Task { await model.loadRooms(base: url) } } }
            } else { Text("Connected to laptop inspection").font(.subheadline) }
            HStack {
                if model.pairedSession.isEmpty { Button("Sign in") { login = true }.disabled(URL(string: host)?.scheme != "https") }
                Button(model.scanning ? "Finish scan" : "Start scan") { if model.scanning { model.stop() } else { model.start() } }.disabled(model.uploading || model.processing)
                Button("Upload") { if let url = URL(string: host) { Task { await model.upload(base: url, roomId: roomId, type: inspectionType) } } }.disabled(!model.ready || model.scanning || model.uploading)
            }.buttonStyle(.bordered)
            ZStack(alignment: .topLeading) {
                RoomView(model: model).frame(minHeight: 320, maxHeight: .infinity)
                if model.scanning { VStack(alignment: .leading, spacing: 5) {
                    Label(model.tracking, systemImage: "viewfinder")
                    Text("\(model.frameCount) frames · \(model.depthCount) depth frames")
                    Text("\(model.featureCount) tracked feature points")
                }.font(.caption).padding(12).background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 10)).padding(12) }
                if model.processing { ProgressView("Building your measured room…").padding().background(.ultraThinMaterial) }
            }.clipShape(RoundedRectangle(cornerRadius: 12))
            Text(model.status).font(.caption).accessibilityIdentifier("captureStatus")
            if let directory = model.directory, model.ready { ShareLink("Export local capture folder", item: directory) }
            Text("Images and depth remain on this device until you upload or share. A LiDAR device is required; simulator geometry is never generated.").font(.caption2)
        }.padding().onOpenURL { url in Task { await model.pair(url: url) } }.sheet(isPresented: $login) {
            if let url = URL(string: host)?.appendingPathComponent("sign-in") { VStack { Button("Done") { login = false; if let base = URL(string: host) { Task { await model.loadRooms(base: base) } } }; LoginView(webView: model.login, url: url) } }
        }
    }
}
