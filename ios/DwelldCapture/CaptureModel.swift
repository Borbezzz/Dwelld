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
struct Manifest: Codable { var version = 1; let sessionId: String; var coordinateSystem = "arkit-right-handed-y-up-metres"; var elements: [Element]; var frames: [FrameRecord]; var assets: [Asset] }

@MainActor final class CaptureModel: NSObject, ObservableObject, @preconcurrency RoomCaptureViewDelegate {
    @Published var status = "Start an inspection on your laptop, then scan its QR code to connect this phone."
    @Published var pairedSession = ""
    @Published var pairing = false
    @Published var uploadComplete = false
    @Published var uploadProgress: Double = 0
    private var connection: CaptureConnection?
    private var phoneToken = ""
    private var progressInFlight = false
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
            var claim = connection?.session == session ? connection! : CaptureConnection(session: session, phone: UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: ""), device: UUID().uuidString, pairingToken: token)
            claim.pairingToken = token
            try CaptureConnectionStore.save(claim); connection = claim
            var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(session)/pair")); request.httpMethod = "POST"; request.timeoutInterval = 30; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["pairingToken": token, "phoneToken": claim.phone, "deviceId": claim.device])
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: data) }
            let body = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let remote = body?["session"] as? [String: Any]
            claim.paired = true
            if let expiry = remote?["expiresAt"] as? String { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; claim.expiresAt = formatter.date(from: expiry) ?? claim.expiresAt }
            if remote?["status"] as? String == "saved" { claim.completed = true }
            try CaptureConnectionStore.save(claim); connection = claim
            if changesSession { ready = false; manifest = nil; directory = nil; uploadProgress = 0 }
            phoneToken = claim.phone; pairedSession = session; uploadComplete = claim.completed
            if !ready { inspectionId = "" }
            status = uploadComplete ? "Inspection already saved. Start a new inspection on your laptop for another scan." : "Connected. Finish & save sends your scan to the laptop automatically."
            if !uploadComplete { await publishProgress(stage: "ready") }
        } catch { status = "Could not connect. Scan the same QR again to retry. \(error.localizedDescription)" }
    }
    private func restoreConnection() {
        guard let saved = CaptureConnectionStore.load() else { return }
        connection = saved; uploadComplete = saved.completed
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
        guard !pairedSession.isEmpty, !progressInFlight else { return }; progressInFlight = true; defer { progressInFlight = false }
        do {
            var request = URLRequest(url: pairedBase.appendingPathComponent("api/live/\(pairedSession)/spatial")); request.httpMethod = "PUT"; request.timeoutInterval = 10
            request.setValue("Bearer \(phoneToken)", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var progress: [String: Any] = ["stage": stage, "frames": frameCount, "depthFrames": depthCount]
            if scanning, let frame = view.captureSession.arSession.currentFrame {
                let original = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
                let scale = min(1, 480 / original.extent.width)
                let image = original.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                if let jpeg = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.5]), jpeg.count < 130000 { progress["preview"] = "data:image/jpeg;base64," + jpeg.base64EncodedString() }
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: progress)
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 200, let body = try JSONSerialization.jsonObject(with: data) as? [String: Any], body["stopRequested"] as? Bool == true, scanning { stop() }
        } catch { /* Capture continues locally if the laptop connection drops. */ }
    }
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
    let view = RoomCaptureView(frame: .zero)
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
    override init() { super.init(); view.delegate = self; restoreConnection() }
    required init?(coder: NSCoder) { super.init(); view.delegate = self; restoreConnection() }
    func encode(with coder: NSCoder) {}
    func start() {
        guard !pairing, !uploading, !processing, !ready || uploadComplete else { return }
        guard let connection, connection.paired, !connection.completed, connection.expiresAt > Date() else { status = "Scan a new inspection QR on your laptop first. No phone sign-in is required."; return }
        guard RoomCaptureSession.isSupported else { status = "RoomPlan requires a supported LiDAR iPhone or iPad."; return }
        do {
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            inspectionId = ""; manifest = nil; frameCount = 0; depthCount = 0; featureCount = 0; processing = false; directory = dir; frames = []; assets = []; startTime = nil; lastTimestamp = -1; ready = false
            uploadComplete = false; uploadProgress = 0
            if var saved = self.connection { saved.captureFolder = dir.lastPathComponent; try CaptureConnectionStore.save(saved); self.connection = saved }
            splatBuilder.reset()
            view.captureSession.run(configuration: RoomCaptureSession.Configuration())
            // Read the current frame without replacing RoomPlan's ARSession delegate.
            timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in Task { @MainActor in self?.recordFrame() } }
            scanning = true; status = "Move slowly. Capture surfaces from several angles. Stop within 120 seconds."
        } catch { status = "Could not create local capture directory." }
    }
    func stop() { timer?.invalidate(); timer = nil; scanning = false; processing = true; view.captureSession.stop(); status = "Processing measured room geometry…" }
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
            frames.append(FrameRecord(timestamp: frame.timestamp - (startTime ?? frame.timestamp), image: imageName, depth: depthName, confidence: confidenceName, width: CVPixelBufferGetWidth(frame.capturedImage), height: CVPixelBufferGetHeight(frame.capturedImage), depthWidth: depthData.map { CVPixelBufferGetWidth($0.depthMap) }, depthHeight: depthData.map { CVPixelBufferGetHeight($0.depthMap) }, intrinsics: matrix(frame.camera.intrinsics), transform: matrix(frame.camera.transform)))
        frameCount = frames.count; depthCount = frames.filter { $0.depth != nil }.count
        if frameCount % 4 == 0 { Task { await publishProgress(stage: "scanning") } }
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
        timer?.invalidate(); timer = nil; scanning = false
        if let error { processing = false; status = "Room scan stopped: \(error.localizedDescription). Start a new scan in good light."; return false }
        status = "Processing measured room geometry…"; return true
    }
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
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
            // Twenty-four evenly spaced evidence samples bound upload cost without changing their timestamps.
            let count = min(24, frames.count)
            let indices = count > 1 ? (0..<count).map { $0 * (frames.count - 1) / (count - 1) } : Array(0..<count)
            var evidence: [FrameRecord] = []
            var cloudAssets = assets.filter { $0.kind == "splat" }
            for i in indices {
                let f = frames[i], name = "evidence-" + f.image
                guard let source = CIImage(contentsOf: dir.appendingPathComponent(f.image)) else { throw CocoaError(.fileReadCorruptFile) }
                let scale = min(1, 1280 / max(source.extent.width, source.extent.height))
                let image = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                guard let jpeg = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.78]) else { throw CocoaError(.fileWriteUnknown) }
                try jpeg.write(to: dir.appendingPathComponent(name))
                // Use the actual encoded dimensions when updating the camera calibration.
                guard let encoded = CIImage(data: jpeg) else { throw CocoaError(.fileReadCorruptFile) }
                let width = Int(encoded.extent.width), height = Int(encoded.extent.height)
                var intrinsics = f.intrinsics
                for column in 0..<3 { intrinsics[column * 3] *= Float(width) / Float(f.width); intrinsics[column * 3 + 1] *= Float(height) / Float(f.height) }
                evidence.append(FrameRecord(timestamp: f.timestamp, image: name, depth: f.depth, confidence: f.confidence, width: width, height: height, depthWidth: f.depthWidth, depthHeight: f.depthHeight, intrinsics: intrinsics, transform: f.transform))
                cloudAssets.append(Asset(name: name, mediaRef: "", kind: "image"))
                cloudAssets.append(contentsOf: assets.filter { $0.name == f.depth || $0.name == f.confidence })
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
        configuration.timeoutIntervalForRequest = 60; configuration.timeoutIntervalForResource = 600
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var cookieHeader = HTTPCookie.requestHeaderFields(with: cookies.filter { base.host == $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) || base.host?.hasSuffix("." + $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) == true })
        if !pairedSession.isEmpty { cookieHeader = ["Authorization": "Bearer \(phoneToken)"] }
        func request(_ path: String, method: String = "POST", data: Data, type: String = "application/json") async throws -> [String: Any] {
            var req = URLRequest(url: base.appendingPathComponent(path)); req.httpMethod = method; req.httpBody = data; req.setValue(type, forHTTPHeaderField: "Content-Type"); req.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
            for (key, value) in cookieHeader { req.setValue(value, forHTTPHeaderField: key) }
            let (body, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: body) }
            return (try JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        }
        do {
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
                    guard case .success(let (i, ref)) = result else {
                        if case .failure(let error) = result { uploadError = error }; continue
                    }
                    m.assets[i].mediaRef = ref; manifest = m; completedCount += 1
                    do { try JSONEncoder().encode(m).write(to: dir.appendingPathComponent("manifest.json"), options: .atomic) } catch { uploadError = error }
                    uploadProgress = Double(completedCount) / Double(max(1, m.assets.count))
                    status = "Uploading \(completedCount)/\(m.assets.count) files · \(totalBytes / 1024 / 1024) MB total"
                    if uploadError == nil, next < pending.count { enqueue(pending[next]); next += 1 }
                }
            }
            if let uploadError { throw uploadError }
            _ = try await request(pairedSession.isEmpty ? "api/inspections/\(inspectionId)/spatial" : "api/live/\(pairedSession)/spatial", data: JSONEncoder().encode(m))
            uploadComplete = true; uploadProgress = 1
            if var saved = connection { saved.completed = true; connection = saved; try CaptureConnectionStore.save(saved) }
            status = "Saved to your laptop inspection. You can close Dwelld."; manifest = m
        } catch { status = "Upload: \(error.localizedDescription). Local capture is retained; retry resumes saved assets." }
    }
}

