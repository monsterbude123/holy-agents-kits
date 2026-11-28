# 命令详解与典型场景

> 入口：`node scripts/sync_cli.mjs <command> [options]`，所有命令在**项目根**执行。
> 配置统一走 `.agents/.env`；介质端点、缓冲盘、保留策略都不接受硬编码。
> 安全红线见 [rules.md](./rules.md)，物理布局见 [storage-design.md](./storage-design.md)。

---

## 0. 速查表

| 命令 | 作用 | 默认行为 |
|---|---|---|
| `target list` | 列出已配置介质 | 只读 |
| `target add <id> --type <t> --endpoint <p>` | 登记介质到索引 | 写索引 |
| `target test [id]` | 介质连通性探活 | 只读 |
| `status [--trash]` | 同步健康状况 / 回收站占用 | 只读 |
| `diff <target>` | 漂移清单 | 只读 |
| `pack <repo_path> [--name <owner/repo>]` | 打包入本地缓冲盘 | 写缓冲盘 |
| `push <repo_path> [--target <id>] [--name <owner/repo>]` | 两阶段提交推送 | 写介质 |
| `pull <owner/repo> --from <id> [--dest <path>]` | 拉回并还原 | 写工作区 |
| `prune [target] [--yes]` | 淘汰超量旧版本进回收站 | **dry-run** |
| `clean-trash [target] [--yes]` | 物理清理冷却期满的回收站 | **dry-run** |
| `clean-staging [--dry-run]` | 清暂存残卷与索引临时件 | 列出后清理 |

---

## 1. 介质管理

```bash
node scripts/sync_cli.mjs target list
node scripts/sync_cli.mjs target add backup-nas --type local --endpoint ./backup/snapshots
node scripts/sync_cli.mjs target test backup-nas
```

- **介质来源**：`.agents/.env` 的 `STORAGE_TARGET_<ID>`（值格式 `<type>:<endpoint>`）+ 索引 `targets` 表；
  **同名时索引优先**。
- **介质 id** = 变量名去掉 `STORAGE_TARGET_` 前缀后的小写形式。
- `target add` 只写本地索引，**不代写 `.agents/.env`**，也不代管凭据。
- `target test` 输出每个介质的探活结论；失败介质以 `✗` 标出并计入失败数。

---

## 2. 打包（pack）

```bash
node scripts/sync_cli.mjs pack ./repos/acme/widget --name acme/widget
```

- 在缓冲盘 `.staging/` 里执行 `git bundle create <file> --all`（含分支 + tags + HEAD）；
- 单遍流式算 SHA-256，`git bundle verify` 校验产物；
- 校验通过后**原子移入**缓冲根目录，失败自动清理残卷；
- `--name` 缺省时从 git remote origin 推导 `owner/repo`，取不到则用目录名 `owner__repo` 形式。

---

## 3. 推送（push）

```bash
node scripts/sync_cli.mjs push ./repos/acme/widget --target backup-nas
```

- **Phase 1 载荷提交**：打包 → 上传 → 比对字节数与 SHA-256；
- **Phase 2 索引提交**：校验通过后才回写远端 `.ghh-index.json` 并写本地记账；
- 任一步失败（网络中断、哈希不符）→ 半成品 `moveToTrash`，**状态零污染**；
- 只有一个介质时可省略 `--target`；有多个必须显式指定。

---

## 4. 拉取（pull）

```bash
node scripts/sync_cli.mjs pull acme/widget --from backup-nas --dest ./repos/acme/widget
```

- 读远端索引 → 下载 bundle → 本地重算 SHA-256 校验 → `git clone <bundle>` 还原；
- 校验不过则**不产出工作区**；远端没有该快照报 `GSS_E_NOT_FOUND`。

---

## 5. 状态（status）

```bash
node scripts/sync_cli.mjs status
node scripts/sync_cli.mjs status --trash
```

- 展示本地缓冲与各介质的同步健康状况；
- `--trash` 追加回收站占用（文件数 + 可释放字节数）。

---

## 6. 漂移清单（diff）

```bash
node scripts/sync_cli.mjs diff backup-nas
```

- 输出三段清单：`toUpload`（需新增或升级）、`toTrash`（需转入回收站的旧版本）、`upToDate`（一致跳过）；
- 判定依据是 `commitSha` + `archiveName`，**不依赖跨系统 mtime**；
- 纯只读，不做任何修改。

---

## 7. 淘汰旧版本（prune）

```bash
node scripts/sync_cli.mjs prune backup-nas          # 演练
node scripts/sync_cli.mjs prune backup-nas --yes    # 真执行（软淘汰进回收站）
```

- 按 `STORAGE_MAX_RETAINED_SNAPSHOTS` 判定超量版本，**保底保留 1 个最新快照**；
- 真执行也只是移进 `.trash/`，**不物理删除**；
- 默认 dry-run：只打印拟淘汰清单、所属仓库与可释放字节数。

---

## 8. 清理回收站（clean-trash）

```bash
node scripts/sync_cli.mjs clean-trash backup-nas          # 演练
node scripts/sync_cli.mjs clean-trash backup-nas --yes    # 真物理抹除
```

- 只清理**冷却期满**的条目（保护窗口 `[0, TTL)`，恰好等于 TTL 即到期）；
- 真执行时**先在索引标记 `purged` 并原子落盘，再删文件**（索引先行）；
- 全流程唯一允许真正删文件的入口；
- `.trash/orphans/` 默认不在清理队列（孤儿需人工裁决）。

---

## 9. 清理暂存残卷（clean-staging）

```bash
node scripts/sync_cli.mjs clean-staging
```

- 清理缓冲盘 `.staging/` 的异常中断残卷与索引原子写留下的 `.tmp`；
- `--dry-run` 只列出将清理什么。

---

## 10. 配置速查（`.agents/.env`）

```bash
# 本地缓冲盘（缺省 <PROJECT_ROOT>/buffer）
STORAGE_BUFFER_SPACE="./buffer"

# 介质：变量名去掉 STORAGE_TARGET_ 前缀后的小写形式即介质 id
# 值格式 <type>:<endpoint>，type ∈ local|sftp|smb|baidu|quark
STORAGE_TARGET_LOCAL_BACKUP="local:./backup/snapshots"

# 每个仓库在介质上保留的最大完整快照数（保底 ≥ 1）
STORAGE_MAX_RETAINED_SNAPSHOTS=2
# 回收站冷却存活期（天，超过才允许物理清除）
STORAGE_TRASH_TTL_DAYS=7
```

---

## 11. 典型场景

| 场景 | 命令序列 |
|---|---|
| 首次接入一个新介质 | `target add` → `target test` → `pack` → `push` |
| 日常备份 | `pack` → `push` |
| 换机器后恢复工作区 | `pull <owner/repo> --from <id> --dest <path>` |
| 本地索引丢了 | 凭远端 `.ghh-index.json` 执行 `rebuild()` 重建 |
| 网盘快满了 | `status --trash` → `clean-trash --yes`（先演练看释放量） |
| 想看看哪些该同步 | `diff <target>` |
