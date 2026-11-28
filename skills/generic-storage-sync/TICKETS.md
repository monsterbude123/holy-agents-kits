# [TICKETS] generic-storage-sync 独立技能实施工单

> **看板**： [.agents/TICKETS.md](../../TICKETS.md) ｜ **规范**： [SPEC.md](./SPEC.md)
> **约束**：纯原生 `.mjs`（Node ≥ 18）、零 npm 依赖、零编译构建、跨平台、TDD 先行。
> **定位**：本技能是**独立技能**，与 `github-kownledge-helper` 物理隔离、零代码耦合（仅通过 CLI 互相调用）。
> **本文件为工单 SSOT**：每张票的详情只在此处，`SPEC.md` 只写设计不写进度。

---

## 工单依赖拓扑

```
[TKT-01 环境加载器] ──► [TKT-02 索引 ORM] ──┐
                    │                      │
                    ├─► [TKT-03 驱动 SPI + 本地驱动] ─┬──► [TKT-05 两阶段提交协调器] ──► [TKT-07 CLI + 技能门禁]
                    │                                 │            │                          │
                    └─► [TKT-04 Bundle 打包 + 缓冲池] ─┘            ▼                          ▼
                                                    [TKT-06 生命周期清理] ────────────► [TKT-09 跨技能接入]
                                                                     │
[TKT-03] ──► [TKT-08 驱动合规测试套件]（供百度 / 夸克 Agent 一键验收）
```

---

<a id="tkt-01"></a>

### [TKT-01] 原生 `.agents/.env` 加载器 + node:test 单测

- **状态**：`done`（`scripts/env.mjs` 已落地；`scripts/test/env.test.mjs` 已补，14 用例全绿；2026-11-27 与 `github-kownledge-helper/scripts/lib/env.mjs` 同源对齐，逐字节一致，SHA256 `2EB2995E…`；env.mjs 实现未改动，无需字节级同步）
- **类型**：Foundation
- **涉及文件**：`scripts/env.mjs`（已存在）、`scripts/test/env.test.mjs`（待建）
- **目标**：零依赖解析 `.agents/.env`，向上递归探测，派生缓冲盘与生命周期相关配置的默认值。
- **已实现能力（勿重写）**：`parseDotEnv` / `findEnvFile` / `loadEnv` / `_resetForTest`；已解析 `GITHUB_KNOWLEDGE_HELPER_SPACE`（兼容历史拼写 `GITHUB_KOWNLEDGE_HELPER_SPACE`）、`STORAGE_BUFFER_SPACE`、`STORAGE_MAX_RETAINED_SNAPSHOTS`、`STORAGE_TRASH_TTL_DAYS`、`STORAGE_AUTO_TRASH_ON_PUSH`。
- **待做**：
  1. 补 `scripts/test/env.test.mjs`：覆盖注释行、空行、引号包裹值、`=` 出现在值内、`process.env` 优先级覆盖 `.agents/.env`、找不到文件时的默认值回退、向上探测命中父目录；
  2. 确认 `loadEnv` 的 `startDir` 参数可用（测试隔离用），不得因向上探测读到真实 `.agents/.env` 导致断言失真；
  3. 若 `github-kownledge-helper` 侧也迁出 `env.mjs`（GHK-07），**两处保持同源同行为**。
- **验收标准 (DoD)**：`node --test scripts/test/env.test.mjs` 全绿；用例 ≥ 8；零 npm 依赖。

---

<a id="tkt-02"></a>

### [TKT-02] 存储 ORM：实体定义、原子仓储与差异比对

- **状态**：`done`（`scripts/index_store.mjs`；`scripts/test/index_store.test.mjs` 22 用例全绿；覆盖 CRUD / 漂移计算 / 崩溃模拟 / schema 版本 / `commit()` 单次原子提交；schema 唯一事实源 = 本模块，driver 层只做字节透传）
- **类型**：Core Engine
- **前置依赖**：TKT-01
- **涉及文件**：`scripts/index_store.mjs`、`scripts/test/index_store.test.mjs`
- **目标**：介质载体无关的快照索引。内存维护实体，落盘为介质根目录下的 `.ghh-index.json`（单文件、轻量、可直接被人读）。
- **核心能力**：
  1. 实体：`SnapshotEntity`（`fullName` / `group` / `commitSha` / `commitShort` / `commitDate` / `archiveName` / `archiveFormat` / `sizeBytes` / `checksumSha256` / `baseCommitSha?` / `tags`）、`SyncRecordEntity`（`repoFullName` / `targetId` / `syncedCommitSha` / `syncedArchiveName` / `syncedAt` / `status`）、`StorageTargetEntity`（`id` / `type` / `endpoint` / `enabled` / `priority` / `lastSyncedAt?`）；
  2. CRUD：`save(snapshot)` / `get(fullName)` / `list()` / `delete(fullName)` / `recordSync(record)`；
  3. 纯函数 `computeDrift(localSnapshots, targetRecords)` → `{ toUpload, toTrash, upToDate }`，以 `commitSha` + `archiveName` 判定，**忽略跨系统 mtime**；
  4. 原子落盘：`.tmp` 写入 + `fs.renameSync` 替换，崩溃后原索引零污染；
  5. 索引文件含 `version` 字段，供后续 schema 演进。
