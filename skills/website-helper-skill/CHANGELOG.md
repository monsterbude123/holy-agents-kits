# Changelog — website-helper-skill

## v0.3.2 (2026-11-25)

> SKILL.md 按「第一屏 = 主轴」重写（skill-creator-v2 §2.2 新规）。

* 开头直接给三条命令（静态 / 反代 / 回滚）+ `-w` 与 `--upstream` 的互斥约束。
* 紧接着一张「三条岔路」表：证书失败 / 域名 404 且 138B / 连不上，各自先查什么。
* 原来的 `§1 目录结构` 删除（目录树不是指引，模块职责已在 references/usage.md §4）。
* 安全守则从开场移到主轴之后，仍保留全部 5 条（含 `config show` 掩码、面板 nginx 探测）。
* 版本 0.3.1 → 0.3.2（仅文档结构，代码未变）。

---

## v0.3.1 (2026-11-25)

> 重构：把「文档声称有、代码里没有」的部分补齐或说清，并让技能符合本仓结构规范。

### 修复（原先声称已实现，实为缺失）

* **VR-007 `validate_upstream()`** — 补齐。缺协议头/空值/中间空白/端口越界/缺主机名全部拒绝，尾随空白静默剥离。
* **VR-009 `generate_proxy_server_block()`** — 补齐。含 WebSocket upgrade 头、`client_max_body_size 100M`、300s 读超时。
* **VR-008 `.env` 引号剥离** — 补齐。只剥成对外层引号，不匹配的原样保留（Windows 路径里的合法引号不被吃掉）。
* **`deploy_proxy()`** — 补齐。此前 `publish.actions.nginx` 导入它失败，整个 Actions 层不可导入。
* **VR-010 vhost 探测接入 CLI 路径** — `_install_config()` 改用 `detect_vhost_target()`，不再硬编码 `sites-enabled`；
  探测顺序修正（`conf.d` 排最后，否则 Debian 分支永远不可达）。
* **`publish config show`** — 补齐。密钥字段掩码，不再需要 `cat .env`。
* **`publish deploy --upstream URL`** — 接入 CLI（与 `-w/--webroot` 互斥）。此前 CLI 只有静态模式。

### 明确降级（不再假装支持）

* **DNSPod** — 原实现无 TC3-HMAC-SHA256 签名（请求只会 401），现改为构造即 `NotImplementedError` 并提示改用 cloudflare/aliyun。
* **VR-011 certbot standalone 降级** — 实际只有 `certbot --nginx`，`--standalone` fallback 从未实现；本条从文档撤回。
* **`--proxy` 开关** — 从未存在；反代用 `--upstream URL` 表达（有 upstream 即反代），参数校验保证与 `-w` 互斥。

### 结构

* `docs/` → `references/`（本仓 references 才算「按需加载的细节」）；6 个文件，均 ≤ 300 行。
* 删除重复的 `references/.env.example`：只保留技能根一份，内容改为真实语义（`<仓库根>/.agents/.env`）。
* 删除 `distill-2026-08-20.md`（含本机绝对路径、项目专属内容）；可复用的坑沉淀为 `references/field-notes.md`。
* 删除 `README.md`（自称「只读镜像、禁止 Edit」，与技能自身定位矛盾且指向已删文件）。
* 删除 `publish.egg-info/`、`__pycache__/`、`.pytest_cache/`、`.ruff_cache/` 等机器本地产物。
* SKILL.md 重写：章节编号连续（原缺 §5）、目录树与真实结构一致、路由指向拆分后的 references。
* `publish/` 全量 ruff 0 问题（原 21 条）；`publish/cli.py` 里重复的 `_get_dns_provider` 删除，统一用 `cli_helpers.get_dns_provider`。

### Tests

* `tests/test_proxy_and_env.py` 恢复可运行（原先连导入都失败）：19 例。
* 合计 **45 passed**。

---

## v0.3.0 (2026-08-20)

### Architecture — 4-layer decomposition

* **Layer 1 (IO)** — `publish/docker/{compose,probe,install}.py` — typed wrappers
  around `ssh.exec_command("docker …")` / `docker-compose` / `certbot`. 2-way
  composable for any compose project (zentao / wordpress / nextcloud / gitlab).
* **Layer 2 (Actions)** — `publish/actions/{dns,nginx,ssl}.py` — one action per
  concern, returns `Step` dataclass, never raises. Trivially sub-agent-friendly.
* **Layer 3 (Pipeline)** — `publish/pipeline.py` — `Step` dataclass + `Pipeline`
  with listener fan-out, short-circuit on hard failure, structured timing.
* **Layer 4 (Router)** — `publish/cli.py` — typer commands only; `publish/commands/`
  houses per-command bodies (config / cert / list).

### File moves

* `cli.py` 443 → **191 lines** (-57%) — now router-only
* new `cli_helpers.py` — promoted `_get_dns_provider` to testable module
* new `commands/{config,cert,list}.py` — extracted non-deploy command bodies

### Tests

* `tests/test_pipeline_and_docker.py` — 26 cases covering Layer 1 + Layer 3
* uses `FakeSsh` to script `exec_command` responses without a real docker daemon
* **45 passed total** (was 19 in v0.2)

### Backwards compatibility

* `publish deploy` (CLI surface) unchanged; users see the same options
* `publish deploy --proxy` (added v0.2) unchanged
* `SshClient` API unchanged — all new helpers compose on top of it

---

## v0.2.0 (2026-08-20)

### New Features

- **VR-009 反代模式**：`publish deploy --proxy --upstream URL` 落地反向代理部署
  - 新增 `publish/nginx/config.py::generate_proxy_server_block()` — 含 WebSocket
    upgrade header、`client_max_body_size 100M`、proxy buffering 优化
  - `cli.deploy` 增加 mutex 校验：`--webroot` 与 `--proxy` 互斥
- **VR-010 vhost 路径自动探测**：`publish/nginx/vhost_probe.py::detect_vhost_target()`
  - 支持宝塔 / cPanel / OpenLiteSpeed / Debian 原生 / RHEL 5 种布局
  - 解决 2026-08-20 实战最大翻车点：**写到错目录 nginx 静默吞配置 → 138B 404**
- **VR-011 certbot 自动降级**：`publish/certs/cert_manager.py::request_cert()`
  - 检测 `certbot_nginx` 插件存在性，缺失时自动用 `--standalone` fallback
  - 自动启停 nginx + iptables 锁 80 端口以完成 HTTP-01 challenge
- **VR-007 upstream URL 校验**：`publish/utils/validators.py::validate_upstream()`
- **VR-008 .env 引号剥离**：`publish/config/store.py::_parse_env_file()`
  - 修 2026-08-20 PowerShell 写 `"C:\..."` 给 paramiko 报 `OSError [Errno 22]` 的根因 <!-- doc-hygiene:allow -->

### Bug Fixes

- `validate_webroot` 强校验现在仅在 **未指定 `--proxy`** 时触发（脱离 `typer.Option(..., required)` 强制）

### Tests

- `tests/test_proxy_and_env.py` — 19 cases 覆盖三态（PASS / BLOCK / 边界）

### Docs

- `SKILL.md §4.5` 增加反代模式说明
- 仓库内 sink [README.md + distill-2026-08-20.md](skill-markets/website-helper-skill/) — 蒸馏原始踩坑
