#!/usr/bin/env bash
# Regenerate assets/icon.png from the 📊 emoji (macOS only — uses Apple Color Emoji).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/assets/icon.png"
SWIFT_SRC="$(mktemp /tmp/render-soberan-icon.XXXXXX.swift)"
trap 'rm -f "$SWIFT_SRC"' EXIT

mkdir -p "$ROOT/assets"

cat > "$SWIFT_SRC" <<'SWIFT'
import AppKit

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
NSColor(calibratedRed: 15 / 255, green: 26 / 255, blue: 46 / 255, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 1024, height: 1024), xRadius: 224, yRadius: 224).fill()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 720),
  .paragraphStyle: paragraph,
]
let text = NSAttributedString(string: "📊", attributes: attrs)
let textRect = NSRect(x: 0, y: 140, width: 1024, height: 760)
text.draw(in: textRect)
image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:])
else {
  fputs("failed to encode png\n", stderr)
  exit(1)
}

let out = CommandLine.arguments[1]
try png.write(to: URL(fileURLWithPath: out))
print("wrote", out)
SWIFT

BIN="$(mktemp /tmp/render-soberan-icon.XXXXXX)"
trap 'rm -f "$SWIFT_SRC" "$BIN"' EXIT
swiftc "$SWIFT_SRC" -o "$BIN"
"$BIN" "$OUT"
