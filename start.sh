#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/frontend"

echo "⚡ 啟動 TW-QVM Quant Terminal 純靜態前端預覽 (http://localhost:5173)..."
npm run dev
