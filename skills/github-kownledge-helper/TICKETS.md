# [TICKETS] github-kownledge-helper 技能自收束工单

> **看板**： [.agents/TICKETS.md](../../TICKETS.md)
> **约束**：纯原生 `.mjs`、零编译、零 node_modules；TDD 先行；不硬编码本机路径。
> **目标终态**：本仓库 = 一个自包含技能，拷走目录 + 配好 `.agents/.env` 即可运行（`node scripts/cli.mjs <cmd>`）。
> **状态**：全部工单已 `done`（交付证据见各票「验收证据」段）。

---

<a id="ghk-01"></a>

## GHK-01 · cli-development.md 命令清单去重

- **状态**：`done`
- **类型**：文档内聚
- **涉及文件**：`.agents/skills/github-kownledge-helper/references/cli-development.md`
- **现状（已核实）**：§已有命令清单 是 8 行表格，与 `commands.md` 的命令清单**重复且不完整**（缺 `query` / `query-all` / `sync-to`）；协议正文却只要求维护 `commands.md` → 双份必然分叉。
- **动作**：
  1. 删除 §已有命令清单 整张表格，替换为一行指针：`> 完整命令清单见 [commands.md](./commands.md)`（此路径相对 `references/cli-development.md`，目标文件为 `references/commands.md`）；
  2. 全文中其他指向 `commands.md` 的链接统一为相对路径 `./commands.md`；
  3. **不改命令写法**（旧命令写法 → `node scripts/cli.mjs …` 由 GHK-09 统一替换，避免两次改动）。
- **验收标准 (DoD)**：
  - `references/cli-development.md` 中不再存在第二份命令表格；
  - 本文件内命令示例 ≤ 3 处且均带指针说明；
  - skill-creator-v2 门禁 0 error 0 warn。
- **验收证据**：表格已删，文件尾两处指针均指向 `./commands.md`；命令示例 3 处（`node scripts/cli.mjs --help` / `node --test "scripts/test/*.test.mjs"` / `node scripts/cli.mjs <command>`）；门禁输出「✓ 通过」。

---

<a id="ghk-02"></a>

## GHK-02 · tdd.md 删除陈旧进度快照

- **状态**：`done`
- **类型**：文档内聚
- **涉及文件**：`.agents/skills/github-kownledge-helper/references/tdd.md`
- **现状（已核实）**：§进度 写死「5 个测试套件 / 25 个用例」，实测旧测试目录下 **11 个测试文件 / 87 个 `it()` 用例** → 快照失真且无人维护。进度信息属运行时产物，不该硬编码进技能文档。
- **动作**：
  1. 删除 §进度 整节（含套件分布列表）；
  2. 替换为一行规则：`> 当前测试通过情况由测试命令实时产生，禁止在文档中硬编码用例数快照。`；
  3. §跑测试 中的命令写法随 GHK-09 统一替换。
- **验收标准 (DoD)**：全文 `grep -n "个测试套件\|个用例"` 无匹配；门禁 0 error 0 warn。
- **验收证据**：§进度 已整节删除，替换为「禁止硬编码用例数快照」一行规则；`grep -n "个测试套件\|个用例" references/tdd.md` 无输出；门禁输出「✓ 通过」。

---

<a id="ghk-03"></a>

## GHK-03 · doc-verify.md 已知限制升级为 pitfalls §012

- **状态**：`done`
- **类型**：文档内聚 / 缺陷登记归位
- **涉及文件**：`references/doc-verify.md`、`references/pitfalls.md`
- **现状（已核实）**：§进度 + §已知限制 描述了一个**至今未修的真实缺陷**——聚合目录（`ai-app/…`）下 `owner__repo` 子串 grab 命中率低，27/39 missing 属 false positive。技能文档在此承担了 bug tracker 职责，使用者无法判断 `verify-docs` 当前是否可信。
- **动作**：
  1. 在 `pitfalls.md` 末尾新增 **§012 聚合目录 verify-docs 假阳性**：写清根因（query 串与索引 path 子串不匹配）、影响范围（聚合目录仓库）、临时规避（用 `--lookup` 替代 `--grab`，或在 query 串带 group 前缀）、根治方向（下一轮改用 `--lookup`）；
  2. `doc-verify.md` 顶部加醒目状态行：`> ⚠️ verify-docs 对聚合目录仓库命中率低（已知问题，见 pitfalls §012），排查时建议改用 --lookup`；
  3. 删除 `doc-verify.md` 的 §进度 整节。
