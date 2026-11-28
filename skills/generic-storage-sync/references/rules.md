# 存储安全红线与防灾铁律

> 本文件是 `generic-storage-sync` 的**安全权威**。任何改动本技能的代码若与本文件冲突，以本文件为准。
> 相关：[storage-design.md](./storage-design.md)（物理布局）、[commands.md](./commands.md)（命令用法）、[driver-spi.md](./driver-spi.md)（驱动契约）。

---

## 1. 四条防灾铁律

### 1.1 绝对保底律

> 任何仓库在任何介质上**必须至少保留 1 个最新可用快照**，严禁把历史清零。

- 淘汰计算必须硬拦：`keepCount = max(1, keepCount)`，`keepCount = 0 / -5 / undefined` 一律夹为 1。
- 即使 `STORAGE_MAX_RETAINED_SNAPSHOTS` 被误配成 0，也**不得**触发清空。
- 落点：`lifecycle.mjs` 的 `evaluateRetention()`；由 `lifecycle.test.mjs` 的
  「只有 1 个快照 → 淘汰清单为空」「keepCount 被夹为 1」两个用例担保。

### 1.2 演练优先律（Dry-Run by Default）

> 所有清理命令默认只出清单，不动手。真正执行必须显式 `--yes`。

- `prune` / `clean-trash` **默认 dry-run**：输出拟删清单、所属仓库、可释放字节数，**不删任何文件**。
- dry-run 下连回收站目录都不应被创建——「不动作」是可验证的，不是「删了但不说」。
- 非交互执行（CI、脚本调用）必须显式带 `--yes`，不得依赖任何默认值。
- 落点：`lifecycle.mjs` 的统一执行闸门；由「dry-run 后介质文件数不变」用例担保。

### 1.3 两阶段防分叉律（Index-First Purge）

> 物理删除**之前**，先在索引里标记 `purged` 并原子落盘。

- 顺序不可颠倒：先记账 → 再删文件。反过来做，崩溃后索引会挂着指向已删文件的死引用。
- 记账落在 `SyncRecordEntity.status = 'purged'`；`computeDrift()` 视 `purged` 为「已核销，不再动它」。
- 落点：`lifecycle.mjs` 的核销 + `IndexStore.persist()` 原子写；由「执行后索引记账为 purged」「删除时刻索引已是 purged」的时序取证用例担保。

### 1.4 孤儿防御律

> 未在索引登记的游离文件**不得直接删除**，先隔离到 `.trash/orphans/` 交人工裁决。

- 扫描（`scanOrphans`）只报告不动手；隔离（`quarantineOrphans`）走 `moveToTrash`，**隔离 ≠ 删除**。
- `.trash/orphans/` **默认不进入**自动物理清理队列（需显式 `includeOrphans: true`）——孤儿要人看，机器不许自作主张。
- 落点：`lifecycle.mjs` 的孤儿扫描与隔离；由「孤儿被扫出、dry-run 不动它、真执行隔离到 /orphans/ 且文件仍在」用例担保。

---

## 2. 物理删除红线

**全流程唯一允许真正删文件的入口**：`lifecycle` 的 `purgeExpired()`，且必须同时满足：

1. 冷却期满（`age >= STORAGE_TRASH_TTL_DAYS`，保护窗口是 `[0, TTL)`）；
2. 调用方显式要求真执行（CLI 侧即 `--yes`）；
3. 该仓库在该介质上仍保有至少 1 个最新可用快照（保底律）。

以下路径**一律禁止**物理删除：

- 协调器（`sync_coordinator.mjs`）的任何失败回退——一律 `moveToTrash`；
- 驱动的 `moveToTrash`——只做移动；EXDEV 兜底时的「删除源」是移动的最后一步，源在回收站已有校验过的副本；
- 打包管道的失败清理——只删**自己刚建**的暂存体；
- 驱动传输失败清理——只删**自己刚建**的 `.gss-part` 临时体。

