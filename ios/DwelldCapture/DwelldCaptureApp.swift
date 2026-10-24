import SwiftUI
import RoomPlan
import WebKit
import MetalKit
import simd
@main struct DwelldCaptureApp: App { var body: some Scene { WindowGroup { CaptureScreen() } } }
struct RoomView: UIViewRepresentable {
    let model: CaptureModel
    func makeUIView(context: Context) -> RoomCaptureView { model.view }
    func updateUIView(_ view: RoomCaptureView, context: Context) {}
}
/// Matches the website: warm paper, ink, serif headings, square dark buttons and a thin line loader.
enum Dwelld {
    static let paper = Color(red: 0.973, green: 0.969, blue: 0.949)
    static let ink = Color(red: 0.169, green: 0.192, blue: 0.169)
    static let muted = Color(red: 0.455, green: 0.475, blue: 0.424)
    static let rule = Color(red: 0.863, green: 0.871, blue: 0.827)
    static let well = Color(red: 0.914, green: 0.914, blue: 0.875)
    static let accent = Color(red: 0.239, green: 0.275, blue: 0.212)
    static func serif(_ size: CGFloat) -> Font { .system(size: size, weight: .regular, design: .serif) }
}
struct DwelldButtonStyle: ButtonStyle {
    var filled = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 14, weight: .medium)).frame(maxWidth: .infinity).frame(height: 48)
            .foregroundStyle(filled ? Dwelld.paper : Dwelld.ink)
            .background(RoundedRectangle(cornerRadius: 3).fill(filled ? Dwelld.ink : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(filled ? Color.clear : Dwelld.ink.opacity(0.35), lineWidth: 1))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}
