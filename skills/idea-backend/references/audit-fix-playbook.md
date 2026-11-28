# 审查→修复流水线（IDEA 检视驱动）

> **来源**：2026-11-17 在一个 JDK25 + Spring Boot 4 项目（60 主代码 + 47 测试文件）实战的完整复盘。
> 那一轮把 IDEA 全局检视项从 **104 → 0**、改了 **66 个文件**、**314 个测试全绿**，
> 但**耗时 2h20m —— 产出量与耗时不匹配**。本 playbook 把「慢在哪」拆成可执行规则，把目标压到 **≤45min**。

---

## §0 这条流水线解决什么

|IDEA 的能力 | 用在哪 |
|---|---|
| `ide_inspect` engine=full | **权威问题源**：daemon-core 逐文件引擎（含阿里 P3C）+ 批处理管线全局工具（unused declaration / SameParameterValue / SameReturnValue…） |
| `ide_find_references` / `ide_call_hierarchy` / `ide_find_implementations` | 改签名前的影响面判定（别用文本搜索代替） |
| `ide_diagnostics` | 改完的无编译错误确认 |
| `ide_refactor_rename` (dryRun) | 安全改名 |
| `ide_sync_files` | VFS 同步（外部改动后 IDEA 才看得到新代码） |

**前提**：检视结果是**权威输入**，不是参考意见。审查的职责是「按检视结果分类定优先级 + 判定哪些是误报」，
**不是**自己发明问题清单。

---

## §1 时间预算（每阶段硬上限，超了就是方法错了）

| 阶段 | 预算 | 一条命令 | 实战中的错误耗时 |
|---|---|---|---|
| 0 门禁（IDEA 在跑 + 索引就绪） | 2 min | `scripts/setup-env.sh check` + `ide_index_status` | 3 min ✅ |
| 1 **拿全基线** | **3 min** | `scripts/audit-baseline.sh <proj> 25` | **25 min** ❌ |
| 2 分簇（按文件边界） | 5 min | 人工 + `git status` 辅助 | 20 min ❌ |
| 3 并发修复 | 25 min | 一次派出 N 组 | **75 min** ❌ |
| 4 JOIN 门禁 | 10 min | **一次** mvn + **一次**复检 | 30 min（mvn 跑了 3 次）❌ |
| 5 分组提交 | 5 min | 按簇 commit | 5 min ✅ |
| **合计** | **≤45 min** | | **2h20m** ❌ |

---

## §2 六条铁律（每条都对应一次真实翻车，违反即减速）

### 铁律 1 —— 禁手搓 curl/JSON-RPC
统一出口：`scripts/mcp-call.sh index <tool> '<json>'`。
翻车：那一轮手搓了 3 个临时 bash 脚本（`ide_call.sh`/`ide_verify.sh`/`idea_scan.sh`），反复撞
花括号拼接、路径转换、ANSI 转义；skill 里已有 `mcp-call.sh` 却没用。

### 铁律 2 —— 基线只跑一次，用 `audit-baseline.sh`
翻车：手工跑了 6+ 次 `ide_inspect`（分批试 6 文件、20 文件、60 文件、whole…），每次都重新
定位文件列表、重新解析 JSON。**28 秒能跑完的东西，花了 25 分钟。**

### 铁律 3 —— `problems` 文本清单会被截断，**以 XML + byTool 为准**
翻车：summary 里 `total: 403` 但只返回 68 行，`DuplicateExpressions` / `LoggingSimilarMessage` /
`SameParameterValue` 恰好落在被截掉的位置 → 差点漏掉整类问题。**批处理管线产出的 `xmlDir` 里的 XML 是全量的。**

### 铁律 4 —— `scope=whole` 不含 P3C
批处理管线的 local 段对第三方 local 工具（阿里 P3C）沉默。
**P3C 项只能靠 `scope=files` 拿到** → 所以 `audit-baseline.sh` 用「分批 scope=files，每批再取 XML」，
既拿全 P3C，又拿全 global 工具，不必再单独跑 whole。

