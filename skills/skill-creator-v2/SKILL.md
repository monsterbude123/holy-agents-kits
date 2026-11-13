---
name: skill-creator-v2
description: 创建、改造与评测 Agent Skill——生成技能骨架、把超长 SKILL.md 拆到 references/、把重复代码固化成 scripts/、校验技能是否符合规范、跑测试用例并根据人工反馈迭代、优化 description 触发率。当用户要「写一个 skill」「改 skill」「新增技能」「SKILL.md 太长」「拆分 references」「技能校验」「打包 skill」「评测 skill」时加载。触发词：skill、技能、SKILL.md、frontmatter、references、scripts、scaffold、触发率、评测、benchmark。
---

# skill-creator · 技能的开发、维护与评测

这个技能管的是**技能本身**：怎么立项、怎么搭骨架、细节放哪、重复代码放哪、怎么被校验、怎么被评测。
它不生产业务技能的内容，它生产**生产技能的方法**。

---

## §1 骨架流程

新建或改造一个技能，按这六步走，**不跳步**。

```
① 立边界 → ② 起骨架 → ③ 填核心 → ④ 溢出外迁 → ⑤ 过校验 → ⑥ 跑评测
```

| 步 | 做什么 | 产出 |
|---|---|---|
| ① 立边界 | 说清技能替 agent 承担了什么、什么**不**归它管；列出触发词 | 职责一句话 + 触发词清单 |
| ② 起骨架 | 用 `scaffold_skill.py` 生成目录与三段式正文 | `SKILL.md` + `references/` + `scripts/` |
| ③ 填核心 | 填「骨架流程 / 核心逻辑 / 核心循环」，只写**判断依据**，不写实现 | 满血 SKILL.md |
| ④ 溢出外迁 | 协议表、错误码、示例集、长清单 → 写进 `references/<topic>.md`，正文留指针 | references 文件 + 正文指针 |
| ⑤ 过校验 | 跑 `validate_skill.py`，error 清零、warn 逐条确认 | 校验报告 |
| ⑥ 跑评测 | 有客观可验证的输出才跑：测试用例 → 人工/脚本评分 → 反馈迭代 | 评测报告 |

**先做 ② 再做 ③。** 骨架自带占位与行数约束；先写满再瘦身是逆操作，成本高得多。
**⑥ 是可选的。** 主观输出（写作风格、审美）跑量化评测意义不大，直接和用户对齐即可。

---

## §2 核心逻辑

### 2.1 渐进披露：三级加载

| 层级 | 内容 | 何时进上下文 |
|---|---|---|
| 元数据 | `name` + `description` | 永远在（也是唯一的触发依据） |
| SKILL.md 正文 | 骨架 / 逻辑 / 循环 | 技能被触发时**全量**进 |
| references / scripts | 细节文档 / 固化程序 | 按需读 / 直接执行 |

正文是每次调用都要付钱的部分，所以它有行数上限（本仓 ≤ 150 行）。
细节属于 `references/`，**但抽走内容必须在原处留指针**——藏起来的知识等于丢掉的知识。

### 2.2 正文放什么、不放什么

| 内容 | 去处 | 判据 |
|---|---|---|
| 主干步骤、判断依据、退出条件 | SKILL.md | 每次调用都要用到 |
| 参数表、协议细节、错误码、示例集 | `references/` | 只在特定分支才需要 |
| 长清单（模型名、字段名、映射表） | `references/` | 能被程序读到就不该占正文 |
| 需要重复执行的程序 | `scripts/` | 只要会出现「第二次写同样的代码」 |

**一句话判据**：正文只写**判断**，references 写**知识**，scripts 写**执行**。

**密度三规**——150 行是天花板不是目标，正文写到 30–60 行就该停笔：

- **步骤每步一行**：一行说清「做什么 + 怎么算完成」；命令、参数、工具名不进步骤，集中在「脚本」段。
- **判断条目 ≤ 2 行**：结论一句 + 理由（或指针）一句；写满三行说明内容该外迁 references。
- **同一判断全文只写一次**：流程写动作、逻辑写判断、退出条件只写判据清单；同一条规则出现第二遍就是注水，删掉。

### 2.3 什么该固化成脚本

出现下面任一情况，就写脚本而不是让模型现编：

