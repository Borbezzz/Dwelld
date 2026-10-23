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
                RoomView(model: model).frame(minHeight: 180, maxHeight: .infinity)
                if !model.scanning && (model.ready || model.processing) { Color(red: 0.09, green: 0.12, blue: 0.10).overlay(Text(model.processing ? "Finishing capture…" : "Capture ready to upload").foregroundStyle(.white)) }
                if model.scanning { VStack(alignment: .leading, spacing: 5) {
                    Label(model.tracking, systemImage: "viewfinder")
                    Text("\(model.frameCount) frames · \(model.depthCount) depth frames")
                    Text("\(model.featureCount) tracked feature points")
                }.font(.caption).padding(12).background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 10)).padding(12) }
                if model.processing { ProgressView("Building your measured room…").padding().background(.ultraThinMaterial) }
            }.clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text("Live LiDAR splat").font(.subheadline.bold()); Spacer(); Text("\(model.splatCount) samples").font(.caption.monospacedDigit()) }
                ZStack {
                    LiveSplatView(samples: model.liveSplats, revision: model.splatRevision, error: $model.splatRenderError).frame(height: 190)
                    if !model.splatRenderError.isEmpty { Text(model.splatRenderError).font(.caption).foregroundStyle(.white).padding() }
                    else if model.liveSplats.isEmpty { Text(model.scanning ? "Waiting for stable LiDAR depth. Move slowly around the room." : "Start scanning to build your room here.").font(.caption).foregroundStyle(.white).padding() }
                }.clipShape(RoundedRectangle(cornerRadius: 12))
                Text("Builds from captured depth and colour · drag to orbit · untrained preview").font(.caption2)
            }
            Text(model.status).font(.caption).accessibilityIdentifier("captureStatus")
            if let directory = model.directory, model.ready { ShareLink("Export local capture folder", item: directory) }
            Text("Finish & save uploads sampled evidence to your paired inspection. Full-resolution originals remain on this device. A LiDAR device is required; simulator geometry is never generated.").font(.caption2)
        }.padding().onOpenURL { url in Task { await model.pair(url: url) } }
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
