"""Exercise the production session Keychain store in a unique, disposable namespace."""
from pathlib import Path
import platform
import subprocess
import tempfile
import uuid

if platform.system() != 'Darwin':
    raise SystemExit('Session Keychain verification requires macOS.')

root = Path(__file__).resolve().parents[1]
source = (root / 'DwelldCapture/CaptureModel.swift').read_text()
store = source[source.index('private struct CaptureConnection: Codable'):]
service = 'com.dwelld.capture.lifecycle-test.' + str(uuid.uuid4())
store = store.replace('com.dwelld.capture.pairing', service)
try:
    with tempfile.TemporaryDirectory(prefix='dwelld-session-test-') as directory:
        code = Path(directory) / 'Check.swift'
        code.write_text('import Foundation\nimport Security\n' + store + (root / 'Tests/SessionLifecycleCheck.swift').read_text())
        executable = Path(directory) / 'check'
        subprocess.run(['swiftc', '-parse-as-library', str(code), '-o', str(executable)], check=True)
        subprocess.run([str(executable)], check=True)
finally:
    # Clean the test namespace even if an assertion terminates the Swift executable.
    for account in ('current-inspection', 'retained-captures'):
        subprocess.run(['security', 'delete-generic-password', '-s', service, '-a', account], capture_output=True)
