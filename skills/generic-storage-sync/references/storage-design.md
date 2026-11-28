# 缓冲盘拓扑与索引物理设计

> 本文件描述 `generic-storage-sync` 的物理布局与数据形态。安全红线见 [rules.md](./rules.md)，
> 命令用法见 [commands.md](./commands.md)，驱动契约见 [driver-spi.md](./driver-spi.md)。

---

## 1. 三层拓扑

```
[工作空间 repos/]                ← 原始全量代码，只读追踪
       │  pack
       ▼
[本地缓冲盘 buffer/]             ← 高效压缩块，热缓存
   ├── .staging/                 ← 打包中间体，失败即删
   ├── .trash/                   ← 软淘汰快照，冷却期保护
   │   └── orphans/              ← 未登记游离文件，人工裁决
   ├── .ghh-index.json           ← 本地 Storage-ORM 快照库
   └── <owner>__<repo>-<sha>.bundle
       │  push
       ▼
[介质 Target/]                   ← 冷备份与多机共享
   ├── .trash/                   ← 介质端回收站（同样有冷却期）
   ├── .ghh-index.json           ← 远端全局索引，快速检索入口
   └── <owner>__<repo>-<sha>.bundle
```

- 缓冲盘根由 `.agents/.env` 的 `STORAGE_BUFFER_SPACE` 决定，缺省 `<PROJECT_ROOT>/buffer`。
- 介质根由 `STORAGE_TARGET_<ID>` 的 endpoint 决定；相对路径相对 `PROJECT_ROOT` 解析。

---

## 2. 快照文件命名与格式

| 项 | 约定 |
|---|---|
| 文件名 | `<owner>__<repo>-<短SHA>.bundle`（`archiveName` 原样即最终名，缺 `.bundle` 后缀才补） |
| 格式 | 默认 `git bundle`（保留完整历史，下载后一条 `git clone <bundle>` 即可还原） |
| 打包范围 | `git bundle create <file> --all` —— 含分支 + tags + HEAD |
| 增量 | 实体带 `baseCommitSha` 时走 `git bundle create <file> HEAD ^<base>`，不改表结构 |
| 完整性 | 打包时**单遍流式**算 SHA-256，不二次读盘 |

> 只传 `HEAD` 会丢掉 tags 与其它分支，新机器上无法 `git tag`、无法切分支——违背「完整追踪」定位。
> Detached HEAD 状态下以分支名解包也会报错。

---

## 3. 索引物理结构

**唯一事实源**：`scripts/index_store.mjs`。固定结构：

```json
{
  "version": "1.0",
  "updatedAt": "2026-11-27T16:00:00.000Z",
  "snapshots": { "<owner/repo>": { "...": "SnapshotEntity" } },
  "syncRecords": { "<owner/repo>::<targetId>": { "...": "SyncRecordEntity" } },
  "targets": { "<targetId>": { "...": "StorageTargetEntity" } }
}
```

### 3.1 实体

| 实体 | 关键字段 |
|---|---|
| `SnapshotEntity` | `fullName`（键）、`group?`、`commitSha`、`commitShort`、`commitDate`、`archiveName`、`archiveFormat`（`git-bundle`/`tar-zst`/`raw`）、`sizeBytes`、`checksumSha256`、`baseCommitSha?`、`tags[]`、`status?`/`purgedAt?`/`purgedPath?`（核销时写入） |
| `SyncRecordEntity` | `repoFullName`、`targetId`、`syncedCommitSha`、`syncedArchiveName`、`syncedAt`、`status`（`synced`/`pending`/`drifted`/`purged`） |
| `StorageTargetEntity` | `id`、`type`（`local`/`sftp`/`smb`/`baidu`/`quark`）、`endpoint`、`enabled`、`priority`、`lastSyncedAt?` |

### 3.2 仓储 API