- **验收标准 (DoD)**：
  - 单测覆盖新增 / 更新 / 删除 / 漂移计算 / 崩溃模拟（写入中断后旧索引仍可读）/ 索引版本号，用例 ≥ 8；
  - `computeDrift` 为纯函数，无 I/O 副作用；
  - 单文件 ≤ 130 行（原定 120，因后续新增 `commit()` 原子提交 API 与实体字段注释放宽 4 行；skill-creator-v2 门禁只校验 SKILL.md 150 行与 references 300 行，不校验 scripts 行数）。

---

<a id="tkt-03"></a>

### [TKT-03] 统一存储驱动 SPI 与本地物理 / 挂载盘驱动

- **状态**：`done`（`scripts/driver_spi.mjs` 140 行 / `scripts/local_driver.mjs` 150 行 / `scripts/test/local_driver.test.mjs` 13 用例全绿 / `references/driver-spi.md` 290 行；模板方法 + 15 个错误码 `GSS_E_*`；UNC 前缀保护、onProgress/AbortSignal、EXDEV 兜底、Trash 落点均已覆盖）
- **类型**：Driver SPI
- **前置依赖**：TKT-01
- **涉及文件**：`scripts/driver_spi.mjs`、`scripts/local_driver.mjs`、`scripts/test/local_driver.test.mjs`、`references/driver-spi.md`
- **目标**：发布驱动契约基类 `BaseDriver`，并实现覆盖本地物理盘、移动硬盘、Windows 盘符挂载、SMB/NFS 挂载目录的 `LocalFsDriver`。
- **核心能力**：
  1. 接口面：`ping` / `upload` / `download` / `exists` / `stat` / `list` / `moveToTrash` / `readIndex` / `writeIndex`（+ `purge`，仅 lifecycle 在冷却期满后调用）；
  2. `upload(localSrc, remoteDst, { onProgress, signal })` **必须原生支持进度回调与 `AbortSignal`**（大文件上传数分钟，无进度会假死，Ctrl+C 无法释放连接）；
  3. `BaseDriver` 统一路径规整：Windows 反斜杠转 POSIX，且**必须保护 UNC 前缀**（`\\host\share` / `//nas/share`）不被压成单斜杠；
  4. `LocalFsDriver.upload/download` 用 Node 原生流管道，**不得整文件读入内存**；
  5. `moveToTrash`：淘汰快照移入介质端 `.trash/<ts>_<name>`，**严禁物理 unlink**；
  6. 跨盘符移动的 `EXDEV` 兜底：复制 → 校验 → 删除源；
  7. 产出 `references/driver-spi.md`：完整接口签名 + 生命周期时序 + 错误码清单 + 最小实现模板。
- **验收标准 (DoD)**：本地盘用例 ≥ 8（含 UNC 路径规整、EXDEV 兜底、Trash 落点、进度回调触发）；`references/driver-spi.md` 满足 ≤ 300 行且无本机绝对路径；门禁 0 error 0 warn。

---

<a id="tkt-04"></a>

### [TKT-04] Git Bundle 打包流水线与本地暂存缓冲池

