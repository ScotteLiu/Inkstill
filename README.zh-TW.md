# Inkstill

[English](README.md) · [繁體中文](README.zh-TW.md)

[![Windows CI](https://github.com/ScotteLiu/Inkstill/actions/workflows/windows-candidate.yml/badge.svg)](https://github.com/ScotteLiu/Inkstill/actions/workflows/windows-candidate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Inkstill 是一款安靜、以本機檔案為核心的 Windows Markdown 工作空間。它結合專注寫作介面、資料夾管理與知識連結，並始終以標準 Markdown 檔案作為唯一資料來源。

> Inkstill 目前是 Windows x64 預覽版。在建立可信任的 Authenticode 發佈身分以前，公開安裝包尚未簽章。從原始碼建置，或僅在理解 Windows SmartScreen 警告的情況下使用預覽版。

## 下載

每個 GitHub 預覽版本提供兩種 Windows x64 下載：

- `Inkstill-1.1.0 Setup.exe`：完整的單一使用者安裝程式。
- `Inkstill-win32-x64-1.1.0.zip`：免安裝綠色版；解壓縮後直接執行 `Inkstill.exe`。

請用 `SHA256SUMS.txt` 驗證下載檔案。預覽版尚未經 Authenticode 簽章，因此 Windows 可能顯示 SmartScreen 警告。

## 功能

- 編輯、同步分割與閱讀三種檢視，支援 GFM 表格、工作清單、註腳、程式碼語法上色、KaTeX 數學式、Mermaid 圖表、Wiki 連結、`[toc]`、YAML 中繼資料、提示區塊、Emoji、上下標與安全的本機圖片預覽。
- 多分頁、未儲存狀態、每分頁復原、外部修改警告，以及自動恢復上次開啟的檔案。
- 資料夾工作空間、檔案瀏覽、全文搜尋、快速開啟、文件大綱、反向連結與未連結提及。
- 鍵盤優先的命令面板、圖形化表格建立器、可搜尋大綱、Markdown 速查表、尋找取代、括號配對與縮排。
- 專注、打字機與 Hemingway 模式；拼字檢查、行號、亮色／深色／系統主題、三種閱讀寬度、選取統計、閱讀時間及字數目標。
- 本機圖片匯入、剪貼簿圖片貼上、可攜式相對路徑、複製 HTML，以及獨立 HTML/PDF 匯出。

## 檔案完整性與隱私

- Electron renderer 採沙箱與 context isolation，並使用限制性 CSP、經驗證的 fuses 和狹窄的型別化 IPC。
- CodeMirror 文字是唯一 Markdown 原始資料；視覺裝飾不會重新序列化文件。
- 儲存與復原寫入採序列化處理；外部修改不會被靜默覆寫。
- Startup Recovery 驗證校驗碼；中斷寫入保留交易證據。
- 保留 UTF-8 BOM 與 LF/CRLF；混合或單獨 CR 換行必須先明確選擇才能編輯。
- 大型檔案會停用成本較高的視覺分析。
- IME 組字期間會阻止儲存、重新載入、切換文件與關閉沖刷。
- Markdown 內容只保留在使用者選擇的本機檔案與本機復原資料中；Inkstill 不需要雲端帳號。

## 開發

使用 `.node-version` 指定的 Node 24.14.0 與 pnpm 11.9.0。

```powershell
pnpm install --frozen-lockfile
pnpm start
```

完整來源驗證：

```powershell
pnpm verify:source
```

Windows 候選版：

```powershell
pnpm release:candidate
```

參與貢獻前請閱讀 [CONTRIBUTING.md](CONTRIBUTING.md)。安全性問題請依照 [SECURITY.md](SECURITY.md) 私下通報，不要建立公開 Issue。

## 目前限制

- 原始 HTML 會在預覽中顯示為原始碼，不會執行。
- 衝突檢視不會自動合併文件。
- 雲端同步、即時協作、代管發佈、AI 帳號與第三方外掛市集不屬於目前的本機編輯器功能。
- 仍需在真實 Windows 注音、拼音與倉頡輸入法上持續驗證。
- 目前只提供 Windows x64；macOS/Linux 仍需各自的建置、輸入法、生命週期、簽章與公證測試。

## 授權與著作權

Inkstill 使用 [MIT License](LICENSE) 開源。

Copyright © 2026 Scotte Liu.

## 開發致謝

- **Scotte Liu**：創作者、著作權人及主要開發者
- **OpenAI Codex**：開發協助
