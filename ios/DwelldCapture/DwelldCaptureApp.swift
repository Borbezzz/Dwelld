import SwiftUI
import RoomPlan
import WebKit
@main struct DwelldCaptureApp: App { var body: some Scene { WindowGroup { CaptureScreen() } } }
struct RoomView: UIViewRepresentable {
    let model: CaptureModel
    func makeUIView(context: Context) -> RoomCaptureView { model.view }
    func updateUIView(_ view: RoomCaptureView, context: Context) {}
}
struct CaptureScreen: View {
    @StateObject private var model = CaptureModel()
    var body: some View {
        VStack(spacing: 8) {
            Text("Dwelld LiDAR capture").font(.headline)
            if model.pairedSession.isEmpty {
                Text("Connect from your laptop").font(.title2)
                Text("Start an inspection on the website, scan its QR code with your iPhone camera, then tap Open Dwelld Capture. Your room and account connect automatically.").font(.subheadline)
            } else {
                Label(model.uploadComplete ? "Saved to laptop" : "Connected to laptop inspection", systemImage: model.uploadComplete ? "checkmark.circle.fill" : "link").font(.subheadline)
            }
            if model.pairing { ProgressView("Connecting securely…") }
            HStack {
                if !model.ready && !model.uploadComplete {
                    Button(model.scanning ? "Finish & save" : "Start scan") { if model.scanning { model.stop() } else { model.start() } }
                        .disabled(model.pairedSession.isEmpty || model.pairing || model.uploading || model.processing)
                }
                if model.ready && !model.uploadComplete && !model.uploading {
                    Button("Retry save") { Task { await model.savePairedCapture() } }.disabled(model.processing || model.pairing)
                }
            }.buttonStyle(.borderedProminent)
            if model.uploading {
                ProgressView(value: model.uploadProgress).accessibilityLabel("Saving inspection")
                Text("Saving automatically. Keep Dwelld open until Saved appears.").font(.caption)
            }
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
            Text("Finish & save uploads sampled evidence to your paired inspection. Full-resolution originals remain on this device. A LiDAR device is required; simulator geometry is never generated.").font(.caption2)
        }.padding().onOpenURL { url in Task { await model.pair(url: url) } }
    }
}