- **状态**：`done`（`scripts/buffer_pipeline.mjs` 146 行 / `scripts/test/buffer_pipeline.test.mjs` 9 用例全绿；真 git fixture；已实测 `--all` 含 tag+多分支、只传 `HEAD` 会丢 refs；单遍流式 SHA-256 + `.staging` 隔离 + 原子移入）
- **类型**：Buffer Pipeline
- **前置依赖**：TKT-01
- **涉及文件**：`scripts/buffer_pipeline.mjs`、`scripts/test/buffer_pipeline.test.mjs`
- **目标**：把本地仓库打成单文件 `.bundle` 并同步产出 SHA-256 指纹，落到本地缓冲盘。
- **核心能力**：
  1. `git bundle create <file> --all`（**必须 `--all`**：只传 `HEAD` 会丢 tags 与其他分支，破坏"完整追踪"定位；Detached HEAD 状态下 `HEAD` 也会报错）；
  2. 打包在缓冲盘 `.staging/` 隔离目录进行，校验通过后原子移入缓冲根目录，失败自动清理残卷；
  3. 通过 `node:crypto` 流式计算 SHA-256（不二次读盘），同时返回文件大小；
  4. 预留增量打包：`baseCommitSha` 字段存在后，可执行 `git bundle create <file> HEAD ^<base>` 而不改表结构；
  5. 打包后用 `git bundle verify` 校验产物合法性。
- **验收标准 (DoD)**：用**真实 git 临时仓库 fixture**（含 tag + 多分支）跑通端到端；SHA-256 与 `sha256sum` 一致；`.staging` 失败清理路径有测试覆盖；单文件 ≤ 150 行。

---

<a id="tkt-05"></a>

### [TKT-05] 两阶段提交同步协调器（Push / Pull / 索引重建）

- **状态**：`done`（`scripts/sync_coordinator.mjs` 149 行 / `scripts/test/sync_coordinator.test.mjs` 10 用例全绿；断网与哈希篡改两条失败路径实测：远端索引未写、本地 Ledger 无半截记录、半成品进 `.trash/`；协调器零 `purge` 调用）
- **已知缺口（已修复）**：曾存在「`save()` 与 `recordSync()` 各落盘一次，两写之间硬 kill 会留下『有快照无记账』」的窗口 → 已新增 `IndexStore.commit(snapshot, record)` 单次原子提交，协调器 Phase 2 与 pull 路径改用它，并补 2 例测试（含中断后旧快照与旧记账均完好）。
- **类型**：Sync Orchestrator
- **前置依赖**：TKT-02、TKT-03、TKT-04
- **涉及文件**：`scripts/sync_coordinator.mjs`、`scripts/test/sync_coordinator.test.mjs`
- **目标**：串联「打包 → 上传介质 → 完整性校验 → 回写远端索引 → 本地记账」全链路事务，并支持反向拉取与灾难恢复。
- **核心能力**：
  1. **Phase 1（Payload Commit）**：上传快照文件，驱动层比对字节数与 SHA-256；
  2. **Phase 2（Index Commit）**：校验通过后才回写介质端 `.ghh-index.json` 并更新本地 Ledger；任一步异常（断网、哈希不符）自动 `moveToTrash` 半成品，**状态零污染**；
  3. `pull` 流程：读远端索引 → 下载指定 bundle → 校验哈希 → 还原到工作区；
  4. 灾难恢复：以远端 `.ghh-index.json` 重建本地 Ledger 与索引。
- **验收标准 (DoD)**：集成测试模拟**断网**与**哈希篡改**两种故障，断言自动回退且索引未被写脏；用例 ≥ 6。

---

<a id="tkt-06"></a>

### [TKT-06] 生命周期与安全清理引擎（四阶淘汰 + 四铁律）

- **状态**：`done`（`scripts/lifecycle.mjs` 149 行 / `scripts/test/lifecycle.test.mjs` 14 用例全绿；四铁律逐条有代码位点 + 用例担保；TTL 边界 = `[0, TTL)`，恰好等于 TTL 判到期；回收站条目时间取文件名 `<ts>_` 前缀而非 mtime）
- **口径裁决**：
  - 索引**只记每仓「当前版本」**，历史版本清单以**介质目录**为准 → CLI 侧用「介质目录 + 索引记账」组装淘汰清单（已写入 TKT-07 的实现口径）。
  - `.trash/orphans/` **默认不进入**自动物理清理队列（孤儿铁律要求人工裁决），仅显式 `includeOrphans: true` 才纳入。
  - `SnapshotEntity` 允许可选 `status` / `purgedAt` / `purgedPath`（lifecycle 核销时写入），已回填 `index_store.mjs` 实体注释。