- **验收标准 (DoD)**：pitfalls 含 §012 且含根因 + 规避；doc-verify.md 不再出现 §进度；门禁 0 error 0 warn。
- **验收证据**：pitfalls.md 末尾新增 §012（含现象 / 根因 / 影响范围 / 临时规避 / 根治方向 / 预防）与 §013；doc-verify.md 顶部状态行指向 `pitfalls.md#012-...`，§进度 已删；门禁输出「✓ 通过」。

---

<a id="ghk-04"></a>

## GHK-04 · commands.md 一次性脚本下沉 pitfalls

- **状态**：`done`
- **类型**：文档内聚
- **涉及文件**：`references/commands.md`、`references/pitfalls.md`
- **现状（已核实）**：`commands.md` 末尾挂着「批量重命名 PowerShell 脚本」这类**一次性临时操作**，与"命令清单"职责不符，干扰日常查阅。
- **动作**：
  1. 把该段整体移入 `pitfalls.md` 末尾作为历史记录（标注：一次性操作，已完成，留作复用参考）；
  2. `commands.md` 只保留命令清单 + 通用用法约定。
- **验收标准 (DoD)**：`commands.md` 不含一次性脚本段落；`pitfalls.md` 承接该内容且分类正确；门禁 0 error 0 warn。
- **验收证据**：`commands.md` 已无「批量重命名」段；`pitfalls.md` §013 承接该 PowerShell 脚本并标注「一次性操作（已完成，留作复用参考）」；门禁输出「✓ 通过」。

---

<a id="ghk-05"></a>

## GHK-05 · workflows.md / rules.md 重叠收敛

- **状态**：`done`
- **类型**：文档内聚
- **涉及文件**：`references/workflows.md`、`references/rules.md`
- **现状（已核实）**：`workflows.md` §1~§4 的基线步骤与 `rules.md` 的路径约定 / clone-pull 规则 / manifest 维护铁律存在内容重叠，双处维护易分叉。
- **动作**：
  1. 以 `rules.md` 为**权威**（规则与硬约束的唯一出处）；
  2. `workflows.md` 只保留「决策树 + 每步指向 rules.md 的对应小节」，删除可在 rules.md 查到的重复步骤描述；
  3. `SKILL.md` §1 决策表的指针保持不变（仍指向 workflows.md）。
- **验收标准 (DoD)**：rules.md 与 workflows.md 无同一规则被两处重述；workflows.md 精简后仍能独立支撑答疑决策；门禁 0 error 0 warn。
- **验收证据**：`workflows.md` §1~§4 已改为决策树 + 「→ rules.md §N」指针（clone 策略 / manifest 回写 / ff-only / 顺序执行 / 新鲜度红线均不再复述）；`rules.md` 补「CLI 工具源码 / CLI 入口 / CLI 测试」路径行与「零构建」约束；门禁输出「✓ 通过」。

---

<a id="ghk-06"></a>

## GHK-06 · evolution.md 的 CHANGELOG 悬挂引用修复

- **状态**：`done`
- **类型**：文档内聚 / 悬空引用
- **涉及文件**：`references/evolution.md`、`SKILL.md`
- **现状（已核实）**：`evolution.md` §升级流程 Step 3 要求"追加 CHANGELOG 条目"，但 `SKILL.md` 无 CHANGELOG 入口 → 执行者找不到该写哪。仓库根确有 `CHANGELOG.md`。
- **动作**：
  1. 在 `SKILL.md` §4 经验沉淀索引 增加一行入口：`> 仓库级变更记录：[CHANGELOG.md](../../../CHANGELOG.md)`（路径按实际层级核对）；
  2. `evolution.md` Step 3 措辞明确为「追加仓库根 `CHANGELOG.md` 条目 + 本文件演进日志表」；
  3. `SKILL.md` 正文行数仍在 150 行上限内。
