#!/usr/bin/env bash
# Decodes the label QR encoder's output with OpenCV (an independent reference decoder). Needs python3 with cv2 and numpy.
set -euo pipefail
out=$(mktemp -d); npx tsx "$(dirname "$0")/qr-gen.ts" "$out/m.json"
python3 - "$out/m.json" <<'PY'
import json, sys, numpy as np, cv2
items = json.load(open(sys.argv[1])); bad = []
for e in items:
    m = np.pad(np.array(e["m"], dtype=np.uint8), 4); img = np.kron((1 - m) * 255, np.ones((6, 6))).astype(np.uint8)
    if cv2.QRCodeDetector().detectAndDecode(img)[0] != e["t"]: bad.append(len(e["t"]))
print(f"QR decode: {len(items) - len(bad)}/{len(items)} OK", bad or "")
sys.exit(1 if bad else 0)
PY