### 铁律 5 —— 簇边界必须 = 文件边界
一个文件只能属一个簇；所有待改文件必须被某个簇覆盖。
翻车：第一轮 7 簇里 G4 整组没落地、G5/G6/G7 部分落地 → 只能再开 5 轮补修（补修 A/B/C/D/E）。
**根因是簇切得含糊（一个文件同时出现在两个簇的语义范围里），子代理互相避让 → 互相不碰。**

### 铁律 6 —— 精确清单投递，子代理不自己找
子代理 prompt 里直接给 `file:line | 工具 | 描述` 清单 + 豁免清单 + 验证约定。
翻车：第一轮子代理各自跑检视拿清单（重复劳动 + 各看各的截断切片 → 清单不一致）；
第二轮改成编排层给精确清单后，同样工作量从 75 min 降到 **~30 min**（补修 A/B 两组 18 文件）。

---

## §3 七步流水线

### Step 0 —— 门禁（≤2 min，别跳过）
```bash
bash scripts/setup-env.sh check          # 读 config.json：安装根/端口/commonProject
bash scripts/mcp-call.sh index ide_index_status '{}'   # 必须 isDumbMode:false && isIndexing:false
```
索引没就绪就跑检视 = 白等几分钟。

### Step 1 —— 拿全基线（≤3 min，一条命令）
```bash
bash scripts/audit-baseline.sh "$(pwd)" 25            # 107 文件 ≈ 28s
bash scripts/audit-baseline.sh "$(pwd)" 25 --whole    # 需要全项目 global 工具时追加
```
产出：归一化清单 `file:line | tool | desc`，分 `MAIN` / `TEST` / `NOISE` 三段
（`NOISE` = P3C `NonAsciiCharacters` 等噪音规则，单列不进清单）。

**不要**再单独调 `ide_inspect` 去「补查某类问题」—— 清单已经是全量的。

### Step 2 —— 分簇（≤5 min）
规则：
1. **按文件分**，不按问题类型分（问题类型会横跨文件，簇会打架）；
2. 簇内文件数 4~10；簇数 4~10 组（并发上限考虑）；
3. 每簇必须**独立可提交**（= 一笔 commit 的文件集）；
4. 有依赖的簇（改 A 的签名要改 B 的调用点）**必须放同一簇**；
5. 测试文件与其被测主代码**尽量同簇**（改签名要同步测试，反之亦然）。

分簇后先 `git status --porcelain` 确认没有文件漏在外面。

### Step 3 —— 一次性并发派发（≤25 min）
一次派出全部簇，**不要中途改分组**（中途重分组 = 前面全白干）。
prompt 模板见 §4。

### Step 4 —— 中断/失败恢复（关键，别重跑）
子代理被中断/超时/失败后：
```bash
git status --porcelain                 # 哪些文件已落地
# 对未落地文件重跑一次局部基线, 只补这些
bash scripts/audit-baseline.sh "$(pwd)" 25 --files-only <未落地文件>
```
**绝不整体重派**。翻车：那一轮被中断后直接重派了全部 7 组，用户当场批评「为啥又去重启已完成的内容」。

### Step 5 —— JOIN 门禁（≤10 min，只跑一次）
```bash
# 1) 一次构建测试（所有组都落地后）
docker exec -u vscode <container> bash -lc "cd /workspace && mvn -q test"
# 2) 一次复检（确认问题归零且没引入新的）
bash scripts/inspect-diff.sh "$(pwd)"     # 改动集的门禁（uncommitted 自动取集）
# 3) 需要全项目基线对比时再跑 audit-baseline.sh
```
翻车：mvn test 跑了 3 次（改前 / 改中 / 改后）；子代理又各自跑 `ide_diagnostics`。
**规则：mvn 只在编排层跑；子代理只允许跑 `ide_diagnostics`（无编译错误确认），不允许跑 mvn。**