- **验收标准 (DoD)**：evolution.md 的每条外部引用在仓库中都能定位到真实文件；门禁 0 error 0 warn。
- **验收证据**：SKILL.md §4 末行已加 CHANGELOG 入口（路径 `../../../CHANGELOG.md`，实际可达仓库根）；evolution.md Step 3 已改为「追加仓库根 `CHANGELOG.md` 条目 + 本文件演进日志表」；门禁报「正文行数: 82（上限 150）」且「✓ 通过」。

---

<a id="ghk-07"></a>

## GHK-07 · 零构建迁移：旧 TS CLI → 技能内 scripts/*.mjs

- **状态**：`done`
- **类型**：核心迁移（**本 EPIC 最重的一票**）
- **体量（已核实）**：迁移前旧 TS CLI 目录共 18 个源文件 + 11 个测试文件 + 1 个 tsconfig。
- **目标结构**：
  ```
  .agents/skills/github-kownledge-helper/
  ├── scripts/
  │   ├── cli.mjs              # 统一入口：node scripts/cli.mjs <cmd>
  │   ├── lib/                 # env / git / manifest / paths / time / argv / repoScan ...
  │   └── commands/            # add / update / update-all / query / sync-manifest / sync-docs / verify-docs / sync-to
  └── scripts/test/            # node:test 用例
  ```
- **动作**：
  1. 逐文件 TS → `.mjs`：去类型注解、去 `import type`、`.ts` 扩展名改 `.mjs`；
  2. **commander → 原生 argv 解析**：保留现有子命令名、参数名与输出格式（`add` / `update` / `update-all` / `query` / `query-all` / `sync-manifest` / `sync-docs` / `verify-docs` / `sync-to`），自行实现 `--flag` / `--opt value` 解析；
  3. **vitest → `node:test`**：`describe/it/expect` 改写为 `node:test` + `node:assert/strict`，断言语义不变；
  4. **必须保留** `tdd.md` 记录的两条硬约定：
     - 路径隔离：`getProjectRoot(cwd = process.cwd())` 从 cwd 向上找 `manifest.json` 定位根，测试用 `process.chdir(tmpRoot)` 隔离；
     - e2e 用**真 git fixture**（`git init --bare` + `symbolic-ref HEAD refs/heads/<branch>`），**不 mock** fs / git / 子进程；
  5. `load_env.ts` 的能力（向上探测 `.agents/.env`、双拼写兼容 `GITHUB_KNOWLEDGE_HELPER_SPACE` / `GITHUB_KOWNLEDGE_HELPER_SPACE`）迁入 `scripts/lib/env.mjs`，与 `generic-storage-sync/scripts/env.mjs` **同源同行为**（两文件逐字节一致，SHA256 相同）。
- **验收标准 (DoD)**：
  - `node --test` 全绿，用例数 ≥ 87（不低于迁移前）；
  - 每条既有命令在新入口下行为一致：`node scripts/cli.mjs --help` 列出全部子命令；
  - 迁移后源码中零 `import type`、零 `any` 逃逸、零 commander / vitest 引用；
  - 单文件 ≤ 150 行（skill 规范上限精神），超限的拆模块而非堆长函数。
