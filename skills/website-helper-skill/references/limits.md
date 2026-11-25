# 限制 / 已知短板

## 功能限制

| 限制 | 原因 | 临时方案 |
|------|------|---------|
| 只支持 A 记录（IPv4） | 当前 DNS API 只调 A | — |
| **DNSPod 未实现** | 缺 Tencent Cloud TC3-HMAC-SHA256 签名，构造即抛 `NotImplementedError`（否则请求只会 401） | 用 cloudflare 或 aliyun |
| 单云机器（IP 固定） | 不支持多机负载均衡 | 多子域用同一 IP |
| certbot 需 DNS 已传播 | Let's Encrypt 限制 | 等 5-30 分钟 |
| 不支持 IPv6（AAAA） | 未实现 | — |
| 不支持 CDN | 走直连 | 手动在 CDN 配回源 |
| Windows emoji 乱码 | cp1252 默认 | `chcp 65001`（`cli.py` 已有 UTF-8 reconfigure 兜底） |
| 大目录部署慢 | SSH SFTP 串行 | 未来改为 rsync |
| 发布历史按 CWD 存 | `cockpit/logger.py` 写 `<CWD>/docs/specs/.state-card.md` | 固定在项目根执行命令 |

## 安全限制

| 限制 | 原因 |
|------|------|
| SSH 密码明文存于 `.agents/.env` | 密钥认证更安全；`_parse_env_file` 只剥引号，不做加密 |
| AccessKey 轮换无提示 | 需用户自己监控 |
| `publish config show` 只掩码，不校验凭据有效性 | 校验要真实调 API，交给首次 deploy 暴露 |

## 测试

`tests/` 覆盖 pipeline、docker 探测、反代配置生成、`.env` 解析与 upstream 校验（45 例）。
跑法：`cd $SKILL_DIR && python -m pytest tests/ -q`。
