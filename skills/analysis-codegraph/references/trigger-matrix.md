# 触发总则 / 触发矩阵 / 三场景协议 / 快速启动 / 合法例外

> **MCP 侧**：`codegraph_explore`（参数 `query` / `maxFiles` / `projectPath`，`projectPath` 必传）。
> 上游有意只暴露这一个工具——单工具比菜单式多工具误选更少、更省 context，
> 且它是其余工具的**超集**（返回内容全都在 blast radius 段、关系图、符号体里）。
>
> **真的不存在**：`context` · `trace` · `cypher` · `rename` · `detect_changes` · `list_repos`。
>
> 编号跨文件连续：§3 反模式与收尾自检在 `references/anti-patterns.md`，§11 子代理契约在
> `references/subagent-contract.md`，§12 降级协议在 `references/degradation.md`。

---

## §0 原语化触发总则（最高优先级，先于 §1 §2）

- **只有主代理有权做索引更新**（`codegraph init` / `index` / `sync` / `uninit`）。
- **主代理委派子代理做代码任务前，先自己用 `codegraph_explore` 检查变更面**，再派发。
- **子代理不得自行更新索引。**

| ID | 规则 | 反触发语（出现这句 = 违规） |
|---|---|---|
| **MUST-ORIGIN-1** | **调查开始必先放大招**：任何「问代码」的问题，第一个工具是 codegraph，不是 Read / Grep | 「turn1 调过，turn2..N 跳过」 |
| **MUST-ORIGIN-2** | **方向切换必重调**：准备发起搜索，且问题含「在哪 / 谁调用了它 / 谁写入了它 / 还有谁在用 / 改了会影响谁」之一 → 这就是一次补招 | 「已经分析过」「这块看过，复用」「刚 Read 过这个函数」 |
| **MUST-ORIGIN-3** | **每次 Edit 前必调**：同一文件第 N 次改也要重跑 | 「刚查过这文件，小改跳过」 |
| **MUST-ORIGIN-4** | **不确定即触发**：不必等 §1 矩阵命中，「我不确定代码现状」本身就够 | 「我先想想」 |

> **「走 codegraph」指能力，不是某一个工具名。** 两条入口等价：
> - MCP：`codegraph_explore` —— 主会话默认入口
> - CLI：`codegraph explore "…"` —— **工具表里没有 MCP 工具时走这条**
>
> 工具表里没有 MCP 工具时，MUST-ORIGIN-1..4 依然成立，改走 CLI。
> 「工具不在表里」**不是**跳过 codegraph 的理由，更**不是**退化成 Grep 的理由。
> 入口对照见 `references/cli.md`，状态判定见 `references/degradation.md` §12.0。

> **MUST-ORIGIN-2 的五个措辞是本文件最重要的一行。** 抽象的「方向切换」难以自我感知
> （心理活动通常是「我刚查过，方向没变」），但**具体措辞可以机械匹配**。这五个短语恰好是
> Blast radius 段与 Relationships 段的标准答案——用 grep 回答它们，等于拿手电筒去找地图上画好的路。
>
> **反例（不构成补招）**：搜配置 key / i18n key / 环境变量名等**字符串字面量**（不在符号图里），
> 或核对一个**已知位置**的细节。判据见 `references/anti-patterns.md` 的「发现型 vs 验证型」。

> ⚠️ MUST-ORIGIN 能修好「开局」，修不好「中途退化」。**中途退化的解毒剂是收尾自检的分类**，
> 不是再加一条口号。

---

## §1 强制触发矩阵（场景 → 动作）

codegraph 的关键特性：**一次 `codegraph_explore` 同时回答三类问题** ——
逐字源码（X 怎么写的）+ 调用图（X 调谁 / 谁调 X）+ blast radius 与 callers/tests（改了 X 影响谁）。
**所以「定位 → 看源码 → 摸影响面」是一次调用，不是三次。**

