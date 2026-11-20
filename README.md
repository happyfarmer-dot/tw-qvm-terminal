# TW-QVM Quant Terminal (台股品質＋價值＋動能選股評分與買賣決策系統)

> 專為台灣上市／上櫃普通股設計的現代化量化決策終端機。整合「階段零一票否決防雷閘門」、「100 分制多軌 QVM 評分卡」、「防偏科鎖定降級」、「P0–P4 出場優先序矩陣」與「反波動率倉位控管（台股張/零股換算）」。

---

## 🌟 系統特色與核心模型

### 1. 5 大產業評價模型（Profile-Specific Scoring）
- **`standard`（常態非金融股）**：Quality (40%) + Value (30%) + Momentum (30%) 三大支柱綜合評分。
- **`cyclical_heavy_asset`（重資產景氣循環股）**：專門解決航運、鋼鐵、面板在景氣頂點低 P/E、高 ROIC 之價值陷阱；納入 5–7 年 P/B 河流位階、常態化 ROIC 與重資產停損保護。
- **`cyclical_inventory_order`（訂單／存貨循環股）**：半導體設備、IC 設計族群之存貨營收週轉、合約負債與歷史估值週期。
- **`financial_bank`（銀行主導型金控／獨立銀行）**：以資產品質（NPL、覆蓋率）、淨息差（NIM）、資本適足（BIS/CET1）為核心，輔以 Justified P/B 模型與永續成長率截斷防護。
- **`financial_life_fhc`（壽險主導／雙引擎金控）**：嚴密監控 OCI 未實現評價損益、金控 CAR、雙重槓桿比（DLR）與歷史高點淨值折價。

### 2. 嚴格風險管理與決策紀律
- **階段零一票否決防雷閘門**：檢測重大虧損、會計師非無保留意見、淨值低於票面/過低、董監設質高於警戒線等，觸發直接判定為 F 級並鎖死。
- **防偏科降級判定**：避免單一動能衝刺但品質低劣的投機股誤標為優質股。
- **市場體制開關（Normal / Defensive）**：防禦體制下自動拉高買進門檻、收緊移動停損。
- **P0–P4 出場優先序矩陣**：
  - `P0`：基本面崩壞 / 財務防雷紅線（市價立即全數出清）
  - `P1`：硬性停損觸發
  - `P2`：移動停利點觸發
  - `P3`：綜合評分跌出推薦區間（降級至 C/D/F）
  - `P4`：動能反轉或再平衡
- **反波動率倉位配置器**：輸入總操作資金與單筆最大承受風險（%），自動以 ATR/波動率精算可承擔口數，並折算為「張（1,000 股）＋零股」，精確估算證交稅（千分之三）與券商手續費。

---

## 🏗️ 專案技術棧

- **前端（`frontend/`）**：
  - React 18 + Vite + TypeScript (`strict: true`)
  - Tailwind CSS（專業金融深色終端主題）
  - Recharts（雷達圖、歷史河流圖、資產配置圖）
  - Zustand（狀態持久化 + JSON 匯出/匯入備份）
  - Lucide React
  - Vitest（14/14 單元測試全數通過）
- **後端（`backend/`）**：
  - Python 3.11+ + FastAPI + Uvicorn
  - Pydantic v2 + Pydantic-Settings
  - Pandas + NumPy
  - Aiosqlite（SQLite TTL 快取與監理指標結構化覆寫庫）
  - Httpx + Tenacity
  - Pytest + Respx（7/7 測試全數通過）

---

## 🚀 快速啟動

### 方式一：一鍵啟動（推薦）

專案根目錄下已內建啟動腳本：

```bash
cd tw-qvm-terminal
./start.sh
```

- 後端服務位址：`http://localhost:8000`
- 前端終端位址：`http://localhost:5173`
- 按下 `Ctrl + C` 即可同時優雅終止前後端服務。

---

### 方式二：手動分開運行

#### 啟動後端 (Port 8000)
```bash
cd backend
# 首次使用可建立 .env（可直接複製 .env.example）
cp .env.example .env

# 使用現有虛擬環境啟動
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
- Swagger API 互動式文件：[http://localhost:8000/docs](http://localhost:8000/docs)

#### 啟動前端 (Port 5173)
```bash
cd frontend
npm run dev
```
- 瀏覽器開啟 [http://localhost:5173](http://localhost:5173)

---

## 🧪 執行自動化測試

```bash
# 執行前端量化引擎核心單元測試
cd frontend
npm test

# 執行前端 TypeScript 型別檢查與生產打包
npm run typecheck
npm run build

# 執行後端 API 與指標模組測試
cd ../backend
.venv/bin/pytest tests -v
```

---

## 📄 License
MIT License
