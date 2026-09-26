#!/usr/bin/env bash
# Names the macOS test targets would read twice, refused before CI's macOS
# jobs do (`native-app.md`):
# - Apple's XCTestCase has an instance method `record(_: XCTIssue)` that
#   Linux's XCTest does not, so inside a test class an unqualified
#   `record(...)` — the kernel's History global, or a helper a spec declares
#   under that name — compiles on Linux and is refused on macOS alone. Call
#   the kernel's QUALIFIED (`AtelierKit.record(...)`) and name a spec's helper
#   for what it reads.
# - The app module may declare a top-level type or function the kernel also
#   declares public: inside the app its own wins silently, but the render
#   gate (`AtelierTests`) imports BOTH and refuses the name as ambiguous. The
#   app takes the kernel's instead of keeping a twin.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
hits=$(grep -rnE '(^|[^.A-Za-z0-9_])record\(' Packages/AtelierKit/Tests AtelierTests || true)
if [ -n "$hits" ]; then
  echo "An unqualified record( in a spec — XCTestCase.record(_:) shadows it on macOS:"
  echo "$hits"
  fail=1
fi
kernel=Packages/AtelierKit/Sources
types() { grep -rhoE "^$1(final )?(struct|enum|class|protocol|typealias|actor) [A-Za-z_][A-Za-z0-9_]*" "$2" | awk '{print $NF}' | sort -u; }
funcs() { grep -rhoE "^$1(func|let|var) [A-Za-z_][A-Za-z0-9_]*" "$2" | awk '{print $NF}' | sort -u; }
twins=$( { comm -12 <(types 'public ' $kernel) <(types '' Atelier); comm -12 <(funcs 'public ' $kernel) <(funcs '' Atelier); } | sort -u)
if [ -n "$twins" ]; then
  echo "Top-level names the app declares that the kernel already declares public (ambiguous in AtelierTests):"
  echo "$twins"
  fail=1
fi
[ $fail -eq 0 ] && echo "no spec calls an unqualified record(, no app/kernel twin names"
exit $fail
