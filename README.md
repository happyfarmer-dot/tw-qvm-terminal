# TW-QVM Quant Terminal（方案 C：GitHub Actions 自動產出真實數據 ＋ GitHub Pages 無伺服器架構）

> 專為台灣上市／上櫃普通股設計的現代化量化決策終端機。採用 **Zero-Serverless Data Pipeline** 架構：由 GitHub Actions 每日收盤後自動抓取 **100% 真實台股數據**，輸出靜態 JSON 至 GitHub Pages，手機與電腦皆可零設定、零月費、無 `Failed to fetch` 地直接開啟使用。

🌐 **線上網址**：[https://happyfarmer-dot.github.io/tw-qvm-terminal/](https://happyfarmer-dot.github.io/tw-qvm-terminal/)

---

## 🛠️ 傻瓜設定指南（第一次啟用必看，3 分鐘完成）

### 步驟 1：取得免費 FinMind API Token（推薦，額度 600 次／小時）
1. 前往 [FinMind 官網](https://finmindtrade.com/) 免費註冊並登入。
2. 於會員中心複製您的 **API Token**。

### 步驟 2：在 GitHub 倉庫設定 Secret
1. 開啟您的 GitHub 儲存庫：[happyfarmer-dot/tw-qvm-terminal](https://github.com/happyfarmer-dot/tw-qvm-terminal)。
2. 點擊上方 **Settings** → 左側 **Secrets and variables** → **Actions**。
3. 點擊 **New repository secret**：
   - **Name**：`FINMIND_API_TOKEN`
   - **Secret**：貼上您的 FinMind API Token，點擊 **Add secret**。

### 步驟 3：確認 GitHub Actions 讀寫權限（讓排程能自動提交真實數據）
1. 在同一倉庫點擊 **Settings** → 左側 **Actions** → **General**。
2. 滑動到最下方 **Workflow permissions**，確認勾選 **Read and write permissions**，點擊 **Save**。

### 步驟 4：手動觸發第一次真實數據抓取（電腦或手機 GitHub App 皆可）
1. 點擊儲存庫上方 **Actions** 分頁。
2. 在左側工作流清單選擇 **Update Real TW Stock Data**。
3. 點擊右側 **Run workflow**（可保留空白直接執行，或在 `target_symbols` 輸入優先抓取的代號如 `2330,2603,2886`）→ 按下綠色 **Run workflow**。
4. 等待約 1–2 分鐘完成後，GitHub Actions 會自動更新 `frontend/public/data/stocks_bundle.json` 並自動觸發 **Deploy Frontend to GitHub Pages** 重新發佈網頁！

---

## 📋 如何新增想追蹤的台股代號？

1. 直接在 GitHub 網頁版打開 [`pipeline/watchlist.json`](pipeline/watchlist.json)，點擊右上角編輯按鈕（鉛筆圖示）。
2. 將 4–6 碼台股代號加入 `"symbols"` 陣列中並 **Commit changes**。
3. 至 **Actions** → **Update Real TW Stock Data** 手動觸發執行（或在週一至週五 18:45 台灣時間自動排程時一併入庫）。
4. 系統內建 `MAX_FINMIND_STOCKS_PER_RUN`（預設 `65`）與 `pipeline/cache/` 壓縮增量快取，日常執行會跳過已有 7 年歷史的股票，直接透過 TWSE/TPEx 零額度 OpenAPI 追加最新收盤價，絕不超額！

---

## 🔒 隱私與安全設計（Public 倉庫也能安心用）

- **公開靜態數據（`frontend/public/data/`）**：僅包含公開市場股價、財報比率與大盤體制。
- **個人隱私數據（瀏覽器 `localStorage`）**：您的 **個人持倉張數／成本** 與在手機上填寫的 **金控 MOPS 監理數據（CAR / CET1 / DLR / NPL / 覆蓋率）** 僅儲存於您裝置的瀏覽器 `localStorage`，絕不上傳至 GitHub 公開倉庫。
- **跨裝置同步**：點擊網頁右上角 **「匯出備份」** 可下載個人帳本與監理覆寫 JSON，在另一台手機或電腦點擊 **「匯入還原」** 即可無縫同步。

---

## 🏗️ 專案架構

- `pipeline/`：Python 3.11+ 真實數據管線（FinMind v4 + TWSE OpenAPI + TPEx OpenAPI + 壓縮增量快取）
  - `watchlist.json`：追蹤清單（預設 79 檔代表性台股）
  - `fetch_tw_data.py`：主排程腳本，產出 `frontend/public/data/manifest.json` 與 `stocks_bundle.json`
  - `calculators/`：標準 QVM、強景氣循環（Cyclical-QVM）、銀行與金控（Fin-QVM）、TAIEX 體制偵測器
- `frontend/`：React 18 + TypeScript + Tailwind CSS + Recharts + Zustand 純靜態前端
  - `src/services/staticDataService.ts`：使用 `./data/...` 相對路徑載入靜態真實數據（完全相容 GitHub Pages 子路徑）
  - `src/engine/`：純 TypeScript 量化評分、防雷閘門、P0–P4 出場優先序與反波動率張/零股配置引擎

---

## 🧪 本地開發與測試指令

```bash
# 1. 前端型別檢查、14 項量化引擎單元測試與打包
cd frontend
npm install
npm run typecheck
npm test
npm run build

# 2. 數據管線單元測試（使用 Mock HTTP 驗證還原價、民國年轉換與額度保護）
cd ../pipeline
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest tests -v
```
