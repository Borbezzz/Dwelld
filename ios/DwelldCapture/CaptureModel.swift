import SwiftUI
import RoomPlan
import ARKit
import CoreImage
import WebKit

func matrix(_ m: simd_float4x4) -> [Float] { (0..<4).flatMap { c in (0..<4).map { r in m[c][r] } } }
func matrix(_ m: simd_float3x3) -> [Float] { (0..<3).flatMap { c in (0..<3).map { r in m[c][r] } } }
func dimensions(_ v: SIMD3<Float>) -> [Float] { [v.x, v.y, v.z] }
struct OwnedRoom: Codable, Identifiable { let id: String; let name: String }
struct Element: Codable { let id: String; let category: String; let dimensions: [Float]; let transform: [Float] }
struct FrameRecord: Codable { let timestamp: Double; let image: String; let depth: String?; let confidence: String?; let width: Int; let height: Int; let depthWidth: Int?; let depthHeight: Int?; let intrinsics: [Float]; let transform: [Float] }
struct Asset: Codable { let name: String; var mediaRef: String; let kind: String }
struct Manifest: Codable { var version = 1; let sessionId: String; var coordinateSystem = "arkit-right-handed-y-up-metres"; var elements: [Element]; var frames: [FrameRecord]; var assets: [Asset] }

@MainActor final class CaptureModel: NSObject, ObservableObject, @preconcurrency RoomCaptureViewDelegate {
    @Published var status = "Start a scan. Sign in and choose a room when you are ready to upload."
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
    private var manifest: Manifest?
    private(set) var directory: URL?
    override init() { super.init(); view.delegate = self }
    required init?(coder: NSCoder) { super.init(); view.delegate = self }
    func encode(with coder: NSCoder) {}
    func start() {
        guard RoomCaptureSession.isSupported else { status = "RoomPlan requires a supported LiDAR iPhone or iPad."; return }
        do {
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            inspectionId = ""; manifest = nil; frameCount = 0; depthCount = 0; featureCount = 0; processing = false; directory = dir; frames = []; assets = []; startTime = nil; lastTimestamp = -1; ready = false
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
            assets.append(Asset(name: "room.usdz", mediaRef: "", kind: "usdz"))
            let surfaces = processedResult.walls + processedResult.doors + processedResult.windows + processedResult.openings + processedResult.floors
            let elements = surfaces.map { Element(id: $0.identifier.uuidString, category: String(describing: $0.category), dimensions: dimensions($0.dimensions), transform: matrix($0.transform)) } + processedResult.objects.map { Element(id: $0.identifier.uuidString, category: String(describing: $0.category), dimensions: dimensions($0.dimensions), transform: matrix($0.transform)) }
            manifest = Manifest(sessionId: processedResult.identifier.uuidString, elements: elements, frames: frames, assets: assets)
            try JSONEncoder().encode(manifest).write(to: dir.appendingPathComponent("manifest.json"))
            ready = true; status = "Captured \(elements.count) elements, \(frames.count) calibrated images. Depth available for \(frames.filter { $0.depth != nil }.count) frames."
        } catch { status = "Could not export the captured geometry." }
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
        guard !roomId.isEmpty else { status = "Sign in and choose a room before uploading."; return }
        uploading = true
        defer { uploading = false }
        if inspectionId.isEmpty { await createInspection(base: base, roomId: roomId, type: type) }
        guard !inspectionId.isEmpty else { return }
        let inspectionId = self.inspectionId
        guard base.scheme == "https" else { status = "Use your HTTPS deployment for authenticated capture upload."; return }
        let cookies = await login.configuration.websiteDataStore.httpCookieStore.allCookies()
        let session = URLSession(configuration: .ephemeral)
        let cookieHeader = HTTPCookie.requestHeaderFields(with: cookies.filter { base.host == $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) || base.host?.hasSuffix("." + $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) == true })
        func request(_ path: String, method: String = "POST", data: Data, type: String = "application/json") async throws -> [String: Any] {
            var req = URLRequest(url: base.appendingPathComponent(path)); req.httpMethod = method; req.httpBody = data; req.setValue(type, forHTTPHeaderField: "Content-Type"); req.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
            for (key, value) in cookieHeader { req.setValue(value, forHTTPHeaderField: key) }
            let (body, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: body) }
            return (try JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        }
        do {
            for i in m.assets.indices {
                status = "Uploading private asset \(i + 1)/\(m.assets.count)…"
                let asset = m.assets[i]
                if asset.mediaRef.hasPrefix("gridfs:") { continue }
                let data = try Data(contentsOf: dir.appendingPathComponent(asset.name)), contentType = asset.kind == "image" ? "image/jpeg" : asset.kind == "usdz" ? "model/vnd.usdz+zip" : "application/octet-stream"
                let initData = try JSONSerialization.data(withJSONObject: ["filename": asset.name, "contentType": contentType, "size": data.count])
                let upload = try await request("api/uploads", data: initData)
                guard let id = upload["uploadId"] as? String, let chunkSize = upload["chunkSize"] as? Int else { throw CocoaError(.fileWriteUnknown) }
                for offset in stride(from: 0, to: data.count, by: chunkSize) {
                    var req = URLRequest(url: URL(string: "api/uploads?uploadId=\(id)&part=\(offset / chunkSize)", relativeTo: base.appendingPathComponent("/"))!); req.httpMethod = "PATCH"; req.httpBody = data.subdata(in: offset..<min(data.count, offset + chunkSize)); req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type"); req.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin"); for (key, value) in cookieHeader { req.setValue(value, forHTTPHeaderField: key) }
                    let (responseBody, response) = try await session.data(for: req); guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw httpFailure(response, data: responseBody) }
                }
                let completed = try await request("api/uploads", data: JSONSerialization.data(withJSONObject: ["action": "complete", "uploadId": id]))
                guard let ref = completed["url"] as? String else { throw CocoaError(.fileWriteUnknown) }; m.assets[i].mediaRef = ref; manifest = m
                try JSONEncoder().encode(m).write(to: dir.appendingPathComponent("manifest.json"))
            }
            _ = try await request("api/inspections/\(inspectionId)/spatial", data: JSONEncoder().encode(m))
            status = "Capture saved. Open this inspection's Spatial review in Dwelld."; manifest = m
        } catch { status = "Upload: \(error.localizedDescription). Local capture is retained; retry resumes saved assets." }
    }
}
