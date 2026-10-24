import Foundation
import AVFoundation
import CoreVideo
import CoreImage
@main struct CheckRecording {
 static func main() async throws {
  let url = URL(fileURLWithPath: CommandLine.arguments[1])
  try? FileManager.default.removeItem(at: url)
  let recorder = try NativeVideoRecorder(url: url, height: 720)
  var buffer: CVPixelBuffer?
  CVPixelBufferCreate(nil,640,480,kCVPixelFormatType_32BGRA,[kCVPixelBufferIOSurfacePropertiesKey as String:[:]] as CFDictionary,&buffer)
  let pixel = buffer!
  CVPixelBufferLockBaseAddress(pixel, [])
  let base=CVPixelBufferGetBaseAddress(pixel)!.assumingMemoryBound(to:UInt8.self),stride=CVPixelBufferGetBytesPerRow(pixel)
  // Sensor left half red, right half blue. Clockwise rotation must make the top red.
  for y in 0..<480 { for x in 0..<640 { let p=y*stride+x*4;base[p]=x<320 ? 0:255;base[p+1]=0;base[p+2]=x<320 ? 255:0;base[p+3]=255 } }
  CVPixelBufferUnlockBaseAddress(pixel, [])
  for i in 0..<120 { recorder.append(pixel,timestamp:100+Double(i)/60,origin:100);try await Task.sleep(nanoseconds:16_666_667) }
  let duration=try await recorder.finish()
  let asset=AVURLAsset(url:url),tracks=try await asset.loadTracks(withMediaType:.video),track=tracks[0]
  let fps=try await track.load(.nominalFrameRate),size=try await track.load(.naturalSize)
  let reader=try AVAssetReader(asset:asset),output=AVAssetReaderTrackOutput(track:track,outputSettings:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA]);reader.add(output);reader.startReading();var frames=0
  while reader.status == .reading { guard let sample=output.copyNextSampleBuffer() else { break };frames+=1
   if frames==1 { let image=CMSampleBufferGetImageBuffer(sample)!;CVPixelBufferLockBaseAddress(image,.readOnly);let data=CVPixelBufferGetBaseAddress(image)!.assumingMemoryBound(to:UInt8.self),s=CVPixelBufferGetBytesPerRow(image);let top=100*s+270*4,bottom=600*s+270*4;precondition(data[top+2]>200 && data[top]<40,"Top must be red after clockwise rotation");precondition(data[bottom]>200 && data[bottom+2]<40,"Bottom must be blue");CVPixelBufferUnlockBaseAddress(image,.readOnly) }
  }
  print("Measured \(frames) frames at \(fps) FPS"); precondition(fps>=29 && fps<=31,"Expected 30 FPS, got \(fps)")
  precondition(frames>=58 && frames<=61,"Missing recorded frames: \(frames)")
  precondition(size.width==540 && size.height==720)
  print("Recording verified: \(frames) frames, \(fps) FPS, \(size), \(duration)s, clockwise portrait pixels verified")
 }
}
