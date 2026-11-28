---
name: github-kownledge-helper
description: 本地 GitHub 仓库管家技能。管理本地第三方仓库收录、批量更新、跨仓库知识答疑、manifest 维护与 git 状态查询。沉淀 ADD、UPDATE、UPDATE-ALL、QUERY 与 SYNC-TO 工作流经验与规则。
---

# github-kownledge-helper · 本地 GitHub 仓库管家

角色：本地第三方 GitHub 仓库追踪器与知识管家。只读追踪、知识沉淀、问啥答啥。
本地环境路径统一由根目录 `.agents/.env` 配置（项目根与外部脚本路径），禁止在正文或代码中硬编码本机绝对路径。

---

## §1 主轴决策表

| 场景 | 动作 | 指针 |
|---|---|---|
| 收录新仓库 | `node scripts/cli.mjs add <owner/repo>` 完整克隆 + 同步 docs + 索引 | [workflows.md](references/workflows.md) §1 |
| 更新单个仓库 | `node scripts/cli.mjs update <full_name>` ff-only 更新 | [workflows.md](references/workflows.md) §2 |
| 一键全部更新 | `node scripts/cli.mjs update-all` 顺序拉取防网络阻塞 | [workflows.md](references/workflows.md) §3 |
| 答疑 / 状态查询 | `node scripts/cli.mjs query <repo> --log/tag/show/grab/freshness` | [workflows.md](references/workflows.md) §4 |
| 镜像到指定路径 | `node scripts/cli.mjs sync-to <owner/repo> <绝对路径>` 含 .git | [workflows-sync-to.md](references/workflows-sync-to.md) |
| 仓库快照归档 / 跨盘备份 | 调 `generic-storage-sync` 的 `sync_cli.mjs pack\|push`（本技能唯一外部调用面；可复制命令见指针） | [workflows.md](references/workflows.md) §7 |
| 未知初始状态任务 | 4 步探测协议：先读后写 → 列决策点 ≤4 → 确认再动手 | [workflows-protocols.md](references/workflows-protocols.md) §7 |
| 聚合多仓收录 | group 聚合目录变体处理 | [workflows-aggregate.md](references/workflows-aggregate.md) |
| 缺少 CLI 命令 | 5 步协议：查清单 → TDD 红绿 → 注册 cli → 用户视角验证 | [cli-development.md](references/cli-development.md) |
| 大型任务完成 | 5 步技能演进协议：识别资产 → 沉淀写入 → 双重记录 | [evolution.md](references/evolution.md) |

---

## §2 核心红线

- **只读追踪**：绝对禁止修改第三方仓库源码（除非用户显式要求 patch）。
- **空间受限**：禁止在项目根（`.agents/.env` 声明的路径）之外写任何文件。
- **唯一事实源**：以 `manifest.json` 为准，原子写入；冲突以 git 实测为准并修正 manifest。
- **实测答疑**：commit / tag / 版本号必须本地 git 实测，以代码为准；文档引用附带新鲜度（🟢/🟡/🔴）。
- 详见硬约束清单：[rules.md](references/rules.md)。

---

## §3 CLI 工具链

零构建：全部命令为原生 `.mjs`，只依赖 Node ≥22 内置模块，**无 npm 依赖、无编译步骤**。
所有命令在项目根执行；入口 `scripts/cli.mjs`（薄转发器）→ 技能内 `scripts/cli.mjs`（唯一实现）。
完整命令清单见 [commands.md](references/commands.md)。

```bash
node scripts/cli.mjs add <owner/repo>               # 收录新仓库
node scripts/cli.mjs update <full_name>              # 更新单仓
node scripts/cli.mjs update-all                      # 一键更新全部收录仓
node scripts/cli.mjs query <repo> [--log/tag/show]   # 答疑与状态查询
node scripts/cli.mjs query-all                       # 全仓最近动态
node scripts/cli.mjs sync-manifest                   # 扫描 repos/ 重建 manifest.json
node scripts/cli.mjs sync-docs                       # 同步顶层文档到 docs/
node scripts/cli.mjs verify-docs                     # 验证知识索引状态
node scripts/cli.mjs sync-to <repo> <dest>           # 镜像仓库到指定路径
node --test ".agents/skills/github-kownledge-helper/scripts/test/*.test.mjs"   # 跑测试
```

### 脚本布局

- 入口：`scripts/cli.mjs`
- 库：`scripts/lib/env.mjs` `scripts/lib/envStrict.mjs` `scripts/lib/paths.mjs` `scripts/lib/time.mjs` `scripts/lib/parseRepoInput.mjs` `scripts/lib/git.mjs` `scripts/lib/manifest.mjs` `scripts/lib/buildEntryFromRepo.mjs` `scripts/lib/buildIndex.mjs` `scripts/lib/argv.mjs` `scripts/lib/repoScan.mjs`
- 库（续）：`scripts/lib/queryFlags.mjs` `scripts/lib/queryFormat.mjs` `scripts/lib/queryGit.mjs` `scripts/lib/queryModes.mjs` `scripts/lib/verifyDocs.mjs` `scripts/lib/verifyIndex.mjs` `scripts/lib/docmapSqlite.mjs` `scripts/lib/mirror.mjs` `scripts/lib/updateLog.mjs`
- 命令：`scripts/commands/add.mjs` `scripts/commands/update.mjs` `scripts/commands/update-all.mjs` `scripts/commands/query.mjs` `scripts/commands/sync-manifest.mjs` `scripts/commands/sync-docs.mjs` `scripts/commands/verify-docs.mjs` `scripts/commands/sync-to.mjs`
- 测试：`scripts/test/helpers.mjs` `scripts/test/env.test.mjs` `scripts/test/envStrict.test.mjs` `scripts/test/query.test.mjs` `scripts/test/queryRepo.test.mjs` `scripts/test/runBuildIndex.test.mjs` `scripts/test/parseRepoInput.test.mjs` `scripts/test/buildEntryFromRepo.test.mjs` `scripts/test/manifestAppend.test.mjs` `scripts/test/mergeEntry.test.mjs` `scripts/test/add.e2e.test.mjs` `scripts/test/syncTo.test.mjs` `scripts/test/verifyDocs.test.mjs` `scripts/test/verifyIndex.test.mjs`

---

## §4 经验沉淀索引

- 项目硬约束与边界：[rules.md](references/rules.md)
- 工作流基线与决策树：[workflows.md](references/workflows.md)
- 技能演进协议与演进日志：[evolution.md](references/evolution.md)
- 命令模式与 CLI 清单：[commands.md](references/commands.md)
- 缺失 CLI 开发流程：[cli-development.md](references/cli-development.md)
- TDD 红绿循环规范：[tdd.md](references/tdd.md)
- 知识索引验证与排障：[doc-verify.md](references/doc-verify.md)
- 踩坑与避障手册：[pitfalls.md](references/pitfalls.md)
- 聚合目录处理：[workflows-aggregate.md](references/workflows-aggregate.md)
- 探测与技术栈迁移协议：[workflows-protocols.md](references/workflows-protocols.md)
- 仓库镜像工作流：[workflows-sync-to.md](references/workflows-sync-to.md)

> 仓库级变更记录：项目根的 `CHANGELOG.md`（技能独立安装后由使用者仓库自行维护）

---

> 反馈：本技能来自 monsterbude123/holy-agents-kits，发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