> 判定标准：**「这个文件是不是本技能自己刚刚创建的临时产物」**。是 → 可删；否 → 只能进 `.trash/`。

---

## 3. 介质与索引红线

- **索引 schema 唯一事实源 = `index_store.mjs`**，固定结构：
  `{ version: '1.0', updatedAt, snapshots: {}, syncRecords: {}, targets: {} }`。
- **驱动层只做字节透传**：`readIndex()` 返回已解析对象或 `null`；`writeIndex()` 接受对象或字符串。
  驱动**不得**自定义索引结构，否则同一文件会被两套 schema 互相覆盖。
- **索引只记每个仓库的「当前版本」**（键 = `fullName`）。历史版本清单以**介质目录**为准，
  淘汰判定由「介质目录 + 索引记账」组装，不要试图让索引存历史版本。
- **原子写入**：任何索引 / 清单写入走 `.tmp` + `rename`，禁止直接覆写。
- **索引 schema 版本**：读取时若 `major` 高于当前实现版本，直接拒绝读取并报错，不得静默降级。

---

## 4. 驱动接入红线（面向百度 / 夸克 Agent）

1. **禁止物理删除**代替 `moveToTrash`——淘汰一律进 `.trash/`，物理抹除只在 `purge`。
2. **禁止在钩子里吞掉异常**——失败必须抛带 `code` 的 `DriverError`（`GSS_E_*`）。
3. **禁止整文件读入内存**做上传 / 下载 / 校验——必须流式。
4. **禁止用 `node:path` 的 `join` 拼远端路径**——会压掉 UNC 前缀，用 `this.joinPath()`。
5. **禁止硬编码本机绝对路径**——端点与凭据一律走 `.agents/.env`。
6. **禁止覆写基类公共方法**——只实现 `_xxx` 钩子，否则路径规整与错误归一会被绕过。
7. **必须真的接 `onProgress` 与 `signal`**——大文件上传数分钟，无进度即假死，Ctrl+C 无法释放连接。
8. **提交前必须跑合规套件**：`runDriverComplianceTests()`，绿灯再人工复核。

---

## 5. 路径与配置红线

- 介质来源：`.agents/.env` 的 `STORAGE_TARGET_<ID>`，值格式 `<type>:<endpoint>`；
  介质 id = 变量名去掉 `STORAGE_TARGET_` 前缀后的小写形式；同名时**索引优先于环境变量**。
- 相对 endpoint 一律相对 `PROJECT_ROOT` 解析，**绝不依赖进程 cwd**。
- 文档与代码中**禁止出现本机绝对路径**；示例用 `~` 或占位符。
- 凭据由对应驱动的 Agent 管理，本技能**不代管、不代写** `.agents/.env`。

---

## 6. 禁止事项速查

| 禁止 | 正确做法 |
|---|---|
| 直接 `rm` 淘汰快照 | `moveToTrash` 进 `.trash/`，冷却期满后由 `clean-trash --yes` 抹除 |
| 清理命令默认就删 | 默认 dry-run，真执行显式 `--yes` |
| 把某仓库历史清零 | 至少保留 1 个最新可用快照 |
| 先删文件再记账 | 先在索引标记 `purged` 并原子落盘，再删 |
| 删除未登记的游离文件 | 先隔离到 `.trash/orphans/`，人工裁决 |
| 驱动里另造索引 schema | schema 唯一事实源是 `index_store.mjs` |
| 整文件读入内存做传输 | 流式管道 + 边传边算 SHA-256 |
| 硬编码本机绝对路径 | 配置走 `.agents/.env`，路径走 `loadEnv()` |
| 打包只传 `HEAD` | `git bundle create <file> --all`（否则丢 tags 与其它分支） |
| 用 `node:path` 的 `join` 拼远端路径 | 用 `this.joinPath()`（保护 UNC 前缀） |