### Step 6 —— 分组提交（≤5 min）
- 一个簇 = 一笔 commit，message 带类型前缀（`refactor(web):` / `test:` / `fix:`）；
- **显式文件列表 `git add`**，禁止 `git add -A`；
- 与本次任务无关的改动（别的会话遗留、docs 变更）**同批依赖要一起提，否则测试会红**：
  典型反例：`DocsContractTest` 断言了 `tests/e2e/` → 必须与 `docs/` + `tests/e2e/` 同批提交，
  否则 checkout 后测试红。本次做法：审查修复单独 4 笔，E2E 那批隔离留给用户。

---

## §4 子代理 prompt 模板（直接抄，五段式）

```
先读 <SKILL_DIR>/scripts/audit-brief.md（共用简报：IDEA 原生 MCP 工具用法、硬约束、豁免清单、交付格式），再执行你这一组的修复。

仓库根：<repo>

## 背景
<一段：为什么做这轮、上一轮做到哪、这组是第几组>

## 你的组（唯一可改的文件，逐个列全）
- src/...
- src/...

## 精确检视清单（IDEA ide_inspect engine=full 实测输出，逐条修）
1. <file>:<line> | <工具> | <描述> → <改法方向>
2. ...

## 判断原则（对"该改还是该豁免"给决策规则，不要让子代理猜）
- <工具 A>：<规则>
- <工具 B>：<规则>

## 豁免（属设计意图，不要动）
- <具体条目>

## 步骤
1. 用 mcp__idea-index__ide_find_references 查清每个候选的全部调用点（先查再改）
2. Read 目标文件上下文再改
3. 改完 mcp__idea-index__ide_sync_files → 用 mcp__idea-index__ide_diagnostics
   (files=你改过的文件, includeBuildErrors=true) 确认无编译错误
4. 按简报的交付格式写报告（逐条：位置 | 工具 | 改法 | 结果）

## 硬约束
- 不跑 mvn（编排层统一跑，target/ 会互相踩）；不碰 git（不 commit/stash/建分支）
- 行为保持：不改对外行为、响应形状、错误码、进度语义、留痕字段、脱敏规则、上游协议参数
- ⚠️ 改签名/改方法名/改 record 分量，必须用 ide_find_references 找到全部调用点，
  包括 src/test 下所有测试文件（本仓踩过：主代码把私有方法 main() 改名 mainCli()，
  测试用反射 getDeclaredMethod("main") 没同步 → mvn test 报 NoSuchMethodError）
- ⚠️ 对外响应字节必须不变（/v1/models、file_delete 等）：改 record 分量时用
  @JsonProperty 访问器 + @JsonPropertyOrder 保键序，并实测序列化字节一致
```

**关键**：清单给**方向**（怎么改），不替子代理做决定（该改还是豁免由它按判断原则判定并写依据）——
既保速度（不重新找问题）又保质量（不盲改）。

### §4.1 子代理 MCP 授权清单（照抄，别自己抄一遍）

**前提**：自定义 agent 的 `frontmatter tools:` 写什么就有什么；**内置类型 agent（general-purpose / Explore）工具表固定、没有 MCP** → 代码调查类必须派自定义 agent。最常见的错漏是**只授内置 server 的 `mcp__idea__*`**（那样没有 `ide_find_references`，子代理只能改用文本搜索找引用）。

最小授权（2026-11-20 按 server 实测工具面校准）：

