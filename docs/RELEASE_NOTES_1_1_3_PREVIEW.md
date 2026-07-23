# Inkstill 1.1.3 Preview

## English

This preview makes update checks reliable on shared networks and avoids
unnecessary GitHub API traffic.

### Highlights

- Reads a small, privacy-preserving update manifest from the Inkstill GitHub
  Pages site instead of spending an anonymous GitHub API request on every
  launch.
- Caches the manifest with its ETag and limits automatic checks to once per
  six hours.
- Adds randomized startup delay and exponential retry backoff so many clients
  do not check simultaneously.
- Honors GitHub rate-limit reset times when the API is used as a manual-check
  fallback.
- Keeps the existing GitHub URL allowlist, installer size limit, and SHA-256
  verification before an installer can run.
- Publishes the fixed update-channel manifest only after every tagged Release
  asset exists.

Installed Windows builds can update through **Help → Check for Updates…**.
The current preview binaries are not yet Authenticode-signed, so Windows may
display a SmartScreen warning.

## 简体中文

此预览版提高了共享网络下的更新检查可靠性，并避免不必要的 GitHub API 请求。

### 主要改进

- 改为从 Inkstill 的 GitHub Pages 站点读取小型更新清单，不再在每次启动时
  消耗一次匿名 GitHub API 配额。
- 使用 ETag 缓存更新清单，自动检查最多每六小时进行一次。
- 加入随机启动延迟和指数退避，避免大量客户端同时检查更新。
- 手动检查回退到 GitHub API 时，会遵守 GitHub 返回的限流重置时间。
- 继续严格限制 GitHub 下载地址、安装器大小，并在运行前验证 SHA-256。
- 只有在带标签的 Release 资源全部发布完成后，才更新固定的更新通道清单。

Windows 安装版可通过 **Help → Check for Updates…** 更新。当前预览版尚未进行
Authenticode 签名，因此 Windows 可能显示 SmartScreen 警告。
