#!/bin/sh
# Run on macOS: encode/decode the real recorder using synthetic sensor pixels at 60 Hz.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
recording_check_dir=$(mktemp -d)
trap 'rm -rf "$recording_check_dir"' EXIT
xcrun swiftc -swift-version 5 -parse-as-library "$repo_root/ios/DwelldCapture/NativeVideoRecorder.swift" "$repo_root/ios/Tests/NativeVideoRecorderCheck.swift" -o "$recording_check_dir/check"
"$recording_check_dir/check" "$recording_check_dir/recording.mp4"
