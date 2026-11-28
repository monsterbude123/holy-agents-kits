# 项目规则与红线 (Rules & Boundaries)

> 本文件是 github-kownledge-helper 的硬规则与约束标准。

## 1. 路径约定

| 用途 | 路径 | 说明 |
| --- | --- | --- |
| 仓库 clone 落地 | `<repos_root>/<owner>__<repo>/` | 双下划线分隔，避免同名冲突；`<repos_root>` 默认 `<项目根>/repos`，可用 `GITHUB_KNOWLEDGE_HELPER_REPOS_DIR` 外置 |
| 聚合分组 | `<repos_root>/<group>/<owner>__<repo>/` | group 目录名见 [workflows-aggregate.md](./workflows-aggregate.md) §5 |
| 文档镜像 | `<项目根>/docs/<owner>__<repo>/` | 与 repos 一一对应，doc-map-manager 索引目标（**始终在项目根，不随 repos_root 外移**） |
| 仓库清单 | `<项目根>/manifest.json` | 项目根，唯一事实源 |
| 本地环境配置 | `<项目根>/.agents/.env` | 声明项目根路径与外部脚本位置（不入 git） |
| 知识索引缓存 | `<项目根>/docs/.docmap/` | doc-map-manager 产物 |
| CLI 工具源码 | `.agents/skills/github-kownledge-helper/scripts/` | 零构建原生 `.mjs`（`lib/` + `commands/` + `cli.mjs`），零 npm 依赖 |
| CLI 入口 | `scripts/cli.mjs` | 项目根薄转发器 → 技能内 `scripts/cli.mjs`（唯一实现） |
| CLI 测试 | `.agents/skills/github-kownledge-helper/scripts/test/` | `node:test` + `node:assert/strict`，`*.test.mjs` |

**repos 根目录可外置**：`GITHUB_KNOWLEDGE_HELPER_REPOS_DIR`（读 `<项目根>/.agents/.env` 或进程环境变量）把仓库本体放到项目根之外，例如统一放某个大盘的 GitHub 目录。

- **归属原则**：repos 根属于**项目自身**，配置只读 `<项目根>/.agents/.env`，**不走 cwd 向上探测** —— 否则在临时目录里跑测试会命中用户全局 `~/.agents/.env`，把 repos 根解析到真实项目目录。
- **manifest `path` 语义**：相对 **repos 根**（`<owner>__<repo>` 或 `<group>/<owner>__<repo>`），**不带 `repos/` 前缀**。代码一律用 `reposRoot()` 拼接绝对路径。manifest 因此与 repos 根的实际位置解耦，换机器不用改 manifest。
- **`docs_path` 语义不变**：相对**项目根**（`docs/<owner>__<repo>`），docs 镜像始终留在项目根（入 git，可追溯）。

**禁止**：在项目根（由 `.agents/.env` 中 `GITHUB_KNOWLEDGE_HELPER_SPACE` 定义）之外写任何文件 —— 唯一例外是显式配置了 `GITHUB_KNOWLEDGE_HELPER_REPOS_DIR` 时的仓库本体落地目录。

**零构建**：新代码一律原生 `.mjs` + Node 内置模块（`node:fs` / `node:path` / `node:crypto` / `node:child_process` / `node:test`），不新增 npm 依赖，不引入编译步骤。


## 2. 命名规范

- **仓库目录**：`<owner>__<repo>`，全小写，owner/repo 原样保留（含连字符）。例如：`facebook__react`、`microsoft__vscode`。
- **manifest full_name**：必须是 `owner/repo` 格式（GitHub 标准）。
- **文档文件名**：保留源仓库原命名（`README.md`、`CHANGELOG.md`、`ARCHITECTURE.md` 等），不重命名。

## 3. manifest 维护规则

1. **唯一事实源**：仓库状态以 `manifest.json` 为准；与本地 git 冲突时以 git 实测为准并回写修正。
2. **原子写入**：读 → 改 → 写回，禁止半写状态。先写临时文件再原子重命名。
3. **必填字段**：`name` / `owner` / `full_name` / `url` / `path` / `default_branch` / `added_at` / `last_pull_at` / `current_commit` / `current_commit_short` / `current_commit_date`。
   - `path` **相对 repos 根**（`<owner>__<repo>` 或 `<group>/<owner>__<repo>`），不带 `repos/` 前缀。
   - `docs_path` 相对**项目根**（`docs/<owner>__<repo>`）。
4. **时间戳**：ISO 8601 带时区，统一 `Asia/Shanghai`。
5. **去重**：按 `full_name` 去重，禁止重复收录。
6. **删除**：用户要求移除仓库时，先删 `<repos_root>/<path>` 与 `<项目根>/<docs_path>`，再从 manifest 移除条目。

## 4. clone / pull 规则