/// Thin progress line. Pass nil for an indeterminate sweep.
struct LineLoader: View {
    let label: String
    var progress: Double? = nil
    @State private var sweep = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(Dwelld.serif(15)).foregroundStyle(Dwelld.ink)
                Spacer()
                if let progress { Text("\(Int((progress * 100).rounded()))%").font(.system(size: 11).monospacedDigit()).foregroundStyle(Dwelld.muted) }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Dwelld.rule)
                    if let progress {
                        Rectangle().fill(Dwelld.accent).frame(width: geo.size.width * max(0, min(1, progress))).animation(.easeOut(duration: 0.35), value: progress)
                    } else {
                        Rectangle().fill(Dwelld.accent).frame(width: geo.size.width * 0.32).offset(x: sweep ? geo.size.width : -geo.size.width * 0.32)
                            .animation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false), value: sweep)
                    }
                }.clipped()
            }.frame(height: 2)
        }.onAppear { sweep = true }
    }
}
/// Centre crosshair in the room's mark style: four corner ticks and a ring that pops when you mark.
struct MarkCrosshair: View {
    let pulse: Int
    @State private var pop = false
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.9), lineWidth: 1.5).frame(width: 18, height: 18)
            Circle().fill(Color(red: 0.77, green: 0.34, blue: 0.25)).frame(width: 6, height: 6)
            Circle().stroke(Color(red: 0.89, green: 0.6, blue: 0.23), lineWidth: 2).frame(width: 64, height: 64).scaleEffect(pop ? 1.6 : 0.6).opacity(pop ? 0 : 1)
            ForEach(0..<4, id: \.self) { i in
                Path { p in p.move(to: CGPoint(x: 0, y: 12)); p.addLine(to: .zero); p.addLine(to: CGPoint(x: 12, y: 0)) }
                    .stroke(Color.white.opacity(0.9), lineWidth: 1.5).frame(width: 12, height: 12)
                    .offset(x: -26, y: -26).rotationEffect(.degrees(Double(i) * 90))
            }
        }
        .shadow(color: .black.opacity(0.35), radius: 2)
        .onChange(of: pulse) { _, _ in pop = false; withAnimation(.easeOut(duration: 0.5)) { pop = true } }
        .onAppear { pop = true }
    }
}
struct CaptureScreen: View {
    @StateObject private var model = CaptureModel()
    private var title: String {
        if model.pairedSession.isEmpty { return "Connect from your laptop." }
        if model.uploadComplete { return "Saved to your laptop." }
        if model.uploading { return "Sending your room." }
        if model.processing { return "Measuring your room." }
        if model.relocalizing { return "Find where you left off." }
        if model.scanning { return "Let your room tell its story." }
        if model.ready { return "Ready to send." }
        return model.continueFrom.isEmpty ? "Ready when you are." : "Continue your room."
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("dwelld.").font(Dwelld.serif(22)).foregroundStyle(Dwelld.ink)
                    Spacer()
                    HStack(spacing: 7) {
                        Circle().fill(model.pairedSession.isEmpty ? Dwelld.muted.opacity(0.6) : (model.scanning ? Color(red: 0.73, green: 0.33, blue: 0.25) : Color(red: 0.38, green: 0.51, blue: 0.34))).frame(width: 6, height: 6)
                        Text(model.pairedSession.isEmpty ? "Not connected" : (model.uploadComplete ? "Saved" : "Connected to laptop")).font(.system(size: 11)).foregroundStyle(Dwelld.muted)
                    }
                }
                Rectangle().fill(Dwelld.rule).frame(height: 1)
                VStack(alignment: .leading, spacing: 8) {
                    Text(title).font(Dwelld.serif(30)).foregroundStyle(Dwelld.ink).fixedSize(horizontal: false, vertical: true)
                    Text(model.pairedSession.isEmpty ? "Start an inspection on the website, scan its QR code with your iPhone camera, then tap Open Dwelld Capture." : (model.relocalizing || (!model.continueFrom.isEmpty && !model.scanning && !model.ready && !model.uploadComplete)) ? "Stand where you scanned before and point at something you already captured. Once the phone recognises it, scan the new part." : "Move slowly. Keep the details in view. Your laptop shows the room building as you go.")
                        .font(.system(size: 13)).foregroundStyle(Dwelld.muted).fixedSize(horizontal: false, vertical: true)
                }
                if model.pairing { LineLoader(label: "Connecting securely") }
                ZStack(alignment: .topLeading) {
                    RoomView(model: model).id(model.captureViewID).frame(height: 300)
                    if !model.scanning && (model.ready || model.processing || model.uploadComplete) {
                        Dwelld.well.overlay(Text(model.processing ? "Finishing capture…" : (model.uploadComplete ? "Inspection saved" : "Capture ready")).font(Dwelld.serif(20)).foregroundStyle(Dwelld.ink))
                    }
                    if model.scanning {
                        TimelineView(.animation(minimumInterval: 1.0 / 30)) { _ in
                            GeometryReader { geometry in
                                ForEach(model.liveFindings) { finding in
                                    if let point = model.projectedDamage(finding, viewport: geometry.size) {
                                        VStack(spacing: 3) {
                                            Text(finding.label).font(.system(size: 10, weight: .medium)).padding(4).background(Dwelld.paper.opacity(0.95)).foregroundStyle(Dwelld.ink)
                                            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.orange).background(Circle().fill(.white)).font(.system(size: 22))
                                        }.position(point)
                                    }
                                }
                            }
                        }.allowsHitTesting(false)
                        MarkCrosshair(pulse: model.markPulse).frame(maxWidth: .infinity, maxHeight: .infinity).allowsHitTesting(false)
                        VStack {
                            Spacer()
                            Button { model.markDamage() } label: {
                                Label(model.markCount > 0 ? "Mark damage · \(model.markCount)" : "Mark damage", systemImage: "scope")
                                    .font(.system(size: 14, weight: .medium)).padding(.horizontal, 18).frame(height: 44)
                                    .background(Capsule().fill(Dwelld.paper.opacity(0.94))).foregroundStyle(Dwelld.ink)
                            }.accessibilityHint("Marks what is under the crosshair without stopping the scan")
                        }.frame(maxWidth: .infinity).padding(.bottom, 14)
                    }
                    if model.relocalizing {
                        VStack(spacing: 10) {
                            ProgressView().tint(.white)
                            Text("Point at a part you already scanned").font(Dwelld.serif(17)).foregroundStyle(.white)
                            Text(model.tracking).font(.system(size: 11)).foregroundStyle(.white.opacity(0.85))
                        }.padding(16).background(Color.black.opacity(0.45)).clipShape(RoundedRectangle(cornerRadius: 3))
                        .frame(maxWidth: .infinity, maxHeight: .infinity).allowsHitTesting(false)
                    }
                    if model.scanning {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.tracking).font(.system(size: 11, weight: .medium))
                            Text("\(model.frameCount) frames · \(model.depthCount) with depth").font(.system(size: 11).monospacedDigit())
                            if model.sentDuringScan > 0 { Text("\(model.sentDuringScan) files already on your laptop").font(.system(size: 11).monospacedDigit()) }
                        }.foregroundStyle(Dwelld.ink).padding(10).background(Dwelld.paper.opacity(0.92)).clipShape(RoundedRectangle(cornerRadius: 3)).padding(12)
                    }
                }.background(Dwelld.well).clipShape(RoundedRectangle(cornerRadius: 2))
                if model.scanning || model.processing || model.ready {
                    Text(model.damageCheckStatus).font(.system(size: 11)).foregroundStyle(Dwelld.muted)
                }
                if let image = model.damageEvidence {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Damage spotted").font(Dwelld.serif(18)).foregroundStyle(Dwelld.ink)
                        Image(uiImage: image).resizable().aspectRatio(contentMode: .fit)
                            .overlay {
                                GeometryReader { geometry in
                                    ForEach(model.damageEvidenceFindings) { finding in
                                        if let box = finding.boundingBox {
                                            Rectangle().stroke(Color.orange, lineWidth: 2)
                                                .frame(width: geometry.size.width * box.width, height: geometry.size.height * box.height)
                                                .position(x: geometry.size.width * (box.x + box.width / 2), y: geometry.size.height * (box.y + box.height / 2))
                                        }
                                    }
                                }
                            }
                        Text(model.damageEvidenceFindings.map { $0.label }.joined(separator: " · ")).font(.system(size: 12)).foregroundStyle(Dwelld.ink)
                        Text("Source photo · suggestions update after cross-checking. Scanning continues.").font(.system(size: 10)).foregroundStyle(Dwelld.muted)
                    }
                }
                if model.scanning { Text(model.videoStatus).font(.system(size: 11)).foregroundStyle(Dwelld.muted) }
                if model.processing { LineLoader(label: "Building your measured room") }
                if model.uploading { LineLoader(label: "Sending to your laptop", progress: model.uploadProgress) }
                VStack(spacing: 10) {
                    if model.relocalizing {
                        Button("Stop looking") { model.cancelRelocalizing() }.buttonStyle(DwelldButtonStyle(filled: false))
                    } else if !model.ready && !model.uploadComplete {
                        Button(model.scanning ? "Finish & save" : (model.continueFrom.isEmpty ? "Start scan" : "Continue scan")) { if model.scanning { model.stop() } else { model.start() } }
                            .buttonStyle(DwelldButtonStyle())
                            .disabled(model.pairedSession.isEmpty || model.pairing || model.uploading || model.processing)
                    }
                    if model.ready && !model.uploadComplete && !model.uploading {
                        Button("Retry sending") { Task { await model.savePairedCapture() } }.buttonStyle(DwelldButtonStyle()).disabled(model.processing || model.pairing)
                    }
                    if model.uploadComplete {
                        Button("New inspection") { model.prepareNewInspection() }.buttonStyle(DwelldButtonStyle(filled: false)).disabled(model.pairing || model.processing || model.uploading)
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Your room, in 3D").font(Dwelld.serif(18)).foregroundStyle(Dwelld.ink)
                        Spacer()
                        Text("\(model.splatCount) points").font(.system(size: 11).monospacedDigit()).foregroundStyle(Dwelld.muted)
                    }
                    ZStack {
                        LiveSplatView(samples: model.liveSplats, revision: model.splatRevision, error: $model.splatRenderError).frame(height: 200)
                            .overlay(alignment: .topTrailing) {
                                VStack(alignment: .leading, spacing: 7) {
                                    Label("Room tally", systemImage: "list.bullet.rectangle").font(.system(size: 11, weight: .semibold))
                                    ForEach(model.furnitureTally.keys.sorted(), id: \.self) { category in
                                        HStack(spacing: 7) { Image(systemName: category.lowercased().contains("bed") ? "bed.double" : category.lowercased().contains("chair") || category.lowercased().contains("sofa") ? "chair.lounge" : category.lowercased().contains("table") ? "table.furniture" : "shippingbox").frame(width: 15); Text(category.capitalized); Spacer(minLength: 8); Text("\(model.furnitureTally[category] ?? 0)").monospacedDigit() }.font(.system(size: 10))
                                    }
                                }.padding(9).frame(maxWidth: 165).foregroundStyle(Dwelld.ink).background(Dwelld.paper.opacity(0.94)).clipShape(RoundedRectangle(cornerRadius: 5)).padding(8)
                            }
                        if !model.splatRenderError.isEmpty { Text(model.splatRenderError).font(.system(size: 11)).foregroundStyle(.white).padding() }
                        else if model.liveSplats.isEmpty { Text(model.scanning ? "Waiting for steady depth. Move slowly." : "Builds as you scan").font(Dwelld.serif(15)).foregroundStyle(.white.opacity(0.8)).padding() }
                    }.clipShape(RoundedRectangle(cornerRadius: 2))
                    Text("Drag to orbit").font(.system(size: 10)).foregroundStyle(Dwelld.muted)
                }
                Rectangle().fill(Dwelld.rule).frame(height: 1)
                Text(model.status).font(.system(size: 12)).foregroundStyle(Dwelld.muted).accessibilityIdentifier("captureStatus").fixedSize(horizontal: false, vertical: true)
                if let directory = model.directory, model.ready { ShareLink("Export local capture folder", item: directory).font(.system(size: 12)).tint(Dwelld.ink) }
                Text("Sampled evidence is sent to your paired inspection. Full-resolution originals stay on this phone. Requires a LiDAR iPhone or iPad.").font(.system(size: 10)).foregroundStyle(Dwelld.muted).fixedSize(horizontal: false, vertical: true)
            }.padding(20)
        }
        .background(Dwelld.paper.ignoresSafeArea())
        .tint(Dwelld.ink)
        .sheet(item: $model.pendingMark) { _ in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let photo = model.markSnapshot {
                            Image(uiImage: photo).resizable().scaledToFit().frame(maxHeight: 300)
                                .overlay { Image(systemName: "scope").font(.system(size: 30)).foregroundStyle(.red).shadow(color: .white, radius: 2) }
                        }
                        Text("This is the exact frame you marked. Add context for Gemini about the spot under the crosshair.").font(.system(size: 13)).foregroundStyle(Dwelld.muted)
                        Text("Your note (optional)").font(.system(size: 14, weight: .medium))
                        TextField("e.g. Scratch on the front edge, already here at move-in", text: $model.markNote, axis: .vertical)
                            .lineLimit(3...6).padding(14).background(Dwelld.well).clipShape(RoundedRectangle(cornerRadius: 6))
                            .onChange(of: model.markNote) { _, value in if value.count > 1000 { model.markNote = String(value.prefix(1000)) } }
                            .accessibilityLabel("Note for the marked snapshot")
                        Text("Your words stay with this photo. Gemini checks the pixels; the note does not confirm damage.").font(.system(size: 11)).foregroundStyle(Dwelld.muted)
                        Button("Save snapshot & note") { model.savePendingMark() }.buttonStyle(DwelldButtonStyle())
                    }.padding(20)
                }.background(Dwelld.paper).navigationTitle("Marked snapshot").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.cancelPendingMark() } } }
            }.interactiveDismissDisabled()
        }
        .onOpenURL { url in Task { await model.pair(url: url) } }
    }
}

