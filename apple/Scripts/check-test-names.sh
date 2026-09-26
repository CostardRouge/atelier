#!/usr/bin/env bash
# Apple's XCTestCase has an instance method `record(_: XCTIssue)` that Linux's
# XCTest does not, so inside a test class an unqualified `record(...)` — the
# kernel's History global, or a helper a spec declares under that name —
# compiles on Linux and is refused on macOS alone (`native-app.md`). This makes
# the Linux job and a local run refuse it too. Call the kernel's QUALIFIED
# (`AtelierKit.record(...)`) and name a spec's helper for what it reads.
set -euo pipefail
cd "$(dirname "$0")/.."
hits=$(grep -rnE '(^|[^.A-Za-z0-9_])record\(' Packages/AtelierKit/Tests AtelierTests || true)
if [ -n "$hits" ]; then
  echo "An unqualified record( in a spec — XCTestCase.record(_:) shadows it on macOS:"
  echo "$hits"
  exit 1
fi
echo "no spec calls an unqualified record("
