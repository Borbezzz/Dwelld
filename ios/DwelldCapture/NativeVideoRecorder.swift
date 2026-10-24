import Foundation
import AVFoundation
import CoreImage
import CoreVideo

/// A separate 30 FPS recording of ARKit's camera. Sampled AI evidence never controls playback.
final class NativeVideoRecorder {
    private let queue = DispatchQueue(label: "com.dwelld.capture.recording", qos: .userInitiated)
    private let pending = DispatchSemaphore(value: 2)
    private let context = CIContext()
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let width: Int, height: Int
    private var lastSlot: Int64 = -1
    private var finished = false
    private var failure: Error?

    init(url: URL, width: Int = 540, height: Int = 960) throws {
        self.width = width; self.height = height
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width, AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 1_800_000,
                AVVideoExpectedSourceFrameRateKey: 30,
                AVVideoMaxKeyFrameIntervalKey: 30,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel
            ]
        ])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]
        ])
        guard writer.canAdd(input) else { throw CocoaError(.fileWriteUnknown) }
        writer.add(input)
    }

    func append(_ pixel: CVPixelBuffer, timestamp: Double, origin: Double) {
        // Bound retained AR camera buffers; a slow encoder must never stall camera tracking.
        guard pending.wait(timeout: .now()) == .success else { return }
        queue.async { [self] in
            defer { pending.signal() }
            guard !finished, failure == nil else { return }
            let slot = Int64(((timestamp - origin) * 30).rounded())
            guard slot >= 0, slot < 3601, slot > lastSlot else { return }
            if writer.status == .unknown {
                guard writer.startWriting() else { failure = writer.error ?? CocoaError(.fileWriteUnknown); return }
                writer.startSession(atSourceTime: .zero)
            }
            guard writer.status == .writing else { failure = writer.error ?? CocoaError(.fileWriteUnknown); return }
            guard input.isReadyForMoreMediaData, let pool = adaptor.pixelBufferPool else { return }
            var output: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &output) == kCVReturnSuccess, let output else { return }
            let portrait = CIImage(cvPixelBuffer: pixel).oriented(.right)
            let image = portrait.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / portrait.extent.width, y: CGFloat(height) / portrait.extent.height))
            context.render(image, to: output)
            guard adaptor.append(output, withPresentationTime: CMTime(value: slot, timescale: 30)) else { failure = writer.error ?? CocoaError(.fileWriteUnknown); return }
            lastSlot = slot
        }
    }

    func finish() async throws -> Double {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                guard !finished else { continuation.resume(throwing: CocoaError(.fileWriteUnknown)); return }
                finished = true
                if let failure { writer.cancelWriting(); continuation.resume(throwing: failure); return }
                guard lastSlot >= 0, writer.status == .writing else { writer.cancelWriting(); continuation.resume(throwing: CocoaError(.fileWriteUnknown)); return }
                let duration = Double(lastSlot + 1) / 30
                writer.endSession(atSourceTime: CMTime(value: lastSlot + 1, timescale: 30))
                input.markAsFinished()
                writer.finishWriting { [self] in
                    if writer.status == .completed { continuation.resume(returning: duration) }
                    else { continuation.resume(throwing: writer.error ?? CocoaError(.fileWriteUnknown)) }
                }
            }
        }
    }

    func cancel() { queue.async { [self] in finished = true; writer.cancelWriting() } }
}

#if os(iOS)
import ARKit
/// Read camera buffers off the UI thread, so JPEG evidence writes cannot stall video cadence.
final class ARVideoRecording {
    private let queue = DispatchQueue(label: "com.dwelld.capture.camera", qos: .userInteractive)
    private var timer: DispatchSourceTimer?
    private var recorder: NativeVideoRecorder?
    private var failure: Error?
    init(url: URL, session: ARSession, origin: Double) {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        self.timer = timer
        timer.schedule(deadline: .now(), repeating: 1.0 / 60, leeway: .milliseconds(1))
        timer.setEventHandler { [weak self] in
            guard let self, self.failure == nil, let frame = session.currentFrame else { return }
            if self.recorder == nil {
                let height = Int((540 * Double(CVPixelBufferGetWidth(frame.capturedImage)) / Double(CVPixelBufferGetHeight(frame.capturedImage)) / 2).rounded()) * 2
                do { self.recorder = try NativeVideoRecorder(url: url, height: height) }
                catch { self.failure = error; return }
            }
            self.recorder?.append(frame.capturedImage, timestamp: frame.timestamp, origin: origin)
        }
        timer.resume()
    }
    func finish() async throws -> Double {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                timer?.cancel(); timer = nil
                if let failure { continuation.resume(throwing: failure); return }
                guard let recorder else { continuation.resume(throwing: CocoaError(.fileWriteUnknown)); return }
                Task {
                    do { continuation.resume(returning: try await recorder.finish()) }
                    catch { continuation.resume(throwing: error) }
                }
            }
        }
    }
    func cancel() { queue.async { [self] in timer?.cancel(); timer = nil; recorder?.cancel() } }
    deinit { timer?.cancel() }
}
#endif
