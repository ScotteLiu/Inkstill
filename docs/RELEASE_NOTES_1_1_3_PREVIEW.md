# Inkstill 1.1.3 Preview

## English

Inkstill 1.1.3 focuses on reliable updates, adaptable navigation, keyboard
compatibility, and a clearer public showcase.

### Highlights

- Reads a small update manifest from the Inkstill website, caches it with ETag,
  limits automatic checks to once per six hours, and uses exponential retry
  backoff on shared networks.
- Adds a collapsible sidebar with pinned and auto-hide modes. Compact windows use
  an overlay sidebar instead of squeezing the editor.
- Fixes zoom shortcuts across keyboard layouts: `Ctrl/Cmd+=`,
  `Ctrl/Cmd+Shift+=`, numeric keypad `+`, `Ctrl/Cmd+-`, and `Ctrl/Cmd+0`.
- Adds eight complete website languages: English, Simplified Chinese,
  Traditional Chinese, Spanish, Brazilian Portuguese, Hindi, Russian, and German.
- Improves GitHub Pages search metadata, social sharing cards, keyboard
  navigation, responsive screenshots, and download presentation.
- Replaces the old sample note with a polished, image-rich travel journal that
  demonstrates real local Markdown image rendering.
- Keeps the existing sandbox, typed IPC validation, URL allowlist, installer size
  limit, SHA-256 verification, recovery safeguards, and privacy scan.

Installed Windows builds can update through **Help → Check for Updates…** after
the preview channel is published. Current Windows binaries are not yet
Authenticode-signed, so Windows may display a SmartScreen warning.

macOS and Linux packages continue through native CI candidate validation and are
not yet presented as signed public downloads.

## 简体中文

Inkstill 1.1.3 重点改进了更新可靠性、可调节导航、键盘兼容性以及公开展示页面。

### 主要改进

- 从 Inkstill 网站读取轻量更新清单，使用 ETag 缓存，将自动检查限制为每六小时一次，
  并在共享网络环境中使用指数退避重试。
- 左侧导航现在可以收起、固定或自动隐藏；窄窗口使用浮动侧栏，不再挤压编辑区域。
- 修复不同键盘布局下的缩放快捷键，支持 `Ctrl/Cmd+=`、`Ctrl/Cmd+Shift+=`、
  数字键盘 `+`、`Ctrl/Cmd+-` 和 `Ctrl/Cmd+0`。
- 网站增加八种完整语言：英语、简体中文、繁体中文、西班牙语、巴西葡萄牙语、
  印地语、俄语和德语。
- 改进 GitHub Pages 搜索元数据、社交分享图、键盘导航、响应式截图和下载展示。
- 使用包含真实本地 Markdown 图片的旅行笔记替换旧示例，使产品展示更完整。
- 继续保留沙箱、类型化 IPC 校验、URL 白名单、安装包大小限制、SHA-256 校验、
  恢复保护与隐私扫描。

预览通道发布后，Windows 安装版可以通过 **Help → Check for Updates…** 更新。
当前 Windows 程序尚未进行 Authenticode 签名，因此 Windows 可能显示 SmartScreen 提示。

macOS 和 Linux 安装包仍处于原生 CI 候选验证阶段，暂不作为已签名的公开下载提供。