- 同一段代码在多个测试用例里被重复写出来
- 解析有固定 schema（字段、枚举、必填项）——判定逻辑必须唯一，不能每次重新推导
- 步骤有固定顺序且可机械检查

脚本要求：只依赖标准库、有 `--help`、错误信息写清怎么修、**stdout 是结果，stderr 是过程日志**。

### 2.4 description 决定生死

技能会不会被用，只看 `description`。它必须同时写清「**做什么**」和「**什么时候用**」，
并把用户的真实说法（触发词）写进去。描述模糊，技能就永远不会被触发——写得多漂亮都没用。

---

## §3 核心循环

### 3.1 开发循环（改技能）

```
立边界 → 起骨架 → 填核心 → 溢出外迁 → 过校验
  ↑                                    │
  └────────── 有 error / 正文超长 ─────┘
```

退出条件：校验 error 为 0，正文 ≤ 150 行且按 §2.2 密度三规自查无注水，占位与 TODO 全部消化。

### 3.2 评测循环（改效果）

```
写测试用例 → 跑（有技能 / 无基线）→ 评分 → 人看结果 → 改技能 → 再跑
```

反馈为空 = 这次没问题；有反馈 = 下一轮的输入。
**先看 transcript 再看输出**——多数问题出在过程里，光看最终产物看不出来。
连续两轮没有实质进展就停下来，把选择权交回用户，别无限循环。

---

## §4 脚本

全部在 `scripts/`，只依赖标准库（PyYAML 有则用、无则退化到内置解析器）。

| 脚本 | 用途 |
|---|---|
| `scripts/skill_schema.py` | skill 定义的固有 schema：frontmatter 解析、章节切分、引用扫描、校验规则 |
| `scripts/validate_skill.py` | 全量校验（行数、frontmatter、引用完整性、代码外泄、末尾反馈入口） |
| `scripts/scaffold_skill.py` | 生成三段式技能骨架 |
| `scripts/split_skill.py` | SKILL.md 超长时自动抽到 `references/`，原处留引用 |
| `scripts/quick_validate.py` | 单技能快速校验（薄封装） |
| `scripts/package_skill.py` | 打包成可分发的 `.skill` |
| `scripts/aggregate_benchmark.py` | 聚合评测结果为 benchmark.json / benchmark.md |
| `scripts/generate_report.py` | 生成评测 HTML 报告 |
| `scripts/run_eval.py` | 触发率评测（依赖 `claude` CLI） |
| `scripts/run_loop.py` | description 优化循环（依赖 `claude` CLI） |
| `scripts/improve_description.py` | description 改写（依赖 `claude` CLI） |
| `scripts/utils.py` | 公共解析工具（内部模块） |

```bash
# 仓库门禁：校验全部技能，并检查每个 SKILL.md 末尾的反馈入口
python .agents/skills/skill-creator-v2/scripts/validate_skill.py --all --root .

# 生成骨架
python .agents/skills/skill-creator/scripts/scaffold_skill.py skills new-skill --description "一句话说明"

# 超长时自动拆分
python .agents/skills/skill-creator/scripts/split_skill.py skills/new-skill --max-lines 150
```

> **`claude` CLI 不可用时**（本机默认如此）：`run_eval.py` / `run_loop.py` / `improve_description.py`
> 跑不起来，改用「人工跑用例 + 自己判分」的降级路径，见 `references/environments.md`。

---

## §5 参考文件

- `references/structure.md` —— 目录布局、frontmatter schema、命名与写作规范；**写技能前先读**。
- `references/creating-skills.md` —— 立边界、访谈、写 SKILL.md、设计测试用例。
- `references/evaluating.md` —— 跑用例、评分、生成评审视图、读反馈。
- `references/improving.md` —— 从反馈里提炼改进项、迭代循环、盲测对比。
- `references/description-optimization.md` —— 触发率评测集设计与优化循环。
- `references/quality-gates.md` —— 全部校验项、错误含义与修法；**校验报错时查这里**。
- `references/environments.md` —— Claude.ai / Cowork / 本仓的环境差异与降级路径。
- `references/schemas.md` —— evals.json / grading.json / timing.json 的 JSON 结构。
- `references/benchmark-schemas.md` —— benchmark.json / comparison.json / analysis.json 的 JSON 结构。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
