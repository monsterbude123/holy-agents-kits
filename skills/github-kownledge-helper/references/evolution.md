# 技能演进协议 (Skill Evolution)

> 本技能管辖本项目的运营经验沉淀。每完成一个大型任务，必须升级本技能。

## 1. 「大型任务」判定标准

满足以下任一条件即视为大型任务，触发强制升级：

| 类型 | 触发条件 |
| --- | --- |
| 收录类 | 首次跑通 ADD 流程 / 新增仓库类型（monorepo / submodule / 私有仓） |
| 查询类 | 答了之前答不了的问题（新查询模式 / 新交叉验证路径） |
| 修复类 | 修复 clone/pull/索引的疑难 bug，且根因可复述 |
| 工作流 | 沉淀了新的可复用工作流模式 / 命令组合 / CLI 升级 |
| 显式触发 | 用户明确要求「升级 skill」/「记录这次经验」 |

> 单纯的 git pull 更新、简单答疑（查 commit/tag）不算大型任务，不触发升级。

## 2. 升级流程（5 步）

1. **识别资产**：新命令模式写入 `references/commands.md`；新踩坑写入 `references/pitfalls.md`；新工作流写入 `references/workflows*.md`。
2. **沉淀写入**：文档放入 `references/<topic>.md`（单文件 ≤ 300 行，超出拆分）；脚本必须实跑通过。
3. **更新 SKILL.md**：追加仓库根 `CHANGELOG.md` 条目 + 本文件演进日志表，并更新 SKILL.md 的 Triggers / Description。
4. **记录演进日志**：在下表追加记录。
5. **清理验证**：清理临时文件与半成品，跑通 `validate_skill.py` 验证。

## 3. 升级红线

- ❌ 不留报错脚本 / 半成品脚本。
- ❌ 单文件超过上限不拆分。
- ❌ 升级不写 CHANGELOG / 演进日志。
- ❌ 引用其他项目绝对路径（破坏零外部依赖）。

## 4. 升级回执格式

`已升级 · 沉淀到 references/<file> §NN · CHANGELOG+1 · 演进日志+1`

## 5. 演进日志

| 日期 | 任务摘要 | 沉淀位置 |
| --- | --- | --- |
| 2026-11-28 | 跨技能接入 `generic-storage-sync`：workflows.md 新增 §7 存储归档调用协议（职责边界 / 命令面 / 前置条件 / 红线）；rules.md 新增 §8 跨技能职责边界与禁止行为；SKILL.md §1 决策表新增「仓库快照归档 / 跨盘备份」一行 | SKILL.md + references/{workflows,rules}.md |
| 2026-11-27 | EPIC-A 全量整改：TS CLI → 原生 `.mjs` 零构建（去 commander/vitest/tsx/tsc），技能文档内聚收敛（命令清单去重、进度快照清除、已知限制入 pitfalls、workflows/rules 收敛） | SKILL.md + references/*.md + scripts/ |
| 2026-11-27 | 架构收敛：消除 AGENTS.md 与 project-rules.md，全部收敛到 github-kownledge-helper，本地化配置收口到 .agents/.env | SKILL.md + references/rules.md + references/evolution.md + references/workflows.md + scripts/lib/env.mjs |
| 2026-08-13 | skill 全局化 + load_env 收口：环境变量收口项目根；新增 env.mjs + 11 测；paths.mjs / add.mjs / query.mjs 走 load_env.get | scripts/lib/env.mjs + references/commands.md |
| 2026-08-13 | 默认行为切换：浅克隆→完整克隆；72 测全绿 | references/rules.md + references/commands.md |
| 2026-08-13 | SYNC-TO 工作流 + 跨平台 CLI 实现：TDD 6 例，fs.cpSync recursive 替换 robocopy | scripts/commands/sync-to.mjs + references/workflows-sync-to.md |
| 2026-08-13 | 10 轮 goal-mode 自动驾驶：init 项目骨架 → README → LICENSE → CI → setup → query CLI → CONTRIBUTING + CHANGELOG | CONTRIBUTING.md + CHANGELOG.md + .github 模板 |
| 2026-08-13 | TDD 实现 query / query-all CLI（+22 测 = 47 测）；setup 跨平台 bootstrap；CI 工作流 | references/commands.md + references/cli-development.md |
| 2026-08-13 | TDD 模板 + doc manager 验证步骤写入 skill；TDD 实现 add + verify-docs 两 CLI | references/cli-development.md + references/tdd.md + references/doc-verify.md |
| 2026-08-13 | 蒸馏会话：补全 4 个 pitfalls（§007-§010）+ 2 个 workflows（§7 探测 / §8 迁移） | references/pitfalls.md + references/workflows.md |
| 2026-08-13 | 包结构修正：package.json / pnpm-workspace.yaml / node_modules 移到项目根，CLI 源码目录与 npm `scripts` 概念分离（后于零构建迁移再迁入技能目录 `scripts/`） | references/pitfalls.md §006 |
| 2026-08-13 | update / update-all 实现 + 跑通 38 仓库更新 | references/workflows.md + references/commands.md |
| 2026-08-13 | 首次批量收录 38 仓库 + 聚合目录支持（group 字段）+ TS/pnpm CLI 化 | references/workflows.md + references/pitfalls.md |
| 2026-08-13 | 项目初始化，建立 skill 骨架与演进协议 | SKILL.md + references/ 骨架 |