| 场景 | 触发条件 | 动作（顺序不可换） |
|---|---|---|
| **编码** | 改 fn / class / method / route / model / API / middleware / config | ①`explore`(功能域关键词) → ②`explore`(目标符号，调高 `maxFiles`) → ③读 **Blast radius** 段：HIGH / CRITICAL 先报用户 → ④`Edit` / `Write`（preamble 引用 blast radius） |
| **debug** | 测试失败 / 接口报错 / 行为不符 / 「为什么不工作」/ throw / stack trace | ①`explore`(报错关键短语) → ②`explore`(栈里可疑符号) → ③读 **Relationships** 段定位真实调用路径 → ④**再** `Read` 报错文件对应行段（chunk，不全量） |
| **分析** | 陌生代码 / 「怎么工作」/ 依赖 / 影响面 / 架构梳理 / 运行中新方向 | ①`explore`(业务域关键词) → ②`explore`(≥3 个核心符号同批) → ③读 **Blast radius** 段（双向）→ ④结论 **cite 返回的 file:line** |

**兜底**：不在表内（重构 / rename / 性能 / 安全 / 自由探索）也必跑 ①→②。

**Red flag**：Edit 范围 > blast radius 报告的范围 → 说明没查够 → 回到 ② 补查，不要硬改。

---

## §2 三场景协议

### §2.1 编码（每次都跑，不是首次）

```
1 explore("功能域关键词")                    # 摸清这块有哪些符号
2 explore("目标符号 + 它的 callers")          # 拿逐字源码 + blast radius
3 读返回的 Blast radius 段：
    HIGH / CRITICAL → 先 surface 给用户，等确认
4 Edit / Write                                # preamble 引用第 3 步结论
5 收尾自检（见 anti-patterns.md）
```

### §2.2 debug

```
1 explore("错误关键短语 / 报错原文片段")
2 explore("栈里可疑的 2-3 个 symbol 同批")
3 读 Relationships 段：谁真的调用了它、它调用了谁
4 Read 报错文件对应行段（chunk，不全量）
5 修复
6 收尾自检
```

反模式 🛑：**Read 报错文件但不 explore** / **凭经验定位不 explore** / **只 grep 报错字符串就下结论**。

### §2.3 分析

```
1 explore("业务域关键词")                     # 转向即重跑，不复用上次
2 explore("≥3 个核心 symbol 一批")             # 拿全 call graph
3 读 Blast radius 段（upstream callers + downstream callees）
4 输出结论，每条 cite file:line
```

反模式 🛑：「Read 几行窥探」/「这个项目我熟」/ **输出结论不 cite 行号**。

---

## §5 快速启动（首轮模板）

> 会话中第 N 轮 / 新方向：**只跑对应单步**，不重跑全流程。

- **编码首轮**：`explore(域)` → `explore(符号 + callers)` → 读 blast radius（LOW / MEDIUM 可改，HIGH / CRITICAL 先报用户）→ `Edit`（preamble cite）→ 收尾自检。
- **debug 首轮**：`explore(报错短语)` → `explore(可疑符号)` → 读 Relationships → `Read`(chunk) → 修复 → 收尾自检。
- **分析首轮**：`explore(域)` → `explore(≥3 符号)` → 读 blast radius → 结论 cite evidence。
- **转向重跑**：`explore("新关键词")` —— **不复用上次**。

**per-turn 增量**（MUST-ORIGIN-1/2/3 的操作化）：

- 提到新 symbol → 再 `explore` 一次
- 换方向 / 新报错 → 再 `explore` 一次
- 又要 Edit 同一文件（第 N 次）→ 再 `explore` 一次

---

## §6 合法例外（codegraph 不适用，Grep / Read / git 才是对的）

| 场景 | 用什么 |
|---|---|
| git 历史 / blame / 某行何时加入 | `git log` / `git blame` |
| 文档 / README / 规则文件 / MDX 注释 | `Read` |
| 配置 / env / Dockerfile / JSON schema / 数据库 schema 原文 | `Read` |
| **搜字符串字面量**（配置 key / i18n key / 环境变量名 / URL / 「找出所有 console.log」） | `Grep`（**必须带 `path`**，限定范围） |

> 这四条是**唯一**合法例外。「懒得调」「结果看着够了」「`maxFiles` 截断了」「我刚 Read 过」**都不是**例外。
>
> ⚠️ **第 4 条最常被滥用来给 grep 找台阶。** 判准是**搜的东西是不是代码符号**：
> - 搜 `NEXT_PUBLIC_FOO` 出现几次 → **字符串字面量** → Grep 对
> - 搜 `checkUserPaused` 出现在哪 / 谁调它 → **代码符号** → **这是漏招**，必须 `codegraph_explore`
>
> 收尾自检按「发现型 vs 验证型」逐条判，见 `references/anti-patterns.md`。
