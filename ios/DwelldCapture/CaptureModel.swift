import SwiftUI
import RoomPlan
import ARKit
import CoreImage
import WebKit
import Security

func matrix(_ m: simd_float4x4) -> [Float] { (0..<4).flatMap { c in (0..<4).map { r in m[c][r] } } }
func matrix(_ m: simd_float3x3) -> [Float] { (0..<3).flatMap { c in (0..<3).map { r in m[c][r] } } }
func dimensions(_ v: SIMD3<Float>) -> [Float] { [v.x, v.y, v.z] }
struct OwnedRoom: Codable, Identifiable { let id: String; let name: String }
struct Element: Codable { let id: String; let category: String; let dimensions: [Float]; let transform: [Float] }
struct FrameRecord: Codable { let timestamp: Double; let image: String; let depth: String?; let confidence: String?; let width: Int; let height: Int; let depthWidth: Int?; let depthHeight: Int?; let intrinsics: [Float]; let transform: [Float] }
struct Registration: Codable { let sessionId: String; var source = "arkit-calibrated"; var transform = matrix(matrix_identity_float4x4) }
struct Asset: Codable { let name: String; var mediaRef: String; let kind: String; var registration: Registration? = nil; var reconstructionMethod: String? = nil }
/// A spot the person marked during the scan: the photo and the LiDAR point under the centre crosshair.
struct PhoneMark: Codable { let id: String; let position: [Float]; let timestamp: Double; let image: String; var sent = false }
struct Manifest: Codable { var version = 1; let sessionId: String; var coordinateSystem = "arkit-right-handed-y-up-metres"; var elements: [Element]; var frames: [FrameRecord]; var assets: [Asset] }

struct PhoneDamageBox: Decodable { let x: Double; let y: Double; let width: Double; let height: Double }
struct PhoneFinding: Decodable, Identifiable {
    let id: String; let label: String; let worldPosition: [Float]?; let boundingBox: PhoneDamageBox?
    let evidenceFrameRef: String?; let reviewStatus: String?; let timestampSeconds: Double?
}