- **验收证据**：
  - `node --test ".agents/skills/github-kownledge-helper/scripts/test/*.test.mjs"` → `# tests 87 / # pass 87 / # fail 0`（14 个测试文件，用例数与迁移前持平）；
  - `node scripts/cli.mjs --help` 列出 9 个子命令（add / update / update-all / query / query-all / sync-manifest / sync-docs / verify-docs / sync-to）；
  - 源码 grep：`import type` 0 处、`any` 逃逸 0 处、旧 CLI 框架 / 测试框架 / TS 工具链引用 0 处；
  - **单文件全部 ≤ 150 行**（最大 150 行）。为达成该约束做的拆分：
    | 拆分 | 结果 |
    |---|---|
    | `cli.mjs` 303 行 | → `cli.mjs` 114 行（只做汇总 + 解析 + 分派）+ 各命令模块自带 `def`（usage / 选项 / 执行体） |
    | `commands/query.mjs` 195 行 | → `commands/query.mjs` 150 行 + `lib/queryModes.mjs` 124 行（各模式实现） |
    | `lib/env.mjs` 245 行 | → `lib/env.mjs` 117 行（两技能共享核心）+ `lib/envStrict.mjs` 147 行（本技能严格层） |
    | `lib/verifyIndex.mjs` 158 行 | → `lib/verifyIndex.mjs` 78 行 + `lib/docmapSqlite.mjs` 75 行（内联 SQL） |
    | `commands/sync-to.mjs` 170 行 | → `commands/sync-to.mjs` 71 行（CLI 表面）+ `lib/mirror.mjs` 103 行（镜像实现） |
    | 测试文件 4 个超限 | → 抽 `scripts/test/helpers.mjs`（真 git 夹具）+ 拆 `env` / `envStrict` / `query` / `queryRepo` |
  - 两技能 `env.mjs` SHA256 一致（`2EB2995E…`）。
- **备注**：`runBuildIndex` 改为**可注入 spawn**（第三参数），使 node:test 无需模块 mock 即可断言调用参数（原 vitest 用模块 mock 替换 `node:child_process`）。

---

<a id="ghk-08"></a>

## GHK-08 · 工程配置收尾（去 tsc / tsx / vitest / commander）

- **状态**：`done`
- **类型**：工程配置
- **前置依赖**：GHK-07
- **涉及文件**：`package.json`、`.gitignore`、删除 vitest 配置与 TS 配置
- **动作**：
  1. `package.json` 依赖清零：`commander` / `tsx` / `typescript` / `vitest` / `@types/node` 全部移除；
  2. `scripts` 重写为原生命令：
     ```json
     { "test": "node --test \".agents/skills/github-kownledge-helper/scripts/test/*.test.mjs\"",
       "ghh": "node .agents/skills/github-kownledge-helper/scripts/cli.mjs" }
     ```
  3. `bin.ghh` 指向 `.agents/skills/github-kownledge-helper/scripts/cli.mjs`；
  4. 删除 vitest 配置、TS 配置、`pnpm-lock.yaml` 与 `pnpm-workspace.yaml`（零依赖后二者无意义且会让 `--frozen-lockfile` 失败）；
  5. `.gitignore` 增加：`buffer/`、`.trash/`、`.staging/`、`.agents/.env`（已存在则保留）、`node_modules/`。
- **验收标准 (DoD)**：仓库内零 node_modules 依赖即可跑通 CLI 与测试；`grep -rn "vitest\|tsx\|commander" package.json` 无匹配；测试与 CLI 在纯净 Node 22 下可运行。
- **验收证据**：`package.json` 已无 `dependencies` / `devDependencies` 字段；`grep -n "vitest\|tsx\|commander" package.json` 无输出；`node scripts/cli.mjs --help` 与测试命令均在无 `node_modules` 状态下直接可跑（`node_modules/` 已删除）。
- **备注**：GHK-08 原写的测试命令为 `node --test <目录>`，实测 Node 22 的 `--test` **对目录参数不做递归发现**（会当模块加载报错），故改为 glob 形式（Node 22 支持 `--test` glob）。

---

<a id="ghk-09"></a>

## GHK-09 · 全量指针改指新入口

