# Inkstill 1.1.1 Preview

## English

This preview fixes Windows file opening and expands technical-document rendering.

### Highlights

- Registers Inkstill in Windows **Open with** for Markdown and text documents.
- Opens file arguments reliably on first launch and while Inkstill is already running.
- Adds selectable and automatically detected syntax highlighting for common programming languages.
- Renders `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, and standalone bracketed LaTeX equations.
- Refines the status bar for clearer document statistics at normal and high zoom.
- Adds a privacy-preserving GitHub Release update checker with SHA-256 verification.
- Keeps `$`, `~`, `^`, `==`, `[[…]]`, footnote, and emoji sequences literal inside code
  blocks and inline code instead of rendering them as formulas or formatting.
- Keeps rendered Mermaid diagrams and local images visible; they previously disappeared
  moments after rendering.
- Fixes the workspace layout so the status bar stays at the bottom of the window and
  never overlaps document text.
- Makes the in-editor search panel readable in dark mode and improves dark-mode code
  highlighting contrast.
- Repairs documents automatically after a crash during the final step of a save.
- Recognizes `.mdown` and `.mkd` files in **Open with**, finds backlink mentions for
  Chinese note names, and remembers a declined update instead of asking again.

### Updating

Install 1.1.1 manually once. Starting with this version, installed Windows builds can use
**Help → Check for Updates…** and can notify you when a newer verified GitHub Release is available.
Portable builds can check for updates but will switch to the installed edition when the installer runs.

These preview binaries are not yet Authenticode-signed, so Windows may display a SmartScreen warning.

## 简体中文

此预览版修复了 Windows 文件打开问题，并增强了技术文档渲染。

### 主要改进

- 在 Windows 的 Markdown 和文本文件“打开方式”中登记 Inkstill。
- 修复首次启动以及 Inkstill 已运行时无法通过文件参数打开文档的问题。
- 为常用编程语言加入可选择、可自动识别的语法高亮。
- 支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]` 和独立方括号 LaTeX 公式。
- 重新设计底部状态栏，在普通缩放和高倍缩放下更清晰。
- 加入保护隐私的 GitHub Release 更新检查，并在安装前验证 SHA-256。
- 代码块与行内代码中的 `$`、`~`、`^`、`==`、`[[…]]`、脚注和 emoji 字符保持原样，
  不再被误渲染为公式或格式。
- 修复 Mermaid 图和本地图片渲染后随即消失的问题。
- 修复工作区布局：状态栏固定在窗口底部，不再与正文重叠。
- 暗色模式下的搜索面板恢复可读，代码高亮对比度更好。
- 保存的最后一步遭遇崩溃后，文档可自动修复。
- “打开方式”支持 `.mdown` 与 `.mkd`，中文笔记名可被反向链接提及识别，
  拒绝过的更新不再重复提醒。

### 更新方式

需要手动安装一次 1.1.1。从此版本开始，Windows 安装版可以使用
**Help → Check for Updates…**，也可以在发现新版并完成校验后提示安装。
免安装版同样可以检查更新，但运行更新安装器后会切换为安装版。

当前预览版尚未进行 Authenticode 签名，因此 Windows 可能显示 SmartScreen 警告。