| API | 语义 |
|---|---|
| `save(snapshot)` | 登记 / 覆盖一个快照条目并落盘 |
| `recordSync(record)` | 写一条介质端记账并落盘 |
| `commit(snapshot, record)` | **快照与记账一次原子落盘**——协调器 Phase 2 用它，避免两写之间崩溃留下「有快照无记账」 |
| `get(fullName)` / `list()` | 读快照条目 / 列全部快照 |
| `delete(fullName)` | 只移除索引条目，**不碰介质实体文件** |
| `saveTarget(target)` / `listTargets()` | 介质登记表 |
| `listSyncRecords()` | 列全部记账 |

### 3.3 两条设计约束

1. **索引只记每仓「当前版本」**（键 = `fullName`）。同一仓的多个历史版本**不在索引里**，
   历史清单以**介质目录**为准。淘汰判定由「介质目录 + 索引记账」组装。
2. **`computeDrift()` 是纯函数**：以 `commitSha` + `archiveName` 判定一致性，
   **忽略跨系统 mtime**（不同介质的 mtime 不可比）。

```js
computeDrift(localSnapshots, targetRecords)
// → { toUpload: [...], toTrash: [...], upToDate: [...] }
```

`status === 'purged'` 的记账视为「已核销」，既不上传也不回收。

---

## 4. 原子写入纪律

所有索引 / 清单写入统一走：

```
写 .tmp → fs.renameSync 替换目标
```

- 崩溃 / 断电后旧文件完好，不会出现半截 JSON；
- 残留的 `.tmp` 由 `clean-staging` 清理；
- `writeIndexAtomic()` 提供 `hooks.beforeRename` 故障注入点，用于单测「写入中断后旧索引仍可读」。

---

## 5. 同步事务与灾难恢复

**Push 两阶段提交**：

```
Phase 1 载荷提交：packBundle → driver.upload → 比对 bytesWritten + sha256
        │ 校验失败 / 传输中断 → 半成品 moveToTrash → 状态零污染
        ▼
Phase 2 索引提交：driver.writeIndex(远端 .ghh-index.json) → 本地 recordSync
        │ 任一步失败 → 双方回滚
        ▼
完成
```

**Pull**：读远端索引 → 下载 bundle → 本地重算 SHA-256 → `git clone <bundle>` 还原 → 记账。

**灾难恢复 `rebuild()`**：仅凭远端 `.ghh-index.json` 重建本地索引与 Ledger。
已核销（`status === 'purged'`）的快照**不**回填到本地索引，也不计入 `missing`。

---

## 6. 生命周期与淘汰

四阶管道：

| 阶段 | 动作 | 触发 |
|---|---|---|
| 1 版本淘汰判定 | 按 `STORAGE_MAX_RETAINED_SNAPSHOTS` 标出超期旧版本 | 新快照落盘后 |
| 2 软淘汰 | `moveToTrash` → `.trash/<ts>_<原名>` | 阶段 1 判定 |
| 3 冷却期 | 静置 `STORAGE_TRASH_TTL_DAYS` 天，期间可秒级回滚 | 自动 |
| 4 物理抹除 | `purge` 真删 + 索引核销 | `clean-trash --yes` |

- 冷却保护窗口 = `[0, TTL)`，**恰好等于 TTL 即判到期**。
- 回收站条目时间取文件名 `<ts>_` 前缀（`rename` 不刷新 mtime，直接用 mtime 会把新淘汰件误判成早到期）。
- `.trash/orphans/` 默认不进入自动清理队列（见 [rules.md](./rules.md) §1.4）。

---

## 7. 介质扩展位

- `type` 支持 `local` / `sftp` / `smb` / `baidu` / `quark`。
- 除 `local`（内置 `LocalFsDriver`）外，其它类型由 CLI **动态发现兄弟技能**中继承 `BaseDriver`
  且 `driverType` 匹配的实现；未安装即明确报「驱动未安装」，**绝不假装成功**。
- 外部驱动的开发与验收标准见 [driver-spi.md](./driver-spi.md)。