- **状态**：`done`
- **类型**：文档 / 指针一致性
- **前置依赖**：GHK-07
- **涉及文件**：`SKILL.md`、`references/*.md`（11 个）、根 `README.md`、`CONTRIBUTING.md`、`.github/`（PR 模板 / CI）
- **动作**：
  1. 全仓替换命令写法：旧 CLI 调用 → `node scripts/cli.mjs <cmd>`；测试 → `node --test "<glob>"`；删除类型检查相关表述（无 TS 后已无该命令）；
  2. 所有指向旧 TS CLI 目录的路径引用改为 `scripts/...`；
  3. `references/tdd.md` 整节重写为 **node:test 版**（删除 vitest 配置节，替换为 `node:test` 用法 + tmp fixture + 真 git e2e 规范，保留路径隔离模式说明）；
  4. `references/cli-development.md` 的 5 步协议路径改指 `scripts/commands/` 与 `scripts/test/`；
  5. `README.md` / `CONTRIBUTING.md` 的命令说明同步；
  6. `SKILL.md` §3 CLI 工具链整块替换为新入口，并保留"所有命令在项目根执行"的前置说明。
- **验收标准 (DoD)**：
  - 全仓 grep（旧 CLI 调用写法 / 旧类型检查命令 / 旧 TS 源码目录名）在 `.agents/` / `README.md` / `CONTRIBUTING.md` 中无匹配；
  - SKILL.md 正文 ≤ 150 行；
  - 每条文档里的命令都真实可执行（至少抽验 3 条：`--help` / `query-all` / `sync-manifest`）。
- **验收证据**：
  - 全仓 grep（旧 CLI 调用写法 / 旧类型检查命令 / 旧 TS 源码目录名）→ 无输出（本工单文件与看板内的旧写法亦已改写为中性表述；仓库根 `CHANGELOG.md` 作为历史记录保留原路径名，不在 DoD 扫描范围内）；
  - 门禁报「正文行数: 82（上限 150）」；
  - 抽验：`node scripts/cli.mjs --help` 列出 9 个子命令；`node scripts/cli.mjs query-all` 真实加载 `.agents/.env` 并输出 50 个仓库的最近活动；`node scripts/cli.mjs sync-manifest --dry-run` 输出 `total: 50 / added: 0 / updated: 0 / unchanged: 50 / removed: 0 / (dry-run, not written)`。

---

<a id="ghk-10"></a>

## GHK-10 · 门禁与回归闭环

- **状态**：`done`
- **类型**：验收收尾
- **前置依赖**：GHK-08、GHK-09
- **动作**：
  1. 删除旧 TS CLI 整个目录（迁移已完成并回归通过后）；
  2. 跑全套验证并留存输出：
     ```bash
     node --test ".agents/skills/github-kownledge-helper/scripts/test/*.test.mjs"
     python ~/.agents/skills/skill-creator-v2/scripts/validate_skill.py .agents/skills/github-kownledge-helper
     node .agents/skills/github-kownledge-helper/scripts/cli.mjs query-all
     ```
  3. 更新 `CHANGELOG.md`：记录"TS → 原生 .mjs 零构建收束"这一条结构性变更；
  4. 更新 `docs/.docmap/config.json`（若索引范围覆盖 `.agents/`，同步纳入新文档）。
- **验收标准 (DoD)**：
  - 测试全绿（0 failed）；
  - 门禁 **0 error 0 warn**；
  - `query-all` 真实加载 `.agents/.env` 并输出收录仓库活跃信息（证明配置链路未断）；
  - 仓库内无旧 TS CLI 残留、无 `node_modules` 硬依赖。
- **验收证据**：
  - `node --test ".agents/skills/github-kownledge-helper/scripts/test/*.test.mjs"` → `# tests 87 / # pass 87 / # fail 0`；
  - `python ~/.agents/skills/skill-creator-v2/scripts/validate_skill.py .agents/skills/github-kownledge-helper` → 「✓ 通过 / 结论：全部通过」（`--all` 模式同样通过，反馈入口在位）；
  - `node .agents/skills/github-kownledge-helper/scripts/cli.mjs query-all` → `=== recent activity across 50 repos ===` + 50 行仓库活跃信息；
  - `node scripts/cli.mjs verify-docs` → `=== verify-docs: total=50 🟢5 🟡44 🔴1 ===`（exit 1 来自 1 个仓索引新鲜度 <0.3 的**既有数据状态**，非迁移引入；查询链路本身可用）；
  - 旧目录已删除（旧 TS CLI 目录 / vitest 配置 / TS 配置 / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `node_modules/`）；
  - `docs/.docmap/config.json` **未改**：索引范围只覆盖 `docs/`（rules.md §5「索引目标：仅 docs/ 目录」），本就不含 `.agents/`，条件不成立。