struct LiveGaussian {
    var centerRadius: SIMD4<Float>
    var color: SIMD4<Float>
}

/// Renders isotropic Gaussians directly from the same depth samples used by the PLY exporter.
/// No network roundtrip or file reloading is involved during capture.
struct LiveSplatView: UIViewRepresentable {
    let samples: [LiveGaussian]
    let revision: Int
    @Binding var error: String
    func makeCoordinator() -> LiveSplatRenderer { LiveSplatRenderer() }
    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        view.clearColor = MTLClearColor(red: 0.055, green: 0.075, blue: 0.065, alpha: 1)
        view.colorPixelFormat = .bgra8Unorm
        view.isPaused = true; view.enableSetNeedsDisplay = true
        view.accessibilityLabel = "Live LiDAR Gaussian splat preview"
        do { try context.coordinator.configure(view) }
        catch { DispatchQueue.main.async { self.error = "Live splat renderer is unavailable. Your capture can still be saved." } }
        view.delegate = context.coordinator
        return view
    }
    func updateUIView(_ view: MTKView, context: Context) {
        context.coordinator.update(samples: samples, revision: revision, view: view)
    }
    static func dismantleUIView(_ view: MTKView, coordinator: LiveSplatRenderer) { view.delegate = nil; coordinator.buffer = nil }
}

