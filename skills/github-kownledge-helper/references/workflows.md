# 核心工作流模式 (Workflows)

> 沉淀 ADD / UPDATE / UPDATE-ALL / QUERY 四大工作流的**决策树与步骤指针**。
> **规则与硬约束的唯一出处是 [rules.md](./rules.md)**；本文件不复述规则，只回答「走哪条路、查哪一节」。
> 扩展主题见：
> - 聚合目录处理 → [workflows-aggregate.md](./workflows-aggregate.md)
> - 探测协议 + 技术栈迁移 → [workflows-protocols.md](./workflows-protocols.md)
> - SYNC-TO 镜像 → [workflows-sync-to.md](./workflows-sync-to.md)

## 1. ADD — 收录新仓库

```
决策树：
├── 输入形态？ → owner/repo 与 https URL 都接受，CLI 归一化
├── 是否有主题归属？ → 有则 --group <group>，否则落顶层
├── 是否需要 doc manager 索引？ → 批量收录 / CI 场景加 --no-build-index
└── 执行
    └─ node scripts/cli.mjs add <owner/repo> [--group <group>] [--no-build-index]
```

- 目标路径约定、命名规范 → [rules.md §1、§2](./rules.md)
- clone 策略（完整 / 浅克隆降级）、失败不静默 → [rules.md §4](./rules.md)
- manifest 追加与原子写入 → [rules.md §3](./rules.md)
- 文档同步白名单与增量索引 → [rules.md §5](./rules.md)
- 目录已存在但未登记 → 不强行覆盖，先问用户（见 rules.md §4 的失败处理原则）

## 2. UPDATE — 更新单仓

```
决策树：
├── 目标定位？ → full_name / path / name 任一可匹配
├── 拉取策略？ → ff-only，遇非快进不自动 reset，报告并等用户决策
└── 执行
    └─ node scripts/cli.mjs update <full_name>
```

- 拉取与顺序约束 → [rules.md §4](./rules.md)
- 回写字段与时间戳格式 → [rules.md §3](./rules.md)
- freshness 门禁：`last_pull_at` 距今 > 24h 自动先 UPDATE；< 24h 跳过 pull 直接查询

## 3. UPDATE-ALL — 一键全更新

```
决策树：
├── 范围？ → manifest.repos 全量
├── 并发？ → 禁止并发，顺序拉取
└── 执行
    └─ node scripts/cli.mjs update-all
```

- 顺序执行与失败隔离 → [rules.md §4](./rules.md)
- 索引刷新策略（增量优先，禁全量） → [rules.md §5](./rules.md)
- 输出汇总格式：N changed / M up-to-date / K failed

## 4. QUERY — 知识答疑决策树

```
决策树：
├── 问"最新发了什么 / 最近更新"
│   → freshness check → git -C <path> log --oneline -20 → 摘要回复
├── 问"v19 / 某版本 / 某 tag 在哪个 commit"
│   → git -C <path> rev-list -n 1 <tag> 或 git tag --list
├── 问"这个 PR 改了哪几个文件"
│   → git -C <path> show --stat <merge-sha>
├── 问"XXX 怎么实现 / 概念性问题"
│   → 先查 docs/ 知识库：doc-map-manager --grab "XXX"
│   → 命中且 🟢（新鲜度 ≥ 0.7）→ 引用；涉及 API 时用 git grep 交叉验证
│   → 命中但 🟡/🔴 → 标注可能过时，必须用本地源码 git show / grep 验证，以代码为准
│   → 未命中 → 降级 --fuzzy，或直接 grep 本地仓库源码
└── 问"哪些仓库用到了 X 技术"
    → doc-map-manager --lookup "X" 跨仓库检索 docs/
```