/// A bounded, depth-initialized Gaussian preview, not a photometrically trained reconstruction.
/// Every center and color comes from a high-confidence LiDAR sample and its calibrated RGB frame.
private final class DepthSplatBuilder {
    private struct Sample { let point: SIMD3<Float>; let color: SIMD3<Float>; let radius: Float }
    private var samples: [SIMD3<Int32>: Sample] = [:]
    var count: Int { samples.count }
    func reset() { samples.removeAll(keepingCapacity: true) }
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
                samples[cell] = Sample(point: point, color: simd_clamp(color, SIMD3<Float>(repeating: 0), SIMD3<Float>(repeating: 1)), radius: min(0.035, max(0.008, z * sx * 1.2 / k.columns.0.x)))
            }
        }
    }
    func write(to url: URL) throws -> Bool {
        guard !samples.isEmpty else { return false }
        let fields = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
        var data = Data(("ply\nformat binary_little_endian 1.0\ncomment Dwelld LiDAR-initialized preview; not photometrically optimized\nelement vertex \(samples.count)\n" + fields.map { "property float \($0)\n" }.joined() + "end_header\n").utf8)
        data.reserveCapacity(data.count + samples.count * 56)
        for sample in samples.values {
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
}
private enum CaptureConnectionStore {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.dwelld.capture.pairing", kSecAttrAccount as String: "current-inspection"] }
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
