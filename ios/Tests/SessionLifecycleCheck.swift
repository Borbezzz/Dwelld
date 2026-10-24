extension CaptureConnectionStore {
 static func cleanupTestItems() { SecItemDelete(query as CFDictionary); SecItemDelete(pendingQuery as CFDictionary) }
}
@main struct CheckCaptureSessions {
 static func main() throws {
  defer { CaptureConnectionStore.cleanupTestItems() }
  var first = CaptureConnection(session: "old-session", phone: "old-phone-token", device: "old-device", pairingToken: "old-pairing")
  first.paired = true; first.captureFolder = UUID().uuidString
  var second = CaptureConnection(session: "other-session", phone: "other-phone-token", device: "other-device", pairingToken: "other-pairing")
  second.captureFolder = UUID().uuidString
  try CaptureConnectionStore.retain(first); try CaptureConnectionStore.retain(second)
  let fresh = CaptureConnection(session: "new-session", phone: "new-phone-token", device: "new-device", pairingToken: "new-pairing")
  try CaptureConnectionStore.save(fresh)
  precondition(CaptureConnectionStore.load()?.session == "new-session")
  precondition(CaptureConnectionStore.load()?.captureFolder == nil, "Fresh session must not inherit an old folder")
  precondition(CaptureConnectionStore.retained().count == 2)
  try CaptureConnectionStore.clear()
  precondition(CaptureConnectionStore.load() == nil)
  precondition(CaptureConnectionStore.retained().count == 2, "Clearing the active session must retain unsent captures")
  first.expiresAt = .distantPast
  try CaptureConnectionStore.retain(first)
  precondition(CaptureConnectionStore.retained().count == 2, "Retry snapshots must replace the same folder without duplication")
  precondition(CaptureConnectionStore.retained().first(where: {$0.captureFolder == first.captureFolder})?.phone == "old-phone-token")
  try CaptureConnectionStore.removeRetained(folder: first.captureFolder!)
  precondition(CaptureConnectionStore.retained().count == 1)
  precondition(CaptureConnectionStore.retained()[0].session == "other-session", "Acknowledging one capture must not flush another")
  print("Session keychain lifecycle passed: fresh state, retained recovery, isolated credentials, deduplication and acknowledgement cleanup")
 }
}