```yaml
---
name: audit-fixer
description: 按 IDEA 检视清单修复指定文件组的问题
tools:
  - Read
  - Edit
  - Grep
  - mcp__idea-index__ide_find_references
  - mcp__idea-index__ide_find_definition
  - mcp__idea-index__ide_find_class
  - mcp__idea-index__ide_find_file
  - mcp__idea-index__ide_call_hierarchy
  - mcp__idea-index__ide_type_hierarchy
  - mcp__idea-index__ide_find_implementations
  - mcp__idea-index__ide_search_text
  - mcp__idea-index__ide_diagnostics
  - mcp__idea-index__ide_sync_files
  - mcp__idea-index__ide_index_status
  - mcp__idea__read_file
  - mcp__idea__get_file_problems
  - mcp__idea__lint_files
  - mcp__idea__search_symbol
  - mcp__idea__analyze_calls
---
```

- **按需加**：需要改名 → `mcp__idea-index__ide_refactor_rename`；需要建类型文件 → `mcp__idea-index__ide_create_from_template`（monster 分支才有）；需要抽方法 → `mcp__idea-index__ide_refactor_extract_method`（monster 分支才有）。
- **别授**：`execute_terminal_command`（CreateProcess 直调、PATH 是 IDEA 的、复合命令要自己包 `cmd /c`）、`build_project`/`execute_run_configuration`（构建与进程由编排层统一管，§Step 5 铁律）。
- **授了不等于能用**：工具面因插件版本而异（上游版没有 `ide_inspect`/`ide_refactor_extract_method`/`ide_create_from_template`）→ 派发前用 `bash scripts/mcp-call.sh list index` 核对清单；**当前 server 没暴露的工具，写进 prompt 只会让子代理静默降级**。
- **TS/Next 仓另有一套**：符号级工具在 TS 仓静默失效（位置法解析到目录符号），子代理必须改用 `ide_search_text` + 人工核对 —— 见 [langs/ts/runtime.md](langs/ts/runtime.md)。

---

## §5 中断恢复 vs 整体重派（对照表）

| 情形 | 正确动作 | 错误动作 |
|---|---|---|
| 子代理中断/超时 | `git status` 看落地 → 只补未落地文件 | ❌ 整体重派（浪费已完成工作） |
| 某组漏做 | 单独开一轮补那一组 | ❌ 重跑全部簇 |
| 用户中断整个流程 | 先 `git status` 盘点，再决定 | ❌ 从 Step 0 重来 |
| 检视清单有截断 | 读 `xmlDir` 的 XML | ❌ 再跑一次 `ide_inspect` 碰运气 |

---

## §6 反例集（实战真实翻车，按代价排序）

| # | 反例 | 代价 | 教训 |
|---|---|---|---|
| R1 | 手搓 curl 绕过 `mcp-call.sh` | 3 个临时脚本 + 反复踩路径/转义 | 用 skill 脚本 |
| R2 | 手工跑了 6+ 次 `ide_inspect` | **25 min** | `audit-baseline.sh` 一条命令 |
| R3 | 依赖被截断的 problems 清单，没读 XML | 漏掉整类问题（`DuplicateExpressions` 等） | 以 XML/byTool 为准 |
| R4 | 簇切得含糊 → G4 整组没落地、G5~G7 部分落地 | 多开 5 轮补修（+70 min） | 簇边界 = 文件边界 |
| R5 | 中断后整体重派 7 组 | 浪费已完成工作，用户当场批评 | `git status` 盘点后只补 |
| R6 | 子代理各自跑检视拿清单 | 重复劳动 + 清单不一致 | 编排层给精确清单 |
| R7 | 子代理各自跑 mvn | `target/` 互相踩 | mvn 只在编排层跑一次 |
| R8 | 未告知「改签名要同步测试反射」 | `mvn test` 报 NoSuchMethodError，返工一轮 | prompt 里写死这条 |
| R9 | 把别的会话的改动混在同一工作区 | 提交要额外隔离，还差点把 docs 契约测试拆散 | 提交前 `git status` 盘点 + 按簇隔离 |
| R10 | 为低价值测试项单开一轮（35 min 清 21 条测试噪音） | 35 min / 低收益 | 低价值项与相邻组合并，或直接豁免 |
| R11 | 第一次 MCP 工具没挂载就断定「用不了 IDEA」 | 绕路手搓 JSON-RPC | 先 `LocalToolSearch` 换多组关键词试；挂不上再走 `mcp-call.sh` |

