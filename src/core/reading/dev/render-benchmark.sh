#!/bin/sh
# Renders the synthetic OCR benchmark images from benchmark-html/ with headless Chrome.
# Run from this folder: sh render-benchmark.sh
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
for html in benchmark-html/*.html; do
  name=$(basename "$html" .html)
  case "$name" in rx-*) size=1000,1300 ;; *) size=1000,700 ;; esac
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$size" --screenshot="$PWD/benchmark/$name.png" "file://$PWD/$html" >/dev/null 2>&1
  echo "benchmark/$name.png"
done