- **类型**：Lifecycle & Pruning
- **前置依赖**：TKT-03、TKT-05
- **涉及文件**：`scripts/lifecycle.mjs`、`scripts/test/lifecycle.test.mjs`
- **目标**：防磁盘 / 网盘空间爆炸。只同步不淘汰，数周内历史 `.bundle` 就会堆爆空间。
- **四阶管道**：
  1. **版本淘汰判定**：新快照生成后按 `STORAGE_MAX_RETAINED_SNAPSHOTS`（默认 2）标出超期旧版本；
  2. **软淘汰**：`moveToTrash` 移入介质 `.trash/<ts>_<archive>`；
  3. **冷却期保护**：静置 `STORAGE_TRASH_TTL_DAYS`（默认 7）天，期间可秒级回滚；
  4. **物理抹除**：仅 `clean-trash --yes` 显式触发，并同步核销索引记账。
- **防灾四铁律（写进 `references/rules.md`）**：
  1. **绝对保底**：任何仓库在任何介质上至少保留 1 个最新可用快照，严禁清零；
  2. **演练优先**：所有清理命令默认 Dry-Run，只打印拟删清单与可释放字节数；非交互执行必须显式 `--yes`；
  3. **索引先行**：物理删除前先在索引标记 `purged` 并原子落盘，避免索引挂死引用；
  4. **孤儿防御**：未在索引登记的游离文件不直接删，先隔离到 `.trash/orphans/` 交人工裁决。
- **核心方法**：`evaluateRetention(repoSnapshots, keepCount)` / `scanExpiredTrash(driver, ttlDays)` / `purgeExpired(driver, fileList)`。
- **验收标准 (DoD)**：单测覆盖 0 快照保底拦截 / 超量淘汰 / TTL 到期精确判定 / Dry-Run 零破坏性 / 孤儿隔离，用例 ≥ 8。

---

<a id="tkt-07"></a>

### [TKT-07] 独立 CLI 入口 + 技能文档 + `/skill-creator-v2` 门禁

- **状态**：`done`（`scripts/sync_cli.mjs` + `scripts/lib/{cli_targets,cli_sync,cli_lifecycle}.mjs` + `scripts/test/sync_cli.test.mjs` 18 用例全绿；`SKILL.md` 88 行 + `references/{rules,storage-design,commands}.md`；门禁 **0 error 0 warn**）
- **门禁达标要点**：
  - `SKILL.md` 补「§4 脚本清单」列出全部 21 个脚本 —— `SCRIPT_LINK_RE` 只扫 SKILL.md 正文，缺清单即报 `script.orphan`；
  - `references/driver-spi.md` 压到 ≤ 300 行（合规章节由 8 条 checklist 收敛为 1 行覆盖项 + 用法说明）；
  - SKILL.md 链到全部 4 篇 references，无孤儿。
- **真实链路验收**（临时缓冲盘 + 临时介质）：`target list` → `target test` → `pack`（真实 git bundle 202.9 KiB + SHA-256）→ `push`（两阶段提交）→ `diff`（upToDate 1）→ `prune`/`clean-trash` 演练，均正确。
- **命令面对账**：管家技能 `references/workflows.md §7.2` 的命令签名已按实现校正（`push <repo_path>` / `pull <owner/repo>` / `target add <id> --type --endpoint`）。
- **类型**：UX & Skill Delivery
- **前置依赖**：TKT-05、TKT-06
- **涉及文件**：`scripts/sync_cli.mjs`、`SKILL.md`（新建）、`references/rules.md`、`references/storage-design.md`、`references/commands.md`（均新建）
- **命令面**（SPEC §7 全量落地）：
  ```bash
  node scripts/sync_cli.mjs target list|add|test
  node scripts/sync_cli.mjs status [--trash]
  node scripts/sync_cli.mjs diff <target>
  node scripts/sync_cli.mjs pack <repo_path>
  node scripts/sync_cli.mjs push <repo> [--target <id>]
  node scripts/sync_cli.mjs pull <repo> --from <id>
  node scripts/sync_cli.mjs prune [target] [--yes]
  node scripts/sync_cli.mjs clean-trash [target] [--yes]
  node scripts/sync_cli.mjs clean-staging
  ```
- **文档要求**：
  - `SKILL.md`：合法 YAML frontmatter（`name` + `description`）、主轴决策表、正文 **≤ 150 行**、末尾仓库级反馈入口；
  - `references/` 三篇互相引用且**无孤儿文档**（SKILL.md 必须链到每一篇），单篇 ≤ 300 行；
  - **全文清零本机绝对路径**（盘符根路径等），配置一律走 `.agents/.env`；
  - `references/rules.md` 承载 TKT-06 的四铁律。