---

## §7 工具坑（Windows/MSYS/插件层，踩过就记）

| 坑 | 现象 | 解法 |
|---|---|---|
| node 读 MSYS 路径 | `ENOENT: D:\tmp\x`（`/tmp/x` 被当成 `D:\tmp\x`） | 传给 node 前 `cygpath -m` | <!-- doc-hygiene:allow --> |
| Git Bash 判 `-d "C:/..."` | 恒假（认不出盘符形式） | `cygpath -u` 转成 `/c/...` 再判/拷贝 | <!-- doc-hygiene:allow --> |
| `grep` 是 ugrep | `grep '^X=' /c/path` → 「invalid option」（把路径当选项） | 用 `node -e` / `awk` / 脚本内联列表 |
| `DeferredToolCall` 包装层 | 数组参数被转成 object → 参数校验失败 | 数组参数走 `mcp-call.sh` 兜底 |
| `ide_search_text` 的 context 过滤 | `context=code` 扫 `"jobs/"` 返回 0 命中，实际 38 处 | **一律 context=all + 读文件复核**，别信过滤 |
| `ide_search_text` 的 snippet 字段 | `r.snippet` / `r.text` / `r.match` 名字不固定 | 逐个兜底取值 |
| problems 文本清单 | `total` 与返回行数不符 | 读 `xmlDir` |
| P3C `NonAsciiCharacters` | 612 条（每条中文注释一条） | 噪音规则，脚本已单列豁免 |
| `ide_inspect` 不在工具面 | 上游插件版（5.20.x）只有 16 个工具 → 整条流水线不可用 | `mcp-call.sh has index ide_inspect` 探测；脚本自动降级 `ide_diagnostics` |
| TS 仓位置法解析符号 | `resolvedSymbol.kind = directory` → 引用面是"目录"（假命中/0 命中），**不报错** | 查 `resolvedSymbol.kind`；TS 仓改走 `ide_search_text`（见 langs/ts/runtime.md） |

---

## §8 通用噪音与豁免（每次审查都要先定）

**通用噪音**（建议固定豁免，写进仓库规范）：
- P3C `NonAsciiCharacters` —— 中文注释项目必刷屏（612 条量级）；
- `BusyWait` —— 看门狗/轮询的 sleep 是设计意图；
- `SpellCheckingInspection` 对协议词/产品词的误报（`chatcmpl`/`minioadmin`/`rowcount`/`staleS`…）；
- `FieldCanBeLocal` / `UnnecessaryLocalVariable` —— 纯风格，diff 噪音大于收益。

**误报但要保留并说明**（不是豁免，是「加抑制 + 中文理由」）：
框架反射调用（`@Bean`/`@Scheduled`/`@PostConstruct`/`@EventListener`/Spring 注入字段）、
端口契约方法、错误码注册表的登记项、不可变协议 DTO 的 record 访问器。
→ 加 `@SuppressWarnings("unused")` + 注释写清「调用方是谁 / 为何保留」，别删。

**真死码要删**（零引用且非框架调用、非对外契约）：删前用 `ide_find_references` 确认。

---

## §9 判据

一次成功的审查→修复闭环应该同时满足：
1. `ide_inspect` 全局问题数 **归零**（或仅剩已记录豁免项）；
2. `mvn test` **全绿**，且**测试断言未被削弱**（子代理不得改断言期望值）；
3. 对外契约**字节不变**（JSON 字段名/顺序/值；已改的必须实测比对）；
4. 每个簇一笔 commit，message 带类型前缀；
5. 总耗时 **≤45min**（超过就是流水线哪一步走偏了，回到 §1 找）。