final class LiveSplatRenderer: NSObject, MTKViewDelegate {
    private var pipeline: MTLRenderPipelineState?
    private var queue: MTLCommandQueue?
    fileprivate var buffer: MTLBuffer?
    private var samples: [LiveGaussian] = []
    private var revision = -1
    private var needsSort = true
    private var angle: Float = .pi / 4
    private var center = SIMD3<Float>(repeating: 0)
    private var extent: Float = 3
    private weak var view: MTKView?
    private struct Uniforms { var viewProjection: simd_float4x4; var viewport: SIMD4<Float> }
    func configure(_ view: MTKView) throws {
        guard let device = view.device, let queue = device.makeCommandQueue() else { throw CocoaError(.featureUnsupported) }
        self.queue = queue; self.view = view
        let library = try device.makeLibrary(source: Self.shader, options: nil)
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "splatVertex")
        descriptor.fragmentFunction = library.makeFunction(name: "splatFragment")
        descriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
        let attachment = descriptor.colorAttachments[0]!
        attachment.isBlendingEnabled = true
        attachment.sourceRGBBlendFactor = .one; attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
        attachment.sourceAlphaBlendFactor = .one; attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        view.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(pan(_:))))
    }
    func update(samples: [LiveGaussian], revision: Int, view: MTKView) {
        guard self.revision != revision else { return }
        self.revision = revision; self.samples = samples; needsSort = true
        if !samples.isEmpty {
            var low = SIMD3<Float>(repeating: .greatestFiniteMagnitude), high = -low
            for s in samples { let p = SIMD3<Float>(s.centerRadius.x, s.centerRadius.y, s.centerRadius.z); low = simd_min(low, p); high = simd_max(high, p) }
            center = (low + high) / 2; extent = max(1, simd_length(high - low))
        } else { buffer = nil }
        view.setNeedsDisplay()
    }
    @objc private func pan(_ gesture: UIPanGestureRecognizer) {
        guard let view else { return }
        angle += Float(gesture.translation(in: view).x) * 0.008
        gesture.setTranslation(.zero, in: view); needsSort = true; view.setNeedsDisplay()
    }
    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) { view.setNeedsDisplay() }
    func draw(in view: MTKView) {
        guard let pipeline, let queue, let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable, let command = queue.makeCommandBuffer() else { return }
        let aspect = Float(max(1, view.drawableSize.width) / max(1, view.drawableSize.height))
        let eye = center + SIMD3<Float>(sin(angle), 0.65, cos(angle)) * extent
        let z = simd_normalize(eye - center), x = simd_normalize(simd_cross(SIMD3<Float>(0, 1, 0), z)), y = simd_cross(z, x)
        let camera = simd_float4x4(columns: (SIMD4<Float>(x.x, y.x, z.x, 0), SIMD4<Float>(x.y, y.y, z.y, 0), SIMD4<Float>(x.z, y.z, z.z, 0), SIMD4<Float>(-simd_dot(x, eye), -simd_dot(y, eye), -simd_dot(z, eye), 1)))
        let focal: Float = 1 / tan(.pi / 6), near: Float = 0.01, far: Float = 1000
        let projection = simd_float4x4(columns: (SIMD4<Float>(focal / aspect, 0, 0, 0), SIMD4<Float>(0, focal, 0, 0), SIMD4<Float>(0, 0, far / (near - far), -1), SIMD4<Float>(0, 0, far * near / (near - far), 0)))
        if needsSort, !samples.isEmpty {
            // Alpha compositing requires back-to-front camera-depth order.
            let sorted = samples.sorted { a, b in
                let pa = SIMD3<Float>(a.centerRadius.x, a.centerRadius.y, a.centerRadius.z)
                let pb = SIMD3<Float>(b.centerRadius.x, b.centerRadius.y, b.centerRadius.z)
                return simd_dot(pa, z) < simd_dot(pb, z)
            }
            buffer = sorted.withUnsafeBytes { bytes in view.device?.makeBuffer(bytes: bytes.baseAddress!, length: bytes.count, options: .storageModeShared) }
            needsSort = false
        }
        if let encoder = command.makeRenderCommandEncoder(descriptor: descriptor) {
            if let buffer, !samples.isEmpty {
                var uniforms = Uniforms(viewProjection: projection * camera, viewport: SIMD4<Float>(Float(view.drawableSize.width), Float(view.drawableSize.height), focal, 0))
                encoder.setRenderPipelineState(pipeline)
                encoder.setVertexBuffer(buffer, offset: 0, index: 0)
                encoder.setVertexBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 1)
                encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: samples.count)
            }
            encoder.endEncoding()
        }
        command.present(drawable); command.commit()
    }
    static let shader = """
    #include <metal_stdlib>
    using namespace metal;
    struct Gaussian { float4 centerRadius; float4 color; };
    struct Uniforms { float4x4 viewProjection; float4 viewport; };
    struct Vertex { float4 position [[position]]; float2 uv; float4 color; };
    vertex Vertex splatVertex(uint vertexID [[vertex_id]], uint instance [[instance_id]],
                             const device Gaussian *points [[buffer(0)]], constant Uniforms &u [[buffer(1)]]) {
        const float2 corners[6] = {float2(-1,-1),float2(1,-1),float2(-1,1),float2(-1,1),float2(1,-1),float2(1,1)};
        Gaussian g = points[instance];
        float4 clip = u.viewProjection * float4(g.centerRadius.xyz, 1);
        float2 uv = corners[vertexID];
        float sigma = max(0.4f, g.centerRadius.w * u.viewport.z * u.viewport.y / (2 * max(clip.w, 0.01f)));
        clip.xy += uv * 3 * sigma * 2 / u.viewport.xy * clip.w;
        Vertex out; out.position = clip; out.uv = uv * 3; out.color = g.color;
        if (clip.w <= 0) out.color.a = 0;
        return out;
    }
    fragment float4 splatFragment(Vertex in [[stage_in]]) {
        float alpha = exp(-0.5f * dot(in.uv, in.uv)) * in.color.a;
        if (alpha < 0.003f) discard_fragment();
        return float4(in.color.rgb * alpha, alpha);
    }
    """
}