- **验收标准 (DoD)**：
  - 上述 9 条命令均可运行，`status` 能输出本地与各介质差异；
  - `python ~/.agents/skills/skill-creator-v2/scripts/validate_skill.py .agents/skills/generic-storage-sync` → **0 error 0 warn**；
  - 技能目录可独立拷走分发（拷到任意机器 + 配 `.agents/.env` 即可跑）。

---

<a id="tkt-08"></a>

### [TKT-08] 第三方驱动合规测试套件（Harness）

- **状态**：`done`（`scripts/test/compliance_harness.mjs` 148 行 / `local_driver_compliance.test.mjs` 58 行 / `compliance_harness.test.mjs` 69 行；5 用例全绿；基准驱动 9/9 通过；反向自检的违规假驱动被抓出 3 项：软删除未进回收站 / onProgress 未触发 / AbortSignal 静默成功）
- **类型**：Testing / Extensibility
- **前置依赖**：TKT-03
- **涉及文件**：`scripts/test/compliance_harness.mjs`、`scripts/test/local_driver_compliance.test.mjs`
- **背景**：百度网盘 / 夸克网盘驱动由**其他 Agent** 实现。缺少统一验收手段时，每个外部驱动都要人工核对一遍接口，易漏项、易各写各的。本票产出**可导出的合规套件**，外部 Agent 只需把 driver 传进来即可自动验收。
- **核心能力**：
  1. 导出 `runDriverComplianceTests(driverFactory)`，可被外部技能直接引用；
  2. 自动断言清单：上传内容一致性、覆盖写保护、软删除进入 Trash（无物理 unlink）、`.ghh-index.json` 覆盖写原子性、进度回调触发、`AbortSignal` 中断生效、路径规整（UNC 保护）；
  3. `LocalFsDriver` 作为**参考基准实现**，必须 100% 通过本套件；
  4. 失败时输出可定位的诊断信息（哪个断言、期望值、实际值、驱动类型）。
- **验收标准 (DoD)**：
  - `LocalFsDriver` 通过率 100%；
  - 用一个**故意违规的假驱动**（如直接 unlink、不触发进度回调）验证套件确实能抓出问题（反向自检）；
  - `references/driver-spi.md` 写明如何引用本套件完成验收。

---

<a id="tkt-09"></a>

### [TKT-09] 跨技能接入：github-kownledge-helper → sync_cli.mjs

- **状态**：`done`（`github-kownledge-helper/SKILL.md` §1 决策表新增 1 行；`references/workflows.md` 新增 §7「存储归档与跨盘同步」含职责边界表 / 9 条命令 / 前置条件 / 红线；管家技能门禁 0 error 0 warn，SKILL.md 正文 83 行）
- **门禁约束（已裁决）**：skill-creator-v2 的 `SCRIPT_LINK_RE` 会把 SKILL.md 正文里任何 `scripts/*.mjs` 字样按**本技能自己的** `scripts/` 目录解析存在性 → 跨技能路径在 SKILL.md 内**必然**报 `script.missing`。故 SKILL.md 只点名 `sync_cli.mjs pack|push` 不带路径，字面可复制命令全集放 `references/workflows.md §7.2`（references 不受该检查）。**不改 skill-creator-v2 的解析口径**——为一份文档改全局校验器不划算。
- **待对账**：TKT-07 落地后须核对 §7.2 的 9 条命令与参数名与 `sync_cli.mjs` 实际实现完全一致。
- **类型**：Integration
- **前置依赖**：TKT-07
- **涉及文件**（跨技能，仅指针级改动）：`.agents/skills/github-kownledge-helper/references/workflows.md`、`.agents/skills/github-kownledge-helper/SKILL.md`
- **目标**：让仓库管家技能在需要备份 / 跨盘归档时，能调用本技能的能力，**且不引入任何代码依赖**。
- **动作**：
  1. `github-kownledge-helper` 的决策表增加一行：「仓库快照归档 / 跨盘备份 → 调 `node .agents/skills/generic-storage-sync/scripts/sync_cli.mjs pack|push` → 指向本技能」；
  2. `references/workflows.md` 增补一段调用协议与路径；
  3. 确认两个技能的职责边界：**git 业务（clone / pull / commit log / 文档抽取）归管家；介质与快照生命周期归本技能**。
- **验收标准 (DoD)**：管家技能文档中存在明确的调用指针；两技能间无 import 依赖；两个技能各自门禁 0 error 0 warn。