1. **完整克隆默认**：`git clone <url> <path>`，默认拉取全部历史（保障 commit / blame / tag 查询）。
2. **ff-only**：`git pull --ff-only`，遇非快进不强推，报告并询问是否 reset。
3. **顺序执行**：UPDATE-ALL 顺序拉取，禁止并发打满网络。
4. **失败不静默**：clone/pull 失败必须报错，不写 manifest，不留半成品目录。
5. **网络重试**：连续失败 2 次可降级为浅克隆重试（仅网络受限场景），仍失败则报告 fatal。
6. **超时可配**：clone 超时不得硬编码。默认 60 分钟，可用 `add --timeout <分钟>` 覆盖。
   大仓在慢速网络下（实测 ~1 MB/s）必然超过 10 分钟，写死 10 分钟等于必失败。
7. **超时必杀进程树**：超时后必须杀掉整棵进程树（Windows `taskkill /T /F`，POSIX 进程组）。
   只杀直接子进程会留下孤儿 `git-remote-https` / `git index-pack` 继续下载——
   父命令已判失败、后续步骤（写 manifest）不执行，而 git clone 失败时又自己删目标目录，
   已下载的数据全部白费。
8. **浅克隆用 `--depth 1 --single-branch`**：只要默认分支的完整工作树，不拉 4 万+ PR ref。
   实测 orca 完整 clone 3.7 GB / 默认分支工作树 263 MB —— 体积差 14 倍，
   差值几乎全在 `refs/pull/*` 与侧分支上。
9. **批量收录走 `add-batch`**：多仓收录排成一条流水线（顺序执行、已收录自动跳过、
   单仓失败不中断整批、结束统一收口 manifest），不要手动逐个 `add` 重跑。

## 5. 知识索引规则 (doc-map-manager)

1. **索引目标**：仅 `docs/` 目录，`repos/` 源码不入索引（源码用 git grep / git show 查）。
2. **文档同步**：收录与更新时同步顶层文档（`README.md` / `CHANGELOG.md` / `ARCHITECTURE.md` 等）。
3. **增量优先**：构建索引必须加 `--incremental`，禁止每次全量重建。
4. **查询入口**：文档检索走 `query-index.py`；索引覆盖度核查走 `verify-docs`（其内部以 python 读 SQLite）。**禁止**在 JS 侧直接读 `.docmap/docmap.db`。
5. **新鲜度协议**：引用文档前强制检查新鲜度（🟢 ≥0.7 可直引 / 🟡 0.3~0.7 标注可能过时 / 🔴 <0.3 交叉验证）。

## 6. 答疑红线

1. **实测为准**：数字/commit/tag/版本号必须来自本地 `git` 实测，禁止凭记忆或猜测。
2. **来源标注**：回答必须附带来源（本地 commit + 文档新鲜度）。
3. **代码优先**：文档与代码冲突时以源码为准，并报告不一致。
4. **不编造**：未收录仓库或查不到的信息直接说明，不臆造。

## 7. 安全与本地化环境

1. **不泄露**：manifest 或仓库中若有 token/密钥，输出时必须脱敏。
2. **本地配置收口**：本机绝对路径只在 `.agents/.env` 配置，禁止在技能文档与代码中硬编码本机路径。
3. **不修改第三方源码**：第三方仓库仅做只读追踪，除非用户显式要求 patch。
4. **repos/ 不入 git**：第三方仓库由 gitignore 排除，不污染本项目版本库。repos 根外置到项目根之外时天然不在本仓版本控制内。
5. **不留报错脚本**：测试或临时脚本失败必须修复或清理，禁止留存不可跑通脚本。

## 8. 跨技能职责边界

本技能（仓库管家）与 `generic-storage-sync`（存储同步引擎）**物理隔离、零代码耦合**：

| 归本技能 | 归 `generic-storage-sync` |
|---|---|
| clone / ff-only pull / update / update-all | 缓冲盘打包（git bundle + SHA-256） |
| commit log / tag / diff 答疑与新鲜度标注 | 跨介质推送 / 拉取（两阶段提交 + 远端索引回写） |
| 文档抽取与知识索引（docmap） | 快照索引记账（`.ghh-index.json`） |
| manifest 维护与仓库目录约定 | 历史淘汰、回收站冷却与物理抹除 |

- **越界即错**：介质端索引、回收站、历史版本一律不由本技能读写。
- 本技能只出**指针**：需要归档 / 跨盘备份时调 `generic-storage-sync` 的 `sync_cli.mjs`，不复制其实现。
- **物理删除只发生在对方** `clean-trash --yes`（且仅限冷却期满的回收站文件）；本技能任何路径都不得删文件或改远端索引。
- 详见 [workflows.md](workflows.md) §7。

## 9. 禁止行为清单

- ❌ 修改第三方仓库内的代码（除非用户明确要求 patch）。
- ❌ 在项目路径之外写文件。
- ❌ 凭记忆回答仓库状态，不查 manifest / git。
- ❌ 直接读取 `docs/.docmap/docmap.db`。
- ❌ 全量重建索引（除非首次或 schema 变更）。
- ❌ 并发拉取多个仓库。
- ❌ 把第三方仓库内容提交到本项目 git。
- ❌ 在技能文档或提交代码中硬编码本机绝对路径。
- ❌ 越界读写介质端索引 / 回收站 / 物理删除文件（属 `generic-storage-sync`）。
- ❌ 代管或代写存储介质的凭据配置（`.agents/.env` 的 `STORAGE_TARGET_*` 归对方）。
