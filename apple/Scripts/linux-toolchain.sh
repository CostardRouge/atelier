#!/usr/bin/env bash
# Give a Linux box with no Swift a Swift 5.10 toolchain — the one CI's
# `kernel-linux` job uses — without a package manager, a docker daemon or
# swift.org (which the cloud sessions' proxy refuses): pull the official
# `swift:5.10-jammy` image's layers straight from Google's Docker Hub mirror
# (mirror.gcr.io serves anonymous pulls with no rate limit; registry-1
# counts them against a shared address), unpack them into a rootfs, and
# install `swift` / `swiftc` wrappers that chroot into it with /home, /tmp
# and /root bind-mounted at the same paths, so a package path outside is the
# same path inside. Needs root (chroot + bind mounts); needs ~3 GB of disk.
#
#   apple/Scripts/linux-toolchain.sh          # then: swift test --package-path apple/Packages/AtelierKit
#
# Only the KERNEL compiles here (Foundation only, Linux-testable); SwiftUI,
# Core Image and the app targets still need CI's macOS runner or Xcode.
set -euo pipefail
IMG=library/swift
TAG=${SWIFT_IMAGE_TAG:-5.10-jammy}
ROOT=${SWIFT_ROOTFS:-/opt/swift-rootfs}
REG=${SWIFT_REGISTRY:-https://mirror.gcr.io}
WORK=${TMPDIR:-/tmp}/swift-layers
ACC="application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json"

if [ -x "$ROOT/usr/bin/swift" ]; then
  echo "rootfs already unpacked at $ROOT"
else
  mkdir -p "$ROOT" "$WORK"
  INDEX=$(curl -sS -H "Accept: $ACC" "$REG/v2/$IMG/manifests/$TAG")
  if echo "$INDEX" | jq -e '.manifests' >/dev/null 2>&1; then
    DIGEST=$(echo "$INDEX" | jq -r '.manifests[] | select(.platform.architecture=="amd64" and .platform.os=="linux") | .digest' | head -1)
    MANIFEST=$(curl -sS -H "Accept: $ACC" "$REG/v2/$IMG/manifests/$DIGEST")
  else
    MANIFEST=$INDEX
  fi
  LAYERS=$(echo "$MANIFEST" | jq -r '.layers[].digest')
  [ -n "$LAYERS" ] || { echo "no layers in the manifest: $(echo "$MANIFEST" | head -c 300)"; exit 1; }
  N=$(echo "$LAYERS" | wc -l); i=0
  for L in $LAYERS; do
    i=$((i+1)); F="$WORK/$(echo "$L" | tr ':' '_').tar.gz"
    [ -s "$F" ] || { echo "[$i/$N] downloading $L"; curl -sS -L -o "$F" "$REG/v2/$IMG/blobs/$L"; }
    echo "[$i/$N] extracting $(du -h "$F" | cut -f1)"
    tar -xzf "$F" -C "$ROOT" --exclude='dev/*' --warning=no-unknown-keyword
    find "$ROOT" -name '.wh.*' -print0 2>/dev/null | while IFS= read -r -d '' w; do
      d=$(dirname "$w"); b=$(basename "$w"); rm -rf "$d/${b#.wh.}" "$w"
    done
  done
  rm -rf "$WORK"
fi

mkdir -p "$ROOT/proc" "$ROOT/dev" "$ROOT/home" "$ROOT/tmp" "$ROOT/root"

cat > /usr/local/bin/swift-chroot <<EOF
#!/usr/bin/env bash
# A Swift toolchain binary from the unpacked swift image, run in its rootfs
# from the caller's own directory (bind-mounted at the same path).
R=$ROOT
# The bind mounts do not survive a session's harness between calls: re-made here.
for m in proc dev home tmp root; do
  mountpoint -q "\$R/\$m" 2>/dev/null || mount --bind "/\$m" "\$R/\$m" 2>/dev/null
done
tool=\$(basename "\$0")
[ "\$tool" = swift-chroot ] && { tool=\$1; shift; }
exec chroot "\$R" /bin/bash -c 'cd "\$1" && shift && exec "\$@"' bash "\$PWD" /usr/bin/env -i PATH=/usr/bin:/bin:/usr/local/bin HOME=/root TERM=xterm LANG=C.UTF-8 "\$tool" "\$@"
EOF
chmod +x /usr/local/bin/swift-chroot
for t in swift swiftc; do ln -sf /usr/local/bin/swift-chroot "/usr/local/bin/$t"; done
swift --version
