---
name: generic-storage-sync
description: 通用异构存储同步技能。管理本地缓冲盘的仓库快照打包（git bundle + SHA-256）、跨介质推送与拉取（物理盘 / 挂载盘 / SFTP / SMB / 百度网盘 / 夸克网盘）、快照索引记账与历史版本淘汰回收。提供统一 CLI 与驱动接入契约，屏蔽介质差异，用户只关心文件本身。
---

# generic-storage-sync · 通用异构存储同步

角色：**介质透明**的快照与同步引擎。用户只感知「仓库快照、版本、同步状态」，
底层是物理盘、移动硬盘、SMB/NFS 挂载盘还是第三方网盘，对上层完全透明。

本技能**独立可分发**：零 npm 依赖、零编译，拷走目录 + 配好 `.agents/.env` 即可用。
百度网盘 / 夸克网盘驱动由对应 Agent 按 [driver-spi.md](references/driver-spi.md) 实现并接入。

---

## §1 主轴决策表

| 场景 | 动作 | 指针 |
|---|---|---|
| 介质登记与探活 | `target list` / `target add` / `target test` | [commands.md](references/commands.md) §1 |
| 打包单仓入缓冲盘 | `pack <repo_path>` → git bundle + SHA-256 | [commands.md](references/commands.md) §2 |
| 推送到介质 | `push <repo_path> [--target <id>]` 两阶段提交 | [commands.md](references/commands.md) §3 |
| 从介质拉回还原 | `pull <owner/repo> --from <id>` | [commands.md](references/commands.md) §4 |
| 看同步健康状况 | `status [--trash]` | [commands.md](references/commands.md) §5 |
| 看介质漂移清单 | `diff <target>` → toUpload / toTrash / upToDate | [commands.md](references/commands.md) §6 |
| 淘汰超量旧版本 | `prune [target]`（默认 dry-run） | [commands.md](references/commands.md) §7 |
| 清理冷却期满回收站 | `clean-trash [target] --yes` | [commands.md](references/commands.md) §8 |
| 清暂存盘残卷 | `clean-staging` | [commands.md](references/commands.md) §9 |
| 灾难恢复 | 凭远端 `.ghh-index.json` 重建本地索引 | [storage-design.md](references/storage-design.md) §5 |
| 写第三方网盘驱动 | 继承 `BaseDriver` + 跑合规套件 | [driver-spi.md](references/driver-spi.md) |
| 不确定能否删 / 何时删 | 四条防灾铁律先读 | [rules.md](references/rules.md) |

---

## §2 核心红线

- **介质透明**：上层只操作快照实体，不直接接触介质路径语义。
- **单一事实源**：索引 schema 唯一事实源是 `index_store.mjs`；驱动层只做**字节透传**，不自定义结构。
- **索引只记当前版本**：历史版本清单以**介质目录**为准，淘汰判定靠「介质目录 + 索引记账」组装。
- **物理删除唯一出口**：只有 `lifecycle` 的 `clean-trash --yes`（冷却期满后）会真正删文件；其它路径一律软删除进 `.trash/`。
- **演练优先**：`prune` / `clean-trash` 默认 dry-run，只报清单与可释放字节数，真执行必须显式 `--yes`。
- **原子写入**：索引与配置一律 `.tmp` + `rename` 原子替换，崩溃零半写。
- **本机路径零硬编码**：介质端点、缓冲盘、保留策略全部走 `.agents/.env`。
- 完整红线清单见 [rules.md](references/rules.md)。

---

## §3 CLI 速查

所有命令在项目根执行，入口是 `scripts/sync_cli.mjs`：

```bash
node scripts/sync_cli.mjs target list|add|test      # 介质管理
node scripts/sync_cli.mjs status [--trash]            # 同步健康 / 回收站占用
node scripts/sync_cli.mjs diff <target>               # 漂移清单
node scripts/sync_cli.mjs pack <repo_path>            # 打包入缓冲盘
node scripts/sync_cli.mjs push <repo_path> [--target <id>]   # 两阶段提交推送
node scripts/sync_cli.mjs pull <owner/repo> --from <id>      # 拉取还原
node scripts/sync_cli.mjs prune [target] [--yes]      # 淘汰旧版本（默认 dry-run）
node scripts/sync_cli.mjs clean-trash [target] [--yes]# 物理清理（默认 dry-run）
node scripts/sync_cli.mjs clean-staging               # 清暂存残卷
```

逐条用法、参数与典型场景见 [commands.md](references/commands.md)。

---

## §4 脚本清单

零依赖，全部原生 `.mjs`，用 `node` 直接跑。

- 入口：`scripts/sync_cli.mjs`
- 核心库：`scripts/env.mjs` `scripts/index_store.mjs` `scripts/driver_spi.mjs` `scripts/local_driver.mjs` `scripts/buffer_pipeline.mjs` `scripts/sync_coordinator.mjs` `scripts/lifecycle.mjs`
- CLI 实现：`scripts/lib/cli_targets.mjs` `scripts/lib/cli_sync.mjs` `scripts/lib/cli_lifecycle.mjs`
- 测试：`scripts/test/env.test.mjs` `scripts/test/index_store.test.mjs` `scripts/test/local_driver.test.mjs` `scripts/test/buffer_pipeline.test.mjs` `scripts/test/sync_coordinator.test.mjs` `scripts/test/lifecycle.test.mjs` `scripts/test/sync_cli.test.mjs`
- 合规套件：`scripts/test/compliance_harness.mjs` `scripts/test/compliance_harness.test.mjs` `scripts/test/local_driver_compliance.test.mjs`

跑测试：`node --test "scripts/test/*.test.mjs"`（在技能目录内执行）。

---

## §5 知识索引

- 存储安全红线与四铁律：[rules.md](references/rules.md)
- 缓冲盘拓扑与索引物理设计：[storage-design.md](references/storage-design.md)
- 命令详解与典型场景：[commands.md](references/commands.md)
- 驱动接入契约（面向百度 / 夸克 Agent）：[driver-spi.md](references/driver-spi.md)
- 演进协议与日志：[evolution.md](references/evolution.md)
- 架构设计规格：[SPEC.md](SPEC.md)

---

> 反馈：本技能沉淀通用异构存储同步的介质抽象、快照生命周期与安全清理经验。本技能来自 monsterbude123/holy-agents-kits，发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