@MainActor final class CaptureModel: NSObject, ObservableObject, @preconcurrency RoomCaptureViewDelegate, @preconcurrency RoomCaptureSessionDelegate {
    @Published var liveFindings: [PhoneFinding] = []
    @Published var damageEvidence: UIImage?
    @Published var damageEvidenceFindings: [PhoneFinding] = []
    @Published var damageCheckStatus = "Damage checks begin with the scan"
    private var evidenceRef = ""
    private var evidenceLoading = false
    private var pendingEvidence: FrameRecord?
    @Published var status = "Start an inspection on your laptop, then scan its QR code to connect this phone."
    @Published var pairedSession = ""
    @Published var pairing = false
    /// Set when the laptop session continues an earlier scan: the phone relocalizes into it first.
    @Published var continueFrom = ""
    @Published var relocalizing = false
    @Published var uploadComplete = false
    @Published var uploadProgress: Double = 0
    private var connection: CaptureConnection?
    private var connectionGeneration = UUID()
    @Published var captureViewID = UUID()
    @Published var videoStatus = "Video connects when scanning starts"
    private var liveVideo: NativeVideoStream?
    private var videoTimer: Timer?
    private var videoTick = 0
    private var videoServers: [[String: Any]] = []
    private var phoneToken = ""
    private var progressInFlight = false
    /// Latest RoomPlan furniture and walls, streamed to the laptop while scanning.
    private var liveElements: [Element] = []
    private let pairedBase = URL(string: "https://dwelld.vercel.app")!
    func pair(url: URL) async {
        guard !scanning, !uploading, !processing else { status = "Finish the current capture before pairing."; return }
        guard url.scheme == "dwelld", url.host == "pair", let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), let session = parts.queryItems?.first(where: {$0.name == "session"})?.value, session.range(of: "^[a-f0-9]{24}$", options: .regularExpression) != nil, let token = parts.queryItems?.first(where: {$0.name == "token"})?.value, token.range(of: "^[A-Za-z0-9_-]{32,128}$", options: .regularExpression) != nil else { status = "Invalid pairing link. Scan a new QR code."; return }
        guard !pairing else { return }
        guard !ready || uploadComplete || connection?.session == session else { status = "Finish uploading this capture before connecting a different inspection. Your files are retained on this phone."; return }
        let changesSession = pairedSession != session
        pairing = true; defer { pairing = false }
        do {
            // Save the claim BEFORE sending it. Retrying a lost response reuses the same identity.
            let previous = connection?.session == session ? connection : CaptureConnectionStore.load()
            var claim = previous?.session == session ? previous! : CaptureConnection(session: session, phone: UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: ""), device: UUID().uuidString, pairingToken: token)
            claim.pairingToken = token
            try CaptureConnectionStore.save(claim)
            var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(session)/pair")); request.httpMethod = "POST"; request.timeoutInterval = 30; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["pairingToken": token, "phoneToken": claim.phone, "deviceId": claim.device])
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: data) }
            let body = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let remote = body?["session"] as? [String: Any]
            let servers = body?["iceServers"] as? [[String: Any]] ?? []
            claim.paired = true
            if let expiry = remote?["expiresAt"] as? String { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; claim.expiresAt = formatter.date(from: expiry) ?? claim.expiresAt }
            if remote?["status"] as? String == "saved" { claim.completed = true }
            if changesSession { resetCaptureState() }
            claim.continueFrom = remote?["continueFrom"] as? String
            try CaptureConnectionStore.save(claim); connection = claim
            continueFrom = claim.continueFrom ?? ""
            phoneToken = claim.phone; pairedSession = session; uploadComplete = claim.completed; videoServers = servers
            if !ready { inspectionId = "" }
            status = uploadComplete ? "Inspection already saved. Start a new inspection on your laptop for another scan." : "Connected. Finish & save sends your scan to the laptop automatically."
            if !uploadComplete { await publishProgress(stage: "ready") }
        } catch { status = "Could not connect. Scan the same QR again to retry. \(error.localizedDescription)" }
    }
    private func restoreConnection() {
        guard let saved = CaptureConnectionStore.load() else { return }
        if saved.completed { try? CaptureConnectionStore.clear(); return }
        connection = saved; uploadComplete = saved.completed; continueFrom = saved.continueFrom ?? ""
        if saved.paired { pairedSession = saved.session; phoneToken = saved.phone }
        if let folder = saved.captureFolder, UUID(uuidString: folder) != nil {
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(folder)
            if let data = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")), let m = try? JSONDecoder().decode(Manifest.self, from: data) {
                directory = dir; manifest = m; ready = true; frameCount = m.frames.count; depthCount = m.frames.filter { $0.depth != nil }.count
            }
        }
        status = saved.completed ? "Inspection saved on your laptop." : saved.expiresAt < Date() ? "QR connection expired. Your capture is retained locally; reconnect from the laptop. No phone sign-in is required." : saved.paired ? (ready ? "Capture recovered. Tap Retry save to resume." : "Reconnected to your laptop. Ready to scan.") : "Scan the same laptop QR again to finish connecting."
    }
    func savePairedCapture() async { await upload(base: pairedBase, roomId: "", type: "move-in") }
    private func publishProgress(stage: String) async {
        guard !pairedSession.isEmpty, !uploadComplete, !progressInFlight else { return }; let generation = connectionGeneration; progressInFlight = true; defer { if generation == connectionGeneration { progressInFlight = false } }
        do {
            var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(pairedSession)/spatial")); request.httpMethod = "PUT"; request.timeoutInterval = 10
            request.setValue("Bearer \(phoneToken)", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var progress: [String: Any] = ["stage": stage, "frames": frameCount, "depthFrames": depthCount]
            if scanning, let frame = view.captureSession.arSession.currentFrame {
                let original = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
                let scale = min(1, 720 / original.extent.width)
                let image = original.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                if let jpeg = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.6]), jpeg.count < 130000 {
                    progress["preview"] = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                    // Camera pose for this exact preview, so the laptop can place findings in the 3D room.
                    progress["pose"] = ["transform": matrix(frame.camera.transform), "intrinsics": matrix(frame.camera.intrinsics), "width": CVPixelBufferGetWidth(frame.capturedImage), "height": CVPixelBufferGetHeight(frame.capturedImage)] as [String: Any]
                }
            }
            if scanning || processing {
                progress["elements"] = liveElements.map { ["id": $0.id, "category": $0.category, "dimensions": $0.dimensions, "transform": $0.transform] as [String: Any] }
            }
            if uploading { progress["upload"] = uploadProgress }
            request.httpBody = try JSONSerialization.data(withJSONObject: progress)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard generation == connectionGeneration, !uploadComplete else { return }
            if let http = response as? HTTPURLResponse, http.statusCode == 200, let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let raw = body["findings"], let encoded = try? JSONSerialization.data(withJSONObject: raw), let findings = try? JSONDecoder().decode([PhoneFinding].self, from: encoded) { liveFindings = findings }
                if let issue = body["analysisIssue"] as? [String: Any], let message = issue["message"] as? String { damageCheckStatus = message }
                else if let p = body["analysisProgress"] as? [String: Int] { damageCheckStatus = "\(p["checked"] ?? 0) photos checked · \(p["checking"] ?? 0) checking · \(p["queued"] ?? 0) waiting" }
                Task { await refreshDamageEvidence() }
                if body["stopRequested"] as? Bool == true, scanning { stop() }
            }
        } catch { /* Capture continues locally if the laptop connection drops. */ }
    }
    @Published var liveSplats: [LiveGaussian] = []
    @Published var markCount = 0
    @Published var sentDuringScan = 0
    private var streamCursor = 0
    private var streamInFlight = false
    private var preUploaded: [String: String] = [:]
    private var preUploadTask: Task<Void, Never>?
    private var liveEvidence: [Int: FrameRecord] = [:]
    private var motions: [Float] = []
    @Published var markPulse = 0
    private var marks: [PhoneMark] = []
    @Published var splatCount = 0
    @Published var splatRevision = 0
    @Published var splatRenderError = ""
    @Published var tracking = "Camera idle"
    @Published var frameCount = 0
    @Published var depthCount = 0
    @Published var featureCount = 0
    @Published var processing = false
    @Published var scanning = false
    @Published var ready = false
    @Published var uploading = false
    @Published var rooms: [OwnedRoom] = []
    @Published var inspectionId = ""
    private(set) var view = RoomCaptureView(frame: .zero)
    let login = WKWebView()
    private let context = CIContext()
    private var timer: Timer?
    private var startTime: Double?
    private var lastTimestamp: Double = -1
    private var frames: [FrameRecord] = []
    private var assets: [Asset] = []
    private let splatBuilder = DepthSplatBuilder()
    private var manifest: Manifest?
    private(set) var directory: URL?
    override init() { super.init(); view.delegate = self; view.captureSession.delegate = self; view.isModelEnabled = false; restoreConnection() }
    required init?(coder: NSCoder) { super.init(); view.delegate = self; view.captureSession.delegate = self; view.isModelEnabled = false; restoreConnection() }
    nonisolated func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        let objects = room.objects.map { Element(id: $0.identifier.uuidString, category: String(describing: $0.category), dimensions: dimensions($0.dimensions), transform: matrix($0.transform)) }
        let surfaces = (room.walls + room.doors + room.floors).map { Element(id: $0.identifier.uuidString, category: String(describing: $0.category), dimensions: dimensions($0.dimensions), transform: matrix($0.transform)) }
        let elements = Array((objects + surfaces).prefix(80))
        let source = ObjectIdentifier(session)
        Task { @MainActor [weak self] in
            guard let self, self.scanning, ObjectIdentifier(self.view.captureSession) == source else { return }
            self.liveElements = elements
        }
    }
    func encode(with coder: NSCoder) {}
    /// A pairing owns its capture state. Retained files stay on disk, never in the next room.
    private func resetCaptureState() {
        connectionGeneration = UUID()
        liveVideo?.close(); liveVideo = nil; videoTimer?.invalidate(); videoTimer = nil
        videoStatus = "Video connects when scanning starts"
        timer?.invalidate(); timer = nil
        preUploadTask?.cancel(); preUploadTask = nil; pendingEvidence = nil
        replaceCaptureView()
        relocalizing = false
        scanning = false; processing = false; ready = false; uploading = false
        manifest = nil; directory = nil; frames = []; assets = []; inspectionId = ""
        startTime = nil; lastTimestamp = -1; frameCount = 0; depthCount = 0; featureCount = 0
        uploadComplete = false; uploadProgress = 0; liveElements = []
        liveFindings = []; damageEvidence = nil; damageEvidenceFindings = []
        evidenceRef = ""; evidenceLoading = false; liveEvidence = [:]
        damageCheckStatus = "Damage checks begin with the scan"
        marks = []; markCount = 0; markPulse = 0; motions = []
        preUploaded = [:]; sentDuringScan = 0; streamCursor = 0
        streamInFlight = false; progressInFlight = false
        splatBuilder.reset(); liveSplats = []; splatCount = 0; splatRevision += 1
        splatRenderError = ""; tracking = "Camera idle"
    }
    func prepareNewInspection() {
        guard uploadComplete, !scanning, !processing, !uploading, !pairing else { return }
        do { try CaptureConnectionStore.clear() }
        catch { status = "Could not prepare a new inspection. Retry after unlocking the phone."; return }
        resetCaptureState()
        connection = nil; pairedSession = ""; phoneToken = ""; continueFrom = ""
        status = "Start a new inspection on your laptop, then scan its QR code."
    }
    /// A fresh RoomPlan view. Pass an ARSession to run RoomPlan on it, keeping that session's coordinates.
    private func replaceCaptureView(arSession: ARSession? = nil) {
        view.delegate = nil; view.captureSession.delegate = nil; view.captureSession.arSession.pause()
        if let arSession { view = RoomCaptureView(frame: .zero, arSession: arSession) } else { view = RoomCaptureView(frame: .zero) }
        view.delegate = self; view.captureSession.delegate = self; view.isModelEnabled = false
        captureViewID = UUID()
    }
    func start() {
        guard !scanning, !relocalizing, !pairing, !uploading, !processing, !ready, !uploadComplete else { return }
        guard let connection, connection.paired, !connection.completed, connection.expiresAt > Date() else { status = "Scan a new inspection QR on your laptop first. No phone sign-in is required."; return }
        guard RoomCaptureSession.isSupported else { status = "RoomPlan requires a supported LiDAR iPhone or iPad."; return }
        if continueFrom.isEmpty { beginCapture() } else { Task { await relocalizeThenCapture() } }
    }
    func cancelRelocalizing() {
        guard relocalizing else { return }
        relocalizing = false; view.captureSession.arSession.pause(); tracking = "Camera idle"
        status = "Stopped looking. Tap Continue scan to try again."
    }
    /// Load the earlier scan's ARWorldMap and wait until ARKit recognises the room.
    /// RoomPlan then runs on the same ARSession, so everything new lands in the original coordinates.
    private func relocalizeThenCapture() async {
        let generation = connectionGeneration
        relocalizing = true
        defer { if generation == connectionGeneration { relocalizing = false } }
        status = "Loading the earlier scan…"
        let map: ARWorldMap
        do {
            var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(pairedSession)/worldmap")); request.timeoutInterval = 60
            request.setValue("Bearer \(phoneToken)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw httpFailure(response, data: data) }
            guard let decoded = try NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data) else { throw CocoaError(.fileReadCorruptFile) }
            map = decoded
        } catch { status = "Couldn't load the earlier scan. \(error.localizedDescription)"; return }
        guard generation == connectionGeneration, relocalizing else { return }
        let session = ARSession()
        replaceCaptureView(arSession: session)
        let configuration = ARWorldTrackingConfiguration()
        configuration.initialWorldMap = map
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) { configuration.frameSemantics.insert(.sceneDepth) }
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        status = "Point your phone at a part of the room you already scanned and move slowly."
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            guard generation == connectionGeneration, relocalizing else { return }
            guard let frame = session.currentFrame else { continue }
            switch frame.camera.trackingState {
            case .normal:
                // ARKit only reports normal tracking with an initial world map once it has relocalized.
                relocalizing = false
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                beginCapture()
                if scanning { status = "Found your room. Scan the new part; it joins the earlier scan on your laptop." }
                return
            case .limited(.relocalizing): tracking = "Looking for the part you scanned before…"
            case .limited(let reason): tracking = "Tracking limited: \(String(describing: reason))"
            case .notAvailable: tracking = "Camera starting…"
            }
        }
        session.pause(); tracking = "Camera idle"
        status = "Couldn't recognise the earlier scan. Stand where you scanned before, in similar light, and tap Continue scan again."
    }
    private func beginCapture() {
        do {
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            inspectionId = ""; manifest = nil; frameCount = 0; depthCount = 0; featureCount = 0; processing = false; directory = dir; frames = []; assets = []; startTime = nil; lastTimestamp = -1; ready = false
            uploadComplete = false; uploadProgress = 0
            if var saved = self.connection { saved.captureFolder = dir.lastPathComponent; try CaptureConnectionStore.save(saved); self.connection = saved }
            splatBuilder.reset(); liveSplats = []; splatCount = 0; splatRevision += 1
            marks = []; markCount = 0; liveFindings = []; damageEvidence = nil; damageEvidenceFindings = []; evidenceRef = ""; pendingEvidence = nil
            streamCursor = 0; preUploaded = [:]; preUploadTask = nil; liveEvidence = [:]; motions = []; sentDuringScan = 0
            view.captureSession.run(configuration: RoomCaptureSession.Configuration())
            // Read the current frame without replacing RoomPlan's ARSession delegate.
            timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in Task { @MainActor in self?.recordFrame() } }
            scanning = true
            startLiveVideo()
            status = "Move slowly. Capture surfaces from several angles. Stop within 120 seconds."
        } catch { status = "Could not create local capture directory." }
    }
    private func startLiveVideo() {
        liveVideo?.close(); videoTimer?.invalidate()
        let transport = NativeVideoStream(base: pairedBase, sessionID: pairedSession, token: phoneToken, servers: videoServers.isEmpty ? [["urls":"stun:stun.l.google.com:19302"]] : videoServers)
        let generation = connectionGeneration
        transport.onStatus = { [weak self] value in guard let self, self.connectionGeneration == generation else { return }; self.videoStatus = value }
        liveVideo = transport; transport.start()
        // Only copy the current AR buffer here. Evidence encoding and inference have their own cadence.
        videoTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 24, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.scanning, let frame = self.view.captureSession.arSession.currentFrame else { return }
                self.videoTick += 1
                self.liveVideo?.send(frame.capturedImage, timestamp: frame.timestamp, markers: self.videoTick % 4 == 0 ? self.videoMarkers(frame) : nil)
            }
        }
        if let videoTimer { RunLoop.main.add(videoTimer, forMode: .common) }
    }
    private func videoMarkers(_ frame: ARFrame) -> [[String: Any]] {
        let size = CGSize(width: 540, height: 960), inverse = simd_inverse(frame.camera.transform)
        func project(_ world: SIMD3<Float>) -> CGPoint? {
            let camera = inverse * SIMD4<Float>(world, 1)
            guard camera.z < -0.1 else { return nil }
            return frame.camera.projectPoint(world, orientation: .portrait, viewportSize: size)
        }
        var result: [[String: Any]] = []
        for item in liveElements.prefix(80) where !["wall","floor","door","window","opening"].contains(item.category.lowercased()) {
            guard item.transform.count == 16, item.dimensions.count == 3 else { continue }
            let t = simd_float4x4(columns: (SIMD4<Float>(item.transform[0...3]),SIMD4<Float>(item.transform[4...7]),SIMD4<Float>(item.transform[8...11]),SIMD4<Float>(item.transform[12...15])))
            var points: [CGPoint] = []
            for x: Float in [-0.5,0.5] { for y: Float in [-0.5,0.5] { for z: Float in [-0.5,0.5] {
                let world = t * SIMD4<Float>(x * item.dimensions[0],y * item.dimensions[1],z * item.dimensions[2],1)
                if let point = project(SIMD3<Float>(world.x,world.y,world.z)) { points.append(point) }
            } } }
            guard points.count == 8 else { continue }
            let left = max(0,points.map(\.x).min()! / size.width), right = min(1,points.map(\.x).max()! / size.width)
            let top = max(0,points.map(\.y).min()! / size.height), bottom = min(1,points.map(\.y).max()! / size.height)
            if right > left, bottom > top { result.append(["id":item.id,"kind":"object","label":item.category,"boundingBox":["x":left,"y":top,"width":right-left,"height":bottom-top]]) }
        }
        for finding in liveFindings where finding.reviewStatus != "rejected" {
            guard let p = finding.worldPosition, p.count == 3, let point = project(SIMD3<Float>(p)), point.x >= 0, point.y >= 0, point.x <= size.width, point.y <= size.height else { continue }
            result.append(["id":finding.id,"kind":"damage","label":finding.label,"point":["x":point.x / size.width,"y":point.y / size.height]])
        }
        return result
    }
    /// Mark whatever is under the centre crosshair. Scanning carries on; nothing resets.
    func markDamage() {
        guard scanning, let frame = view.captureSession.arSession.currentFrame, let dir = directory else { return }
        guard let point = centrePoint(frame) else { status = "Couldn't measure that spot. Move a little closer and mark again."; return }
        let original = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        let scale = min(1, 1600 / max(original.extent.width, original.extent.height))
        let image = original.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let jpeg = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.85]) else { return }
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let name = "mark-\(id).jpg"
        do { try jpeg.write(to: dir.appendingPathComponent(name)) } catch { status = "Couldn't save that mark."; return }
        let mark = PhoneMark(id: id, position: [point.x, point.y, point.z], timestamp: max(0, frame.timestamp - (startTime ?? frame.timestamp)), image: name)
        marks.append(mark); markCount = marks.count; markPulse += 1
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        status = "Marked. It shows up on your laptop in a few seconds."
        Task { _ = await sendMark(mark) }
    }
    /// LiDAR depth under the image centre (median of a small window), unprojected into the scan's world space.
    private func centrePoint(_ frame: ARFrame) -> SIMD3<Float>? {
        guard let depth = (frame.sceneDepth ?? frame.smoothedSceneDepth)?.depthMap else { return nil }
        CVPixelBufferLockBaseAddress(depth, .readOnly); defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(depth) else { return nil }
        let w = CVPixelBufferGetWidth(depth), h = CVPixelBufferGetHeight(depth), stride = CVPixelBufferGetBytesPerRow(depth)
        var values: [Float] = []
        for y in (h / 2 - 3)...(h / 2 + 3) {
            let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float.self)
            for x in (w / 2 - 3)...(w / 2 + 3) { let z = row[x]; if z.isFinite, z > 0.1, z < 8 { values.append(z) } }
        }
        guard !values.isEmpty else { return nil }
        let z = values.sorted()[values.count / 2]
        let k = frame.camera.intrinsics
        let u = Float(CVPixelBufferGetWidth(frame.capturedImage)) / 2, v = Float(CVPixelBufferGetHeight(frame.capturedImage)) / 2
        let p = frame.camera.transform * SIMD4<Float>((u - k.columns.2.x) * z / k.columns.0.x, -(v - k.columns.2.y) * z / k.columns.1.y, -z, 1)
        return SIMD3<Float>(p.x, p.y, p.z)
    }
    private func sendMark(_ mark: PhoneMark) async -> Bool {
        guard !pairedSession.isEmpty, let dir = directory, let jpeg = try? Data(contentsOf: dir.appendingPathComponent(mark.image)) else { return false }
        let boundary = "dwelld-\(UUID().uuidString)"
        var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(pairedSession)/marks")); request.httpMethod = "POST"; request.timeoutInterval = 60
        request.setValue("Bearer \(phoneToken)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let meta = (try? JSONSerialization.data(withJSONObject: ["observationId": mark.id, "position": mark.position, "timestampSeconds": mark.timestamp])) ?? Data()
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n".utf8)); body.append(meta)
        body.append(Data("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"mark.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8)); body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        request.httpBody = body
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return false }
            if let i = marks.firstIndex(where: { $0.id == mark.id }) { marks[i].sent = true }
            return true
        } catch { return false }
    }
    /// New LiDAR points and the latest RoomPlan furniture, about once a second, so the laptop builds the room live.
    private func publishStream() async {
        guard !pairedSession.isEmpty, !uploadComplete, !streamInFlight else { return }
        let generation = connectionGeneration
        streamInFlight = true; defer { if generation == connectionGeneration { streamInFlight = false } }
        let (data, next) = splatBuilder.packedNew(from: streamCursor, limit: 9000)
        var body: [String: Any] = ["points": data.base64EncodedString()]
        body["elements"] = liveElements.map { ["id": $0.id, "category": $0.category, "dimensions": $0.dimensions, "transform": $0.transform] as [String: Any] }
        var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(pairedSession)/stream")); request.httpMethod = "POST"; request.timeoutInterval = 10
        request.setValue("Bearer \(phoneToken)", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (_, response) = try await URLSession.shared.data(for: request)
            if generation == connectionGeneration, !uploadComplete, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) { streamCursor = next }
        } catch { /* The next tick resends from the same cursor. */ }
    }
    /// Downscaled evidence photo with intrinsics rescaled to the encoded size.
    private func makeEvidence(_ f: FrameRecord, dir: URL) throws -> FrameRecord {
        let name = "evidence-" + f.image
        guard let source = CIImage(contentsOf: dir.appendingPathComponent(f.image)) else { throw CocoaError(.fileReadCorruptFile) }
        let scale = min(1, 1600 / max(source.extent.width, source.extent.height))
        let image = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let jpeg = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.78]) else { throw CocoaError(.fileWriteUnknown) }
        try jpeg.write(to: dir.appendingPathComponent(name))
        guard let encoded = CIImage(data: jpeg) else { throw CocoaError(.fileReadCorruptFile) }
        let width = Int(encoded.extent.width), height = Int(encoded.extent.height)
        var intrinsics = f.intrinsics
        for column in 0..<3 { intrinsics[column * 3] *= Float(width) / Float(f.width); intrinsics[column * 3 + 1] *= Float(height) / Float(f.height) }
        return FrameRecord(timestamp: f.timestamp, image: name, depth: f.depth, confidence: f.confidence, width: width, height: height, depthWidth: f.depthWidth, depthHeight: f.depthHeight, intrinsics: intrinsics, transform: f.transform)
    }
    /// Uploads run one after another in the background while the scan continues.
    private func queueUpload(_ files: [(String, String)], analyse evidence: FrameRecord? = nil) {
        guard !pairedSession.isEmpty, let evidence else { return }
        // Keep only the newest pending view when the network is slower than capture.
        // All other one-second evidence photos are still retained in the final manifest.
        pendingEvidence = evidence
        guard preUploadTask == nil else { return }
        let generation = connectionGeneration
        preUploadTask = Task { [weak self] in
            guard let self else { return }
            defer { if generation == self.connectionGeneration { self.preUploadTask = nil } }
            while !Task.isCancelled, generation == self.connectionGeneration, !self.uploadComplete, let current = self.pendingEvidence {
                self.pendingEvidence = nil
                do {
                    if self.preUploaded[current.image] == nil {
                        let ref = try await self.uploadNow(current.image, contentType: "image/jpeg")
                        guard !Task.isCancelled, generation == self.connectionGeneration else { return }
                        self.preUploaded[current.image] = ref
                        self.sentDuringScan += 1
                    }
                    if let ref = self.preUploaded[current.image] { await self.requestAnalysis(current, ref: ref) }
                } catch { /* Retried when the complete capture is saved. */ }
            }
        }
    }
    private func refreshDamageEvidence() async {
        guard let latest = liveFindings.first, let ref = latest.evidenceFrameRef else {
            damageEvidence = nil; damageEvidenceFindings = []; evidenceRef = ""; return
        }
        guard !evidenceLoading else { return }
        let marks = liveFindings.filter { $0.evidenceFrameRef == ref }
        if evidenceRef == ref { damageEvidenceFindings = marks; return }
        let generation = connectionGeneration
        evidenceLoading = true; defer { if generation == connectionGeneration { evidenceLoading = false } }
        var parts = URLComponents(url: pairedBase.appendingPathComponent("api/live/\(pairedSession)/media"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "ref", value: ref)]
        guard let url = parts.url else { return }
        var request = URLRequest(url: url); request.setValue("Bearer \(phoneToken)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if generation == connectionGeneration, !uploadComplete, let http = response as? HTTPURLResponse, http.statusCode == 200, let image = UIImage(data: data), liveFindings.first?.evidenceFrameRef == ref {
                evidenceRef = ref; damageEvidence = image; damageEvidenceFindings = marks
            }
        } catch { /* Keep scanning if an evidence preview cannot load. */ }
    }
    func projectedDamage(_ finding: PhoneFinding, viewport: CGSize) -> CGPoint? {
        guard let p = finding.worldPosition, p.count == 3, let frame = view.captureSession.arSession.currentFrame else { return nil }
        let world = SIMD3<Float>(p[0], p[1], p[2])
        let camera = simd_inverse(frame.camera.transform) * SIMD4<Float>(world, 1)
        guard camera.z < -0.1 else { return nil }
        let point = frame.camera.projectPoint(world, orientation: view.window?.windowScene?.interfaceOrientation ?? .portrait, viewportSize: viewport)
        guard point.x >= 0, point.y >= 0, point.x <= viewport.width, point.y <= viewport.height else { return nil }
        return point
    }
    private func requestAnalysis(_ f: FrameRecord, ref: String) async {
        var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(pairedSession)/frame")); request.httpMethod = "POST"; request.timeoutInterval = 15
        request.setValue("Bearer \(phoneToken)", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["name": f.image, "ref": ref, "timestampSeconds": f.timestamp, "pose": ["transform": f.transform, "intrinsics": f.intrinsics, "width": f.width, "height": f.height]]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do { _ = try await URLSession.shared.data(for: request) } catch { /* Analysis also runs after saving. */ }
    }
    /// Camera movement between two consecutive frames: metres moved plus half the radians turned.
    private func motion(from previous: [Float]?, to current: simd_float4x4) -> Float {
        guard let p = previous, p.count == 16 else { return 0 }
        let moved = simd_distance(SIMD3<Float>(p[12], p[13], p[14]), SIMD3<Float>(current.columns.3.x, current.columns.3.y, current.columns.3.z))
        let before = SIMD3<Float>(-p[8], -p[9], -p[10]), after = -SIMD3<Float>(current.columns.2.x, current.columns.2.y, current.columns.2.z)
        let turned = acos(max(-1, min(1, simd_dot(simd_normalize(before), simd_normalize(after)))))
        return moved + turned * 0.5
    }
    private func uploadNow(_ name: String, contentType: String) async throws -> String {
        guard let dir = directory else { throw CocoaError(.fileNoSuchFile) }
        let data = try Data(contentsOf: dir.appendingPathComponent(name))
        let generation = connectionGeneration, token = phoneToken
        let path = "api/live/\(pairedSession)/upload", origin = pairedBase.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        func call(_ url: URL, method: String, body: Data, type: String) async throws -> Data {
            try Task.checkCancellation()
            guard generation == connectionGeneration, !uploadComplete else { throw CancellationError() }
            var req = URLRequest(url: url); req.httpMethod = method; req.httpBody = body; req.timeoutInterval = 60
            req.setValue(type, forHTTPHeaderField: "Content-Type"); req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization"); req.setValue(origin, forHTTPHeaderField: "Origin")
            let (out, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: out) }
            return out
        }
        let started = try JSONSerialization.jsonObject(with: try await call(pairedBase.appendingPathComponent(path), method: "POST", body: try JSONSerialization.data(withJSONObject: ["filename": name, "contentType": contentType, "size": data.count]), type: "application/json")) as? [String: Any]
        guard let id = started?["uploadId"] as? String, let chunk = started?["chunkSize"] as? Int, chunk > 0 else { throw CocoaError(.fileWriteUnknown) }
        var offset = 0
        while offset < data.count {
            let url = URL(string: "\(path)?uploadId=\(id)&part=\(offset / chunk)", relativeTo: pairedBase.appendingPathComponent("/"))!
            _ = try await call(url, method: "PATCH", body: data.subdata(in: offset..<min(data.count, offset + chunk)), type: "application/octet-stream")
            offset += chunk
        }
        let done = try JSONSerialization.jsonObject(with: try await call(pairedBase.appendingPathComponent(path), method: "POST", body: try JSONSerialization.data(withJSONObject: ["action": "complete", "uploadId": id]), type: "application/json")) as? [String: Any]
        guard let ref = done?["url"] as? String else { throw CocoaError(.fileWriteUnknown) }
        return ref
    }
    func stop() {
        guard scanning else { return }
        videoTimer?.invalidate(); videoTimer = nil
        timer?.invalidate(); timer = nil; scanning = false; processing = true
        status = "Saving where everything is, so you can continue this scan later…"
        guard let capture = view.captureSession else { processing = false; status = "The capture session is unavailable. Your local files are retained."; return }
        Task { @MainActor in
            await saveWorldMap(from: capture.arSession)
            capture.stop()
            if processing { status = "Processing measured room geometry…" }
        }
    }
    /// ARKit's map of the room. A later scan relocalizes into it to continue in the same coordinates.
    private func saveWorldMap(from session: ARSession) async {
        guard let dir = directory else { return }
        let map: ARWorldMap? = await withCheckedContinuation { continuation in
            session.getCurrentWorldMap { map, _ in continuation.resume(returning: map) }
        }
        guard let map else { return }
        do {
            let data = try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
            try data.write(to: dir.appendingPathComponent("room.arworldmap"), options: .atomic)
        } catch { /* The scan still saves; it just can't be continued later. */ }
    }
    private func recordFrame() {
        guard scanning, let frame = view.captureSession.arSession.currentFrame, let dir = directory, frame.timestamp != lastTimestamp else { return }
        switch frame.camera.trackingState {
        case .normal: tracking = "Tracking room"
        case .notAvailable: tracking = "Camera tracking unavailable"
        case .limited(let reason): tracking = "Tracking limited: \(String(describing: reason))"
        }
        featureCount = frame.rawFeaturePoints?.points.count ?? 0
        if frames.count >= 240 { stop(); return }
        if startTime == nil { startTime = frame.timestamp }
        lastTimestamp = frame.timestamp
        let index = String(format: "%04d", frames.count), imageName = "frame-\(index).jpg"
        do {
            splatBuilder.add(frame: frame)
            liveSplats = splatBuilder.preview(); splatCount = splatBuilder.count; splatRevision += 1
            let image = CIImage(cvPixelBuffer: frame.capturedImage)
            guard let jpeg = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [:]) else { return }
            try jpeg.write(to: dir.appendingPathComponent(imageName))
            assets.append(Asset(name: imageName, mediaRef: "", kind: "image"))
            let depthData = frame.sceneDepth ?? frame.smoothedSceneDepth
            var depthName: String?, confidenceName: String?
            if let depth = depthData {
                depthName = "depth-\(index).f32"; try writePixels(depth.depthMap, bytesPerPixel: 4, to: dir.appendingPathComponent(depthName!))
                assets.append(Asset(name: depthName!, mediaRef: "", kind: "depth"))
                if let confidence = depth.confidenceMap { confidenceName = "confidence-\(index).u8"; try writePixels(confidence, bytesPerPixel: 1, to: dir.appendingPathComponent(confidenceName!)); assets.append(Asset(name: confidenceName!, mediaRef: "", kind: "confidence")) }
            }
            motions.append(motion(from: frames.last?.transform, to: frame.camera.transform))
            frames.append(FrameRecord(timestamp: frame.timestamp - (startTime ?? frame.timestamp), image: imageName, depth: depthName, confidence: confidenceName, width: CVPixelBufferGetWidth(frame.capturedImage), height: CVPixelBufferGetHeight(frame.capturedImage), depthWidth: depthData.map { CVPixelBufferGetWidth($0.depthMap) }, depthHeight: depthData.map { CVPixelBufferGetHeight($0.depthMap) }, intrinsics: matrix(frame.camera.intrinsics), transform: matrix(frame.camera.transform)))
        frameCount = frames.count; depthCount = frames.filter { $0.depth != nil }.count
        if frameCount % 2 == 0 { Task { await publishProgress(stage: "scanning") } }
        if frameCount % 2 == 0 { Task { await publishStream() } }
        // Every second, send the steadier of the last two frames for continuous damage coverage.
        if !pairedSession.isEmpty, frames.count % 2 == 0 {
            let window = (frames.count - 2)..<frames.count
            if let index = window.min(by: { motions[$0] < motions[$1] }), let evidence = try? makeEvidence(frames[index], dir: dir) {
                liveEvidence[index] = evidence
                queueUpload([(evidence.image, "image/jpeg")], analyse: evidence)
            }
        }
        } catch { stop(); status = "Local evidence write failed. Capture stopped." }
    }
    private func writePixels(_ pixel: CVPixelBuffer, bytesPerPixel: Int, to url: URL) throws {
        CVPixelBufferLockBaseAddress(pixel, .readOnly); defer { CVPixelBufferUnlockBaseAddress(pixel, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixel) else { throw CocoaError(.fileWriteUnknown) }
        var data = Data(); let width = CVPixelBufferGetWidth(pixel), stride = CVPixelBufferGetBytesPerRow(pixel)
        for row in 0..<CVPixelBufferGetHeight(pixel) { data.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: width * bytesPerPixel) }
        try data.write(to: url)
    }
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        guard scanning || processing else { return false }
        videoTimer?.invalidate(); videoTimer = nil
        timer?.invalidate(); timer = nil; scanning = false; processing = true
        if let error { processing = false; status = "Room scan stopped: \(error.localizedDescription). Start a new scan in good light."; return false }
        status = "Processing measured room geometry…"; return true
    }
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        guard processing else { return }
        processing = false
        guard error == nil, let dir = directory else { status = "RoomPlan could not finish this scan."; return }
        do {
            try processedResult.export(to: dir.appendingPathComponent("room.usdz"), exportOptions: .parametric)
            // Keep the parametric export locally; the default cloud scene is a compact splat.
            if try splatBuilder.write(to: dir.appendingPathComponent("room-preview.ply")) {
                assets.append(Asset(name: "room-preview.ply", mediaRef: "", kind: "splat", registration: Registration(sessionId: processedResult.identifier.uuidString), reconstructionMethod: "lidar-initialized"))
            }
            let surfaces = processedResult.walls + processedResult.doors + processedResult.windows + processedResult.openings + processedResult.floors
            let elements = surfaces.map { Element(id: $0.identifier.uuidString, category: String(describing: $0.category), dimensions: dimensions($0.dimensions), transform: matrix($0.transform)) } + processedResult.objects.map { Element(id: $0.identifier.uuidString, category: String(describing: $0.category), dimensions: dimensions($0.dimensions), transform: matrix($0.transform)) }
            // Retain the full calibrated capture on the phone for later training/export.
            let original = Manifest(sessionId: processedResult.identifier.uuidString, elements: elements, frames: frames, assets: assets + [Asset(name: "room.usdz", mediaRef: "", kind: "usdz")])
            try JSONEncoder().encode(original).write(to: dir.appendingPathComponent("original-manifest.json"))
            // Preserve every one-second evidence photo, plus sparse depth samples.
            let count = min(16, frames.count)
            let sentKeys = liveEvidence.keys.sorted()
            let fallback = count > 1 ? (0..<count).map { $0 * (frames.count - 1) / (count - 1) } : Array(0..<count)
            let indices = Array(Set(sentKeys + fallback)).sorted()
            var evidence: [FrameRecord] = []
            var cloudAssets = assets.filter { $0.kind == "splat" }
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("room.arworldmap").path) {
                cloudAssets.append(Asset(name: "room.arworldmap", mediaRef: "", kind: "worldmap"))
            }
            for i in indices {
                let f = frames[i]
                let sampled = try liveEvidence[i] ?? makeEvidence(f, dir: dir)
                // Dense RGB evidence; keep depth uploads sparse to avoid blocking damage feedback.
                let keepDepth = fallback.contains(i)
                let record = FrameRecord(timestamp: sampled.timestamp, image: sampled.image, depth: keepDepth ? sampled.depth : nil, confidence: keepDepth ? sampled.confidence : nil, width: sampled.width, height: sampled.height, depthWidth: keepDepth ? sampled.depthWidth : nil, depthHeight: keepDepth ? sampled.depthHeight : nil, intrinsics: sampled.intrinsics, transform: sampled.transform)
                evidence.append(record)
                cloudAssets.append(Asset(name: record.image, mediaRef: preUploaded[record.image] ?? "", kind: "image"))
                cloudAssets.append(contentsOf: assets.filter { keepDepth && ($0.name == f.depth || $0.name == f.confidence) }.map { a in var a = a; a.mediaRef = preUploaded[a.name] ?? ""; return a })
            }
            manifest = Manifest(sessionId: processedResult.identifier.uuidString, elements: elements, frames: evidence, assets: cloudAssets)
            try JSONEncoder().encode(manifest).write(to: dir.appendingPathComponent("manifest.json"))
            ready = true; status = "Ready: \(evidence.count) evidence samples and \(splatBuilder.count) LiDAR splats. Full-resolution capture stays on this phone."
            if !pairedSession.isEmpty { Task { await savePairedCapture() } }
        } catch { status = "Could not export the captured geometry. Local evidence is retained." }
    }
    private func httpFailure(_ response: URLResponse, data: Data) -> NSError {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = (body?["error"] as? String).map { String($0.prefix(240)) } ?? "Request failed"
        return NSError(domain: "Dwelld", code: code, userInfo: [NSLocalizedDescriptionKey: "HTTP \(code): \(message)"])
    }
    func createRoom(base: URL, name: String) async {
        do { _ = try await accountRequest(base: base, path: "api/rooms", method: "POST", body: ["name": name]); await loadRooms(base: base) }
        catch { status = "Create room: \(error.localizedDescription)" }
    }
    private func accountRequest(base: URL, path: String, method: String = "GET", body: [String: String]? = nil) async throws -> Data {
        guard base.scheme == "https" else { throw CocoaError(.fileReadNoPermission) }
        let cookies = await login.configuration.websiteDataStore.httpCookieStore.allCookies()
        var req = URLRequest(url: base.appendingPathComponent(path)); req.httpMethod = method
        req.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        for (key, value) in HTTPCookie.requestHeaderFields(with: cookies.filter { base.host == $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) || base.host?.hasSuffix("." + $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) == true }) { req.setValue(value, forHTTPHeaderField: key) }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: data) }
        return data
    }
    func loadRooms(base: URL) async {
        do { struct Response: Decodable { let rooms: [OwnedRoom] }; rooms = try JSONDecoder().decode(Response.self, from: await accountRequest(base: base, path: "api/rooms")).rooms; status = rooms.isEmpty ? "Create a room in Dwelld first, then refresh rooms." : "Choose your room and inspection type." }
        catch { status = "Load rooms: \(error.localizedDescription). Sign in again if your session expired." }
    }
    func createInspection(base: URL, roomId: String, type: String) async {
        do { let data = try await accountRequest(base: base, path: "api/spatial/inspections", method: "POST", body: ["roomId": roomId, "inspectionType": type]); let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]; inspectionId = result?["inspectionId"] as? String ?? ""; if inspectionId.isEmpty { throw CocoaError(.fileReadCorruptFile) } }
        catch { status = "Create inspection: \(error.localizedDescription)" }
    }
    func upload(base: URL, roomId: String, type: String) async {
        guard !uploading, var m = manifest, let dir = directory else { status = "Finish a scan before uploading."; return }
        guard !pairedSession.isEmpty else { status = "Scan your laptop inspection QR to connect before saving. No phone sign-in is required."; return }
        guard !uploadComplete else { status = "This inspection is already saved."; return }
        uploading = true
        status = "Preparing your saved scan…"
        pendingEvidence = nil
        preUploadTask?.cancel()
        UIApplication.shared.isIdleTimerDisabled = true
        defer { uploading = false; UIApplication.shared.isIdleTimerDisabled = false }
        if inspectionId.isEmpty && pairedSession.isEmpty { await createInspection(base: base, roomId: roomId, type: type) }
        guard !inspectionId.isEmpty || !pairedSession.isEmpty else { return }
        let inspectionId = self.inspectionId
        let base = pairedSession.isEmpty ? base : pairedBase
        let uploadPath = pairedSession.isEmpty ? "api/uploads" : "api/live/\(pairedSession)/upload"
        await publishProgress(stage: "uploading")
        guard base.scheme == "https" else { status = "Use your HTTPS deployment for authenticated capture upload."; return }
        let cookies = await login.configuration.websiteDataStore.httpCookieStore.allCookies()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 120
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var cookieHeader = HTTPCookie.requestHeaderFields(with: cookies.filter { base.host == $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) || base.host?.hasSuffix("." + $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) == true })
        if !pairedSession.isEmpty { cookieHeader = ["Authorization": "Bearer \(phoneToken)"] }
        func finishSaved(_ id: String?) {
            if let id, !id.isEmpty { self.inspectionId = id }
            uploadComplete = true; uploadProgress = 1
            if var saved = connection { saved.completed = true; connection = saved }
            try? CaptureConnectionStore.clear()
            timer?.invalidate(); timer = nil; pendingEvidence = nil; preUploadTask?.cancel()
            view.captureSession.arSession.pause(); liveVideo?.close(); liveVideo = nil; videoTimer?.invalidate(); videoTimer = nil
            status = "Saved to your laptop inspection. You can close Dwelld."
        }
        func checkRemoteSave() async -> Bool {
            var check = URLRequest(url: base.appendingPathComponent("api/live/\(self.pairedSession)"))
            check.timeoutInterval = 10
            check.setValue("Bearer \(self.phoneToken)", forHTTPHeaderField: "Authorization")
            do {
                let (data, response) = try await URLSession.shared.data(for: check)
                guard !Task.isCancelled else { return false }
                if let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let remote = body["session"] as? [String: Any], remote["status"] as? String == "saved" {
                    finishSaved(remote["inspectionId"] as? String); return true
                }
            } catch { /* The upload itself reports connection failures. */ }
            return false
        }
        // Recover a lost final response without waiting for stalled asset requests.
        let completionWatch = Task { @MainActor in
            while !Task.isCancelled && self.uploading && !self.uploadComplete {
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
                if await checkRemoteSave() {
                    self.preUploadTask?.cancel(); session.invalidateAndCancel(); return
                }
            }
        }
        defer { completionWatch.cancel() }
        func request(_ path: String, method: String = "POST", data: Data, type: String = "application/json") async throws -> [String: Any] {
            var req = URLRequest(url: base.appendingPathComponent(path)); req.httpMethod = method; req.httpBody = data; req.setValue(type, forHTTPHeaderField: "Content-Type"); req.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
            for (key, value) in cookieHeader { req.setValue(value, forHTTPHeaderField: key) }
            let (body, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: body) }
            return (try JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        }
        do {
            if await checkRemoteSave() { return }
            await preUploadTask?.value
            if uploadComplete { return }
            for i in m.assets.indices where !m.assets[i].mediaRef.hasPrefix("gridfs:") { if let ref = preUploaded[m.assets[i].name] { m.assets[i].mediaRef = ref } }
            await publishStream()
            if uploadComplete { return }
            let pending = m.assets.indices.filter { !m.assets[$0].mediaRef.hasPrefix("gridfs:") }
            let totalBytes = m.assets.reduce(0) { sum, asset in sum + ((try? dir.appendingPathComponent(asset.name).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
            var completedCount = m.assets.count - pending.count
            uploadProgress = Double(completedCount) / Double(max(1, m.assets.count))
            status = "Saving to your laptop inspection… Keep Dwelld open."
            // Four independent assets at a time. Chunks within each asset remain ordered.
            var uploadError: Error?
            await withTaskGroup(of: Result<(Int, String), Error>.self) { group in
                var next = 0
                func enqueue(_ i: Int) {
                    let asset = m.assets[i]
                    group.addTask { @MainActor in
                        do {
                let data = try Data(contentsOf: dir.appendingPathComponent(asset.name)), contentType = asset.kind == "image" ? "image/jpeg" : asset.kind == "usdz" ? "model/vnd.usdz+zip" : "application/octet-stream"
                let initData = try JSONSerialization.data(withJSONObject: ["filename": asset.name, "contentType": contentType, "size": data.count])
                let upload = try await request(uploadPath, data: initData)
                guard let id = upload["uploadId"] as? String, let chunkSize = upload["chunkSize"] as? Int else { throw CocoaError(.fileWriteUnknown) }
                for offset in stride(from: 0, to: data.count, by: chunkSize) {
                    var req = URLRequest(url: URL(string: "\(uploadPath)?uploadId=\(id)&part=\(offset / chunkSize)", relativeTo: base.appendingPathComponent("/"))!); req.httpMethod = "PATCH"; req.httpBody = data.subdata(in: offset..<min(data.count, offset + chunkSize)); req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type"); req.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin"); for (key, value) in cookieHeader { req.setValue(value, forHTTPHeaderField: key) }
                    let (responseBody, response) = try await session.data(for: req); guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw self.httpFailure(response, data: responseBody) }
                }
                let completed = try await request(uploadPath, data: JSONSerialization.data(withJSONObject: ["action": "complete", "uploadId": id]))
                        guard let ref = completed["url"] as? String else { throw CocoaError(.fileWriteUnknown) }
                        return .success((i, ref))
                        } catch { return .failure(error) }
                    }
                }
                while next < min(4, pending.count) { enqueue(pending[next]); next += 1 }
                for await result in group {
                    if uploadComplete { group.cancelAll(); continue }
                    guard case .success(let (i, ref)) = result else {
                        if case .failure(let error) = result { uploadError = error }; continue
                    }
                    m.assets[i].mediaRef = ref; manifest = m; completedCount += 1
                    do { try JSONEncoder().encode(m).write(to: dir.appendingPathComponent("manifest.json"), options: .atomic) } catch { uploadError = error }
                    uploadProgress = Double(completedCount) / Double(max(1, m.assets.count))
                    status = "Sending to your laptop · \(completedCount) of \(m.assets.count)"
                    Task { await self.publishProgress(stage: "uploading") }
                    if uploadError == nil, next < pending.count { enqueue(pending[next]); next += 1 }
                }
            }
            if uploadComplete { return }
            if let uploadError { throw uploadError }
            for mark in marks where !mark.sent {
                status = "Saving a marked damage photo… Your room files have uploaded."
                _ = await sendMark(mark)
            }
            status = "Confirming your saved room…"
            let saved = try await request(pairedSession.isEmpty ? "api/inspections/\(inspectionId)/spatial" : "api/live/\(pairedSession)/spatial", data: JSONEncoder().encode(m))
            finishSaved(saved["inspectionId"] as? String); manifest = m
        } catch {
            if !uploadComplete, !(await checkRemoteSave()) { status = "Upload: \(error.localizedDescription). Local capture is retained; tap Retry save to resume." }
        }
    }
}

