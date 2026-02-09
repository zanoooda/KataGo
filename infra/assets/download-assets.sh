#!/usr/bin/env bash
set -euo pipefail

OUT_KATAGO_DIR="/out/katago"
OUT_MODELS_DIR="/out/models"
KATAGO_BIN_PATH="$OUT_KATAGO_DIR/katago"
MODEL_PATH="$OUT_MODELS_DIR/model.bin.gz"

mkdir -p "$OUT_KATAGO_DIR" "$OUT_MODELS_DIR"

if [[ "${FORCE_UPDATE:-0}" != "1" ]] && [[ -x "$KATAGO_BIN_PATH" ]] && [[ -s "$MODEL_PATH" ]]; then
  echo "Assets already present, skipping download."
  exit 0
fi

ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH_RAW"
    exit 1
    ;;
esac

echo "Detected architecture: $ARCH_RAW -> $ARCH"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# 1) Download latest KataGo binary from GitHub release assets.
LATEST_JSON="$(curl -fsSL https://api.github.com/repos/lightvector/KataGo/releases/latest)"

KATAGO_URL="$({
  echo "$LATEST_JSON" | jq -r --arg arch "$ARCH" '
    [ .assets[].browser_download_url ]
    | map(select(test("linux-" + $arch) and test("eigen") and test("\\.(tar\\.gz|zip)$")))
    | .[0] // empty
  '
})"

if [[ -z "$KATAGO_URL" ]]; then
  KATAGO_URL="$({
    echo "$LATEST_JSON" | jq -r --arg arch "$ARCH" '
      [ .assets[].browser_download_url ]
      | map(select(test("linux-" + $arch) and test("opencl") and test("\\.(tar\\.gz|zip)$")))
      | .[0] // empty
    '
  })"
fi

if [[ -z "$KATAGO_URL" ]]; then
  echo "Could not find a suitable KataGo binary asset in latest release."
  exit 1
fi

echo "Downloading KataGo from: $KATAGO_URL"
KATAGO_ARCHIVE="$TMP_DIR/katago_asset"
curl -fL "$KATAGO_URL" -o "$KATAGO_ARCHIVE"

EXTRACT_DIR="$TMP_DIR/extracted"
mkdir -p "$EXTRACT_DIR"

if [[ "$KATAGO_URL" == *.zip ]]; then
  unzip -q "$KATAGO_ARCHIVE" -d "$EXTRACT_DIR"
else
  tar -xzf "$KATAGO_ARCHIVE" -C "$EXTRACT_DIR"
fi

FOUND_KATAGO="$(find "$EXTRACT_DIR" -type f -name katago | head -n 1 || true)"
if [[ -z "$FOUND_KATAGO" ]]; then
  echo "KataGo executable not found after extraction."
  exit 1
fi

install -m 0755 "$FOUND_KATAGO" "$KATAGO_BIN_PATH"

# 2) Download a current model automatically from katagotraining.
NETWORKS_PAGE="$(curl -fsSL https://katagotraining.org/networks/)"
MODEL_URL="$(printf '%s\n' "$NETWORKS_PAGE" \
  | grep -m1 -oE 'href="[^"]+\.bin\.gz"' \
  | sed -E 's/^href="(.*)"$/\1/' || true)"

if [[ -z "$MODEL_URL" ]]; then
  echo "Could not find model URL on katagotraining.org/networks"
  echo "First 40 lines from networks page for debugging:"
  printf '%s\n' "$NETWORKS_PAGE" | sed -n '1,40p'
  exit 1
fi

if [[ "$MODEL_URL" == /* ]]; then
  MODEL_URL="https://katagotraining.org${MODEL_URL}"
fi

echo "Downloading model from: $MODEL_URL"
curl -fL "$MODEL_URL" -o "$MODEL_PATH"

if [[ ! -s "$MODEL_PATH" ]]; then
  echo "Downloaded model is empty"
  exit 1
fi

chmod 0644 "$MODEL_PATH"

echo "Done."
ls -lh "$KATAGO_BIN_PATH" "$MODEL_PATH"
