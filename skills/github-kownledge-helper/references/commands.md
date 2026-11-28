# 可复用命令模式

> 沉淀 ADD / UPDATE / QUERY 工作流中验证过的 git 命令组合。
> 单文件 ≤ 200 行，超出拆分到 `commands-<topic>.md`。
> CLI 子命令清单以本文件为唯一出处。

## 状态读取（一次拉全）

收录 / 更新后回写 manifest 必读的字段，合并成一条命令：

```bash
# 一次性读取 branch / full sha / short sha / commit date
repo="repos/facebook__react"
git -C "$repo" rev-parse --abbrev-ref HEAD
git -C "$repo" rev-parse HEAD
git -C "$repo" rev-parse --short HEAD
git -C "$repo" log -1 --format=%cI HEAD
```

## 完整克隆（默认策略）

```bash
# 默认完整克隆（拉全历史，便于 blame / tag / 历史查询）
git clone https://github.com/facebook/react.git repos/facebook__react

# 网络受限场景降级为浅克隆
git clone --depth 1 https://github.com/facebook/react.git repos/facebook__react
```

## ff-only 更新（避免意外 merge commit）

```bash
git -C repos/facebook__react fetch origin
git -C repos/facebook__react pull --ff-only
# 非快进 → 报告，询问是否 reset --hard origin/<branch>，不强推
```

## 按 tag 查 commit

```bash
# 列出匹配 tag
git -C repos/facebook__react tag --list "v19*"

# tag → commit sha
git -C repos/facebook__react rev-list -n 1 v19.0.0
```

## 最近 N 个 commit 摘要

```bash
git -C repos/facebook__react log --oneline -20
```

## PR / merge commit 改动文件

```bash
# 查看某个 merge commit 改了哪些文件
git -C repos/facebook__react show --stat <merge-sha>

# 列出最近的 merge
git -C repos/facebook__react log --merges --oneline -10
```

## 跨仓库源码搜索

```bash
# 在本地仓库源码中 grep（docs 索引未命中时降级用）
git -C repos/facebook__react grep -n "useEffect" -- "*.md"
```

## CLI 命令（零构建：纯 .mjs，无 npm 依赖）

```bash
# 收录新仓库（完整 clone + 同步 docs + doc manager 索引）
node scripts/cli.mjs add <owner/repo>              # e.g. add facebook/react
node scripts/cli.mjs add <https URL>               # 接受 https URL，自动推 owner/repo
node scripts/cli.mjs add <owner/repo> --group ai-app  # 聚合目录
node scripts/cli.mjs add <owner/repo> --no-build-index  # 跳过 doc manager 增量索引

# 验证 doc manager 索引（每仓 query 一次，汇总 🟢/🟡/🔴/missing）
node scripts/cli.mjs verify-docs

# 同步文档（按 manifest 把白名单文档复制到 docs/）
node scripts/cli.mjs sync-docs

# 同步 manifest（扫描 repos/ 重建 manifest.json，保留 added_at/last_pull_at/tags/notes）
node scripts/cli.mjs sync-manifest
node scripts/cli.mjs sync-manifest --dry-run       # 只打印概要，不写盘
node scripts/cli.mjs sync-manifest --rebuild       # 丢弃旧元数据（灾难恢复用）

# 更新单个仓库（full_name / path / name 均可匹配）
node scripts/cli.mjs update bytedance/deer-flow

# 一键全量更新（ff-only，顺序拉取，失败隔离）
node scripts/cli.mjs update-all

# 答疑与状态查询
node scripts/cli.mjs query <repo> --log
node scripts/cli.mjs query <repo> --tag <pattern>
node scripts/cli.mjs query <repo> --show <sha>
node scripts/cli.mjs query <repo> --grab "<question>"
node scripts/cli.mjs query <repo> --freshness
node scripts/cli.mjs query-all

# 跑测试（TDD）
node --test "scripts/test/*.test.mjs"

# 通用入口
node scripts/cli.mjs <command>
```

> 任何用户给的任务，先查这个清单。**缺失的命令不要手动拼凑** — 走 [cli-development.md](./cli-development.md)。

## 镜像到指定路径（sync-to，已实现 CLI，跨平台）

```bash
# 跨平台（Windows / macOS / Linux）
node scripts/cli.mjs sync-to <owner/repo> <绝对路径>

# 例：把 QwenLM/Qwen-MM-Plugins 镜像到指定备份路径
node scripts/cli.mjs sync-to QwenLM/Qwen-MM-Plugins /path/to/dest/qwen-mm-plugins
```

> 实现：[sync-to.mjs](../scripts/commands/sync-to.mjs)（fs.cpSync recursive + 含隐藏 .git），跨平台无 robocopy 依赖。
> 完整协议见 [workflows-sync-to.md](./workflows-sync-to.md) + [pitfalls.md §011](./pitfalls.md#011-git-没有本地-fork-概念fork-一个本地路径靠直接复制-git)。
> 测试：[syncTo.test.mjs](../scripts/test/syncTo.test.mjs)，含目标已存在停手 / 源不存在 / 源无 .git / 子目录 + 文件树一致 / sha 校验。