/// A bounded, depth-initialized Gaussian preview, not a photometrically trained reconstruction.
/// Every center and color comes from a high-confidence LiDAR sample and its calibrated RGB frame.
private final class DepthSplatBuilder {
    private struct Sample { let point: SIMD3<Float>; let color: SIMD3<Float>; let radius: Float }
    private var samples: [SIMD3<Int32>: Sample] = [:]
    private var order: [SIMD3<Int32>] = []
    var count: Int { samples.count }
    func reset() { samples.removeAll(keepingCapacity: true); order.removeAll(keepingCapacity: true) }
    var streamed: Int { order.count }
    /// Points added since `from`, packed as Int16 x,y,z (mm) + UInt8 r,g,b. Returns the new cursor.
    func packedNew(from: Int, limit: Int) -> (Data, Int) {
        let end = min(order.count, from + limit)
        guard from < end else { return (Data(), from) }
        var data = Data(); data.reserveCapacity((end - from) * 9)
        for cell in order[from..<end] {
            guard let sample = samples[cell] else { continue }
            for value in [sample.point.x, sample.point.y, sample.point.z] { var q = Int16(clamping: Int((value * 1000).rounded())).littleEndian; withUnsafeBytes(of: &q) { data.append(contentsOf: $0) } }
            for channel in [sample.color.x, sample.color.y, sample.color.z] { data.append(UInt8(max(0, min(255, (channel * 255).rounded())))) }
        }
        return (data, end)
    }
    func add(frame: ARFrame) {
        guard case .normal = frame.camera.trackingState,
              let depth = frame.sceneDepth ?? frame.smoothedSceneDepth,
              let confidence = depth.confidenceMap else { return }
        let map = depth.depthMap, rgb = frame.capturedImage
        guard CVPixelBufferGetPlaneCount(rgb) == 2 else { return }
        for buffer in [map, confidence, rgb] { CVPixelBufferLockBaseAddress(buffer, .readOnly) }
        defer { for buffer in [map, confidence, rgb] { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) } }
        guard let db = CVPixelBufferGetBaseAddress(map), let cb = CVPixelBufferGetBaseAddress(confidence),
              let yb = CVPixelBufferGetBaseAddressOfPlane(rgb, 0), let uvb = CVPixelBufferGetBaseAddressOfPlane(rgb, 1) else { return }
        let width = CVPixelBufferGetWidth(map), height = CVPixelBufferGetHeight(map)
        let rgbWidth = CVPixelBufferGetWidth(rgb), rgbHeight = CVPixelBufferGetHeight(rgb)
        let k = frame.camera.intrinsics, transform = frame.camera.transform
        let sx = Float(rgbWidth) / Float(width), sy = Float(rgbHeight) / Float(height)
        let videoRange = CVPixelBufferGetPixelFormatType(rgb) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        for y in stride(from: 1, to: height - 1, by: 3) {
            let row = db.advanced(by: y * CVPixelBufferGetBytesPerRow(map)).assumingMemoryBound(to: Float.self)
            let confidenceRow = cb.advanced(by: y * CVPixelBufferGetBytesPerRow(confidence)).assumingMemoryBound(to: UInt8.self)
            for x in stride(from: 1, to: width - 1, by: 3) {
                let z = row[x]
                guard confidenceRow[x] == 2, z.isFinite, z > 0.2, z < 6 else { continue }
                // Avoid spreading foreground colors across depth discontinuities.
                guard abs(row[x - 1] - z) < 0.08, abs(row[x + 1] - z) < 0.08 else { continue }
                let u = (Float(x) + 0.5) * sx, v = (Float(y) + 0.5) * sy
                let p = transform * SIMD4<Float>((u - k.columns.2.x) * z / k.columns.0.x, -(v - k.columns.2.y) * z / k.columns.1.y, -z, 1)
                let point = SIMD3<Float>(p.x, p.y, p.z)
                guard point.x.isFinite, point.y.isFinite, point.z.isFinite else { continue }
                let cell = SIMD3<Int32>(Int32(floor(point.x / 0.025)), Int32(floor(point.y / 0.025)), Int32(floor(point.z / 0.025)))
                guard samples[cell] == nil, samples.count < 150000 else { continue }
                let px = min(rgbWidth - 1, Int(u)), py = min(rgbHeight - 1, Int(v))
                let rawY = Float(yb.advanced(by: py * CVPixelBufferGetBytesPerRowOfPlane(rgb, 0) + px).load(as: UInt8.self))
                let uv = uvb.advanced(by: (py / 2) * CVPixelBufferGetBytesPerRowOfPlane(rgb, 1) + (px / 2) * 2).assumingMemoryBound(to: UInt8.self)
                let luma = videoRange ? (rawY - 16) / 219 : rawY / 255
                let chromaScale: Float = videoRange ? 224 : 255
                let blue = (Float(uv[0]) - 128) / chromaScale, red = (Float(uv[1]) - 128) / chromaScale
                let color = SIMD3<Float>(luma + 1.402 * red, luma - 0.344136 * blue - 0.714136 * red, luma + 1.772 * blue)
                order.append(cell)
                samples[cell] = Sample(point: point, color: simd_clamp(color, SIMD3<Float>(repeating: 0), SIMD3<Float>(repeating: 1)), radius: min(0.035, max(0.008, z * sx * 1.2 / k.columns.0.x)))
            }
        }
    }
    func preview() -> [LiveGaussian] {
        // Rendering uses a bounded subset; the export keeps the complete accumulated preview.
        let step = max(1, Int(ceil(Double(samples.count) / 40000)))
        return samples.values.enumerated().compactMap { index, sample in
            guard index % step == 0 else { return nil }
            return LiveGaussian(centerRadius: SIMD4<Float>(sample.point.x, sample.point.y, sample.point.z, sample.radius), color: SIMD4<Float>(sample.color.x, sample.color.y, sample.color.z, 0.9))
        }
    }
    /// Compact stream for the laptop: per point Int16 x,y,z in millimetres then UInt8 r,g,b.
    func packed(limit: Int) -> Data {
        let step = max(1, Int(ceil(Double(samples.count) / Double(max(1, limit)))))
        var data = Data(); data.reserveCapacity(min(samples.count, limit) * 9 + 9)
        for (index, sample) in samples.values.enumerated() where index % step == 0 {
            for value in [sample.point.x, sample.point.y, sample.point.z] {
                var q = Int16(clamping: Int((value * 1000).rounded())).littleEndian
                withUnsafeBytes(of: &q) { data.append(contentsOf: $0) }
            }
            for channel in [sample.color.x, sample.color.y, sample.color.z] { data.append(UInt8(max(0, min(255, (channel * 255).rounded())))) }
        }
        return data
    }
    func write(to url: URL) throws -> Bool {
        guard !samples.isEmpty else { return false }
        let step = max(1, Int(ceil(Double(samples.count) / 90000)))
        let chosen = samples.values.enumerated().compactMap { $0.offset % step == 0 ? $0.element : nil }
        let fields = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
        var data = Data(("ply\nformat binary_little_endian 1.0\ncomment Dwelld LiDAR-initialized preview; not photometrically optimized\nelement vertex \(chosen.count)\n" + fields.map { "property float \($0)\n" }.joined() + "end_header\n").utf8)
        data.reserveCapacity(data.count + chosen.count * 56)
        for sample in chosen {
            let dc = (sample.color - SIMD3<Float>(repeating: 0.5)) / 0.2820947918
            let scale = log(sample.radius)
            let values: [Float] = [sample.point.x, sample.point.y, sample.point.z, dc.x, dc.y, dc.z, 2.2, scale, scale, scale, 1, 0, 0, 0]
            for value in values { var bits = value.bitPattern.littleEndian; withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) } }
        }
        try data.write(to: url, options: .atomic)
        return true
    }
}

private struct CaptureConnection: Codable {
    let session: String
    let phone: String
    let device: String
    var pairingToken: String
    var paired = false
    var expiresAt = Date().addingTimeInterval(2 * 60 * 60)
    var captureFolder: String?
    var completed = false
    var continueFrom: String?
}
private enum CaptureConnectionStore {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.dwelld.capture.pairing", kSecAttrAccount as String: "current-inspection"] }
    static func clear() throws {
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw NSError(domain: "Dwelld", code: Int(result)) }
    }
    static func load() -> CaptureConnection? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(CaptureConnection.self, from: data)
    }
    static func save(_ connection: CaptureConnection) throws {
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(connection), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        let result = update == errSecItemNotFound ? SecItemAdd(query.merging(attributes) { _, value in value } as CFDictionary, nil) : update
        guard result == errSecSuccess else { throw NSError(domain: "Dwelld", code: Int(result), userInfo: [NSLocalizedDescriptionKey: "Could not save the secure phone connection. Unlock the phone and retry."]) }
    }
}