---

<a id="ghk-10"></a>

## GHK-10 · clone 三处能力缺口修复 + add-batch 批量收录

- **状态**：`done`
- **类型**：能力补齐（真实事故倒逼）
- **触发场景**：归档 10 个 GitHub 仓到百度网盘，本机到 GitHub 带宽仅 ~1 MB/s。
- **涉及文件**：`scripts/lib/cloneStrategy.mjs`（新）、`scripts/commands/add-batch.mjs`（新）、`scripts/commands/add.mjs`、`scripts/lib/git.mjs`、`scripts/cli.mjs`、`references/rules.md`、`references/workflows.md`、`references/commands.md`、`SKILL.md`
- **三个缺口（均已核实，非推测）**：
  1. **clone 超时硬编码 10 分钟** —— `add.mjs` 原写死 `timeoutMs: 10 * 60_000`。大仓在 ~1 MB/s 下必然超时（orca 完整 clone 需 60+ 分钟）。
  2. **超时只 kill 直接子进程** —— `git.mjs` 原 `child.kill('SIGTERM')`。git clone 派生的 `git-remote-https` / `git index-pack` 变孤儿继续下载；父命令已判失败、后续写 manifest 不执行，而 git clone 失败时又自删目标目录 → **已下载 2.3 GB 全部丢失**。
  3. **rules.md §4.5 承诺的浅克隆降级无实现** —— 规则写了「连续失败 2 次可降级为浅克隆重试」，代码里搜不到任何 `--depth` → 规则与实现脱节。
- **动作**：
  1. 新增 `lib/cloneStrategy.mjs`：超时默认 60 分钟且可配；完整 clone 失败自动降级 `--depth 1 --single-branch` 重试；失败必清半成品目录。
  2. `lib/git.mjs` 新增 `killTree()`：Windows `taskkill /T /F`，POSIX 独立进程组（`detached` spawn）+ `kill(-pid)`。
  3. 新增 `add-batch`：顺序执行、已收录自动跳过（断点续跑）、单仓失败不中断整批、结束统一收口 manifest。
  4. `add` 新增 `--shallow` / `--timeout <分钟>`。
- **关键实测数据**（写进 rules.md 作为判据）：
  - orca 完整 clone 3.7 GB / 默认分支工作树 263 MB —— **差 14 倍，差值几乎全在 `refs/pull/*` 与侧分支**（orca 有 41782 个 PR ref、21976 个 head）。
  - 浅克隆耗时对比：orca 完整 clone 60+ 分钟 → 浅克隆 332 秒。
- **验收标准 (DoD)**：
  - `node --test "scripts/test/*.test.mjs"` → 112 passed / 0 failed（原 94）；
  - 新增 `cloneStrategy.test.mjs`（11 例）与 `addBatch.test.mjs`（7 例）；
  - `add-batch` 真实跑通「已收录仓自动跳过」（3 仓跳过、0 clone）；
  - rules.md §4 与 workflows.md §1 决策树反映新行为；
  - 全局副本经 `install --force` 同步，sha256 逐文件核对 63 个文件零差异。
- **验收证据**：
  - `node --test "scripts/test/*.test.mjs"` → `# tests 112 / # pass 112 / # fail 0`；
  - `node scripts/cli.mjs add-batch mattpocock/skills debpalash/VoiceStudio cloudflare/security-audit-skill` → 「⊘ ×3 已收录，跳过 / 共 3，成功 0，跳过 3，失败 0」；
  - `node scripts/cli.mjs --help` → 命令表出现 `add-batch`；
  - `node bin/cli.js install github-kownledge-helper --force` → sha256 核对 63 文件、差异 0；
  - 提交：`7b78156`（能力修复 + 新增命令）、`948e934`（0.16.0 版本与 CHANGELOG）。