- 数字 / commit / tag 必须实测、来源标注、代码优先 → [rules.md §6](./rules.md)
- 索引覆盖度核查与假阳性排查 → [doc-verify.md](./doc-verify.md) + [pitfalls.md §012](./pitfalls.md#012-聚合目录-verify-docs-假阳性query-串与索引-path-子串不匹配)
- 命令面（`--log` / `--tag` / `--show` / `--grab` / `--freshness`） → [commands.md](./commands.md)

## 5. 首次启动自检

1. 读取 `manifest.json`，确认存在且 schema 合法。
2. 抽查 1~2 个 repo 目录是否存在。
3. 检查 `docs/.docmap/docmap.db` 是否存在，不存在提示构建索引。
4. 报告当前收录仓库数量与最近一次更新时间。

## 6. 回复规范

- **收录/更新结果**：用简表（仓库名 / 旧 commit → 新 commit / 变更数）。
- **答疑**：先标注来源（本地 commit + 文档新鲜度），再给结论。
- **失败**：直接报错 + 根因 + 建议处理方式，不绕弯。
- 具体红线以 [rules.md §6、§8](./rules.md) 为准。

## 7. 存储归档与跨盘同步（外部技能调用）

> 两个技能**物理隔离、零代码耦合**：本技能只出指针，不 import、不复制 `generic-storage-sync` 的实现。
> 需要「仓库快照归档 / 跨盘备份」时，本技能负责定位仓库与确认 commit，介质侧动作交给 `generic-storage-sync`。

### 7.1 职责边界

| 归 `github-kownledge-helper` | 归 `generic-storage-sync` |
|---|---|
| clone / ff-only pull / update / update-all | 缓冲盘打包（git bundle → SHA-256 指纹） |
| commit log / tag / diff 答疑与新鲜度标注 | 跨介质推送 / 拉取（两阶段提交 + 远端索引回写） |
| 文档抽取与知识索引（docmap） | 快照索引记账（`.ghh-index.json`） |
| manifest 维护与仓库目录约定 | 历史淘汰、回收站冷却与物理抹除 |

- 越界即错：介质端索引、回收站、历史版本一律不由本技能读写。
- 本技能不因归档需要而修改第三方仓库源码。

### 7.2 调用方式

本技能对外的唯一 CLI 面是 `generic-storage-sync` 的 `sync_cli.mjs`（命令与参数以它为准）：

```bash
# GSS 指向 generic-storage-sync 技能目录，按本机安装位置二选一
GSS=.agents/skills/generic-storage-sync     # 装在用户项目的 .agents/skills/ 下
# GSS=skills/generic-storage-sync           # 装在 skills/ 下（如 holy-agents-kits 本仓）

node $GSS/scripts/sync_cli.mjs target list
node $GSS/scripts/sync_cli.mjs target add <id> --type <type> --endpoint <path>
node $GSS/scripts/sync_cli.mjs target test [id]
node $GSS/scripts/sync_cli.mjs status [--trash]
node $GSS/scripts/sync_cli.mjs diff <target>
node $GSS/scripts/sync_cli.mjs pack <repo_path> [--name <owner/repo>]
node $GSS/scripts/sync_cli.mjs push <repo_path> [--target <id>] [--name <owner/repo>]
node $GSS/scripts/sync_cli.mjs pull <owner/repo> --from <id> [--dest <path>]
node $GSS/scripts/sync_cli.mjs prune [target] [--yes]
node $GSS/scripts/sync_cli.mjs clean-trash [target] [--yes]
node $GSS/scripts/sync_cli.mjs clean-staging [--dry-run]
```

- 常规归档两步走：`pack <repo_path>` 打包进本地缓冲盘 → `push <repo_path> [--target <id>]` 推送介质；`push` 前可先 `diff <target>` 看漂移。
- **可用性**：`sync_cli.mjs` 已落地，以上命令即全部可用；参数以 `sync_cli.mjs --help` 为准，本节与实现保持同步。
- **清理类命令默认 dry-run**：`prune` / `clean-trash` 只打印拟删清单与可释放字节数；真执行必须显式 `--yes`。

### 7.3 前置条件

- 介质需先在仓库根 `.agents/.env` 里配置（`STORAGE_TARGET_*` 变量族）；凭据由 `generic-storage-sync` 读取，**本技能不代管凭据**，也不代写 `.env`。
- 未配置介质时 `push` 失败并给出原因；本技能如实报告，不自行换介质。

### 7.4 红线

- **物理删除只发生在 `generic-storage-sync` 的 `clean-trash --yes`**（且仅限冷却期满的回收站文件）；本技能任何路径都不得直接删文件或改远端索引。
- 软淘汰（`prune`）只进回收站、不物理抹除；「每个仓库至少保留 1 个最新可用快照」的保底规则由对方的生命周期引擎保证。
- 归档失败只报错 + 根因，不静默跳过、不手工复制文件顶替。
