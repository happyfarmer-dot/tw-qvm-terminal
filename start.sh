#!/usr/bin/env bash
set -e

# 定位專案根目錄
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  TW-QVM Quant Terminal 系統啟動管理員"
echo "=========================================="

MODE="${1:-all}"

# 檢查後端環境檔
if [ ! -f "backend/.env" ]; then
    echo "💡 建立 backend/.env 設定檔（複製自 .env.example）..."
    cp backend/.env.example backend/.env
fi

start_backend() {
    echo "🚀 啟動後端 FastAPI (http://localhost:8000)..."
    cd "$SCRIPT_DIR/backend"
    "$SCRIPT_DIR/backend/.venv/bin/uvicorn" app.main:app --host 0.0.0.0 --port 8000 --reload
}

start_frontend() {
    echo "⚡ 啟動前端 Vite (http://localhost:5173)..."
    cd "$SCRIPT_DIR/frontend"
    npm run dev
}

case "$MODE" in
    backend)
        start_backend
        ;;
    frontend)
        start_frontend
        ;;
    all)
        echo "✨ 同時啟動後端 (Port 8000) 與前端 (Port 5173)..."
        echo "按 Ctrl+C 可一併停止所有服務。"
        trap 'kill $(jobs -p) 2>/dev/null' EXIT
        start_backend &
        BACKEND_PID=$!
        sleep 2
        start_frontend &
        FRONTEND_PID=$!
        wait $BACKEND_PID $FRONTEND_PID
        ;;
    *)
        echo "用法: ./start.sh [all|frontend|backend]"
        exit 1
        ;;
esac
