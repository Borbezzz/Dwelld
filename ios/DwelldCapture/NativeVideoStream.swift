import Foundation
import CoreVideo
import WebRTC

/// Video transport is independent of evidence uploads, LiDAR and AI latency.
@MainActor final class NativeVideoStream: NSObject, @preconcurrency RTCPeerConnectionDelegate {
    private static let ssl: Void = { RTCInitializeSSL() }()
    private let factory: RTCPeerConnectionFactory
    private let source: RTCVideoSource
    private let capturer: RTCVideoCapturer
    private let base: URL, sessionID: String, token: String
    private let servers: [[String: Any]]
    private var peer: RTCPeerConnection?
    private var poll: Task<Void, Never>?, sender: Task<Void, Never>?, retry: Task<Void, Never>?
    private var outgoing: [(String, [String: Any])] = []
    private var seen = Set<String>(), earlyICE: [RTCIceCandidate] = []
    private var cursor = 0
    private var negotiation = "", descriptionSent = false, bufferedICE: [[String: Any]] = []
    private var active = true, negotiating = false
    private var lastFrame: Double = -1
    private var metadata: RTCDataChannel?
    var onStatus: ((String) -> Void)?
    init(base: URL, sessionID: String, token: String, servers: [[String: Any]]) {
        _ = Self.ssl
        self.base = base; self.sessionID = sessionID; self.token = token; self.servers = servers
        factory = RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(), decoderFactory: RTCDefaultVideoDecoderFactory())
        source = factory.videoSource(); capturer = RTCVideoCapturer(delegate: source)
        super.init()
        source.adaptOutputFormat(toWidth: 960, height: 540, fps: 24)
    }
    func start() {
        poll = Task { [weak self] in
            guard let self else { return }
            await self.offer()
            while !Task.isCancelled && self.active {
                do {
                    let body = try await self.request("/signal?after=\(self.cursor)", method: "GET")
                    guard self.active else { return }
                    if let session = body["session"] as? [String: Any], session["status"] as? String == "saved" { self.close(); return }
                    if let cursor = body["cursor"] as? Int { self.cursor = cursor }
                    for item in body["signals"] as? [[String: Any]] ?? [] {
                        guard let id = item["id"] as? String, !self.seen.contains(id) else { continue }
                        self.seen.insert(id)
                        guard let type = item["type"] as? String, let data = item["data"] as? [String: Any] else { continue }
                        if type == "restart" { await self.offer(); continue }
                        guard data["negotiationId"] as? String == self.negotiation, let pc = self.peer else { continue }
                        if type == "answer", let d = data["description"] as? [String: Any], let sdp = d["sdp"] as? String, pc.signalingState == .haveLocalOffer {
                            try await self.setRemote(RTCSessionDescription(type: .answer, sdp: sdp), peer: pc)
                            guard self.active, self.peer === pc else { continue }
                            for candidate in self.earlyICE { try? await pc.add(candidate) }; self.earlyICE = []
                        } else if type == "ice", let c = data["candidate"] as? [String: Any], let value = c["candidate"] as? String {
                            let candidate = RTCIceCandidate(sdp: value, sdpMLineIndex: Int32(c["sdpMLineIndex"] as? Int ?? 0), sdpMid: c["sdpMid"] as? String)
                            if pc.remoteDescription != nil { try? await pc.add(candidate) } else if self.earlyICE.count < 100 { self.earlyICE.append(candidate) }
                        }
                    }
                } catch { if self.active { self.onStatus?("Video reconnecting; capture continues locally") } }
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }
    func send(_ pixel: CVPixelBuffer, timestamp: Double, markers: [[String: Any]]?) {
        // The capture timer owns cadence. ARKit timestamps are quantized to camera ticks;
        // a second 1/24 gate would incorrectly discard alternating 60 Hz camera samples.
        guard active, peer != nil, timestamp > lastFrame else { return }
        lastFrame = timestamp
        let frame = RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: pixel), rotation: ._90, timeStampNs: Int64(timestamp * 1_000_000_000))
        source.capturer(capturer, didCapture: frame)
        if let markers, let metadata, metadata.readyState == .open, metadata.bufferedAmount < 64_000, let data = try? JSONSerialization.data(withJSONObject:["type":"native-marks","markers":markers,"timestamp":timestamp]) {
            metadata.sendData(RTCDataBuffer(data:data,isBinary:false))
        }
    }
    func close() {
        active = false; retry?.cancel(); retry = nil; poll?.cancel(); sender?.cancel(); poll = nil; sender = nil
        metadata?.close(); metadata = nil
        peer?.delegate = nil; peer?.close(); peer = nil
        outgoing = []; earlyICE = []; bufferedICE = []; seen = []
    }
    private func offer() async {
        guard active, !negotiating else { return }; negotiating = true; defer { negotiating = false }
        peer?.delegate = nil; peer?.close()
        negotiation = UUID().uuidString; descriptionSent = false; bufferedICE = []; earlyICE = []; outgoing = []
        let config = RTCConfiguration(); config.sdpSemantics = .unifiedPlan
        config.iceServers = servers.compactMap { item in
            let urls = item["urls"] as? [String] ?? (item["urls"] as? String).map { [$0] } ?? []
            return urls.isEmpty ? nil : RTCIceServer(urlStrings: urls, username: item["username"] as? String, credential: item["credential"] as? String)
        }
        guard let pc = factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self) else { return }
        peer = pc
        let channelConfig = RTCDataChannelConfiguration(); channelConfig.isOrdered = false; channelConfig.maxRetransmits = 0
        metadata = pc.dataChannel(forLabel:"room-marks",configuration:channelConfig)
        _ = pc.add(factory.videoTrack(with: source, trackId: "room-camera"), streamIds: ["room-camera"])
        do {
            let sdp: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
                pc.offer(for: RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio":"false","OfferToReceiveVideo":"false"], optionalConstraints: nil)) { sdp,error in
                    if let sdp { continuation.resume(returning:sdp) } else { continuation.resume(throwing:error ?? URLError(.cannotConnectToHost)) }
                }
            }
            guard active, peer === pc else { return }
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                pc.setLocalDescription(sdp) { error in if let error { continuation.resume(throwing:error) } else { continuation.resume() } }
            }
            guard active, peer === pc else { return }
            enqueue("offer", ["negotiationId":negotiation,"description":["type":"offer","sdp":sdp.sdp]])
            descriptionSent = true
            bufferedICE.forEach { enqueue("ice", ["negotiationId":negotiation,"candidate":$0]) }; bufferedICE = []
            onStatus?("Connecting live video")
        } catch { if active { onStatus?("Live video could not connect; retry from laptop") } }
    }
    private func setRemote(_ description: RTCSessionDescription, peer: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.setRemoteDescription(description) { error in if let error { continuation.resume(throwing:error) } else { continuation.resume() } }
        }
    }
    private func enqueue(_ type: String, _ data: [String: Any]) {
        outgoing.append((type,data)); guard sender == nil else { return }
        sender = Task { [weak self] in
            guard let self else { return }; defer { self.sender = nil }
            while self.active && !Task.isCancelled && !self.outgoing.isEmpty {
                let (type,data) = self.outgoing.removeFirst()
                let payload: [String: Any] = ["eventId":UUID().uuidString,"type":type,"data":data]
                do { _ = try await self.request("/signal", method:"POST", body:payload) }
                catch { do { _ = try await self.request("/signal", method:"POST", body:payload) } catch { self.onStatus?("Video signalling interrupted; retry from laptop") } }
            }
        }
    }
    private func request(_ path: String, method: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        try Task.checkCancellation(); guard active else { throw CancellationError() }
        guard let url = URL(string:"/api/live/\(sessionID)\(path)",relativeTo:base) else { throw URLError(.badURL) }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 10
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data,response) = try await URLSession.shared.data(for:request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        return (try JSONSerialization.jsonObject(with:data)) as? [String: Any] ?? [:]
    }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        Task { @MainActor [weak self] in
            guard let self, self.active, self.peer === pc else { return }
            var c: [String: Any] = ["candidate":candidate.sdp,"sdpMLineIndex":Int(candidate.sdpMLineIndex)]
            if let mid = candidate.sdpMid { c["sdpMid"] = mid }
            if self.descriptionSent { self.enqueue("ice", ["negotiationId":self.negotiation,"candidate":c]) } else { self.bufferedICE.append(c) }
        }
    }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCIceConnectionState) {
        Task { @MainActor [weak self] in
            guard let self, self.active, self.peer === pc else { return }
            switch stateChanged {
            case .connected, .completed: self.onStatus?("Live video connected · target 24 FPS")
            case .failed, .disconnected:
                self.onStatus?("Live video reconnecting; capture continues")
                guard self.retry == nil else { return }
                self.retry = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(4)) } catch { return }
                    guard let self else { return }; self.retry = nil
                    guard self.active, self.peer === pc, [.failed,.disconnected].contains(pc.iceConnectionState) else { return }
                    await self.offer()
                }
            default: self.onStatus?("Connecting live video")
            }
        }
    }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
