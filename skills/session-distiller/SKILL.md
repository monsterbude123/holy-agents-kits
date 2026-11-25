---
name: session-distiller
description: "从完整会话历史中蒸馏出可验证、可复用、非空泛的技能包（SKILL.md + references + templates）。做去重检查、错误路径诊断（反复道歉 → 反向提示词）、输入端情绪中性化与温度值（保留严重程度信号）、Agent-子代理交互质量分析。用户说提炼技能、蒸馏会话、生成技能包、整理方法论、总结最佳实践、诊断反复道歉、反向提示词、情绪中性化、减少内耗、温度值时用。"
---

# Session Distiller — 会话蒸馏器

输入：一段完整会话（含子代理往来）。产出：一个能直接装进 `~/.agents/skills/` 的技能包。
中间只有五步，走完还要过一道打分线——**低于 4.0 分不许交付**。

## 怎么用

| 用户要什么 | 你做什么 |
|---|---|
| 提炼技能 / 蒸馏会话 / 整理方法论 | 走下面五步（第 2 步是去重，别跳） |
| 诊断反复道歉 / 要反向提示词 | 只走下面「错误路径诊断」那条路 |
| 情绪中性化 / 算温度值 / 减少内耗 | 只走下面「情绪中性化」那条路，跑脚本 |

三条路各有入口，互不依赖；同一轮会话既蒸馏又诊断时，先蒸馏（诊断结论是素材之一）。

---

## 五步（主路径）

**Step 1 判要不要提炼**
一次性任务不提炼；只有「下次还会遇到」的流程才值得。判据：能在下一轮会话里复用 → 继续；不能 → 停。

**Step 2 生成主题指纹并扫已有技能**
用一句话写清「这轮解决的核心问题 + 解法 + 关键词」，再去已有技能里找同义的。
决策只有三个：**新建 / 合并进已有 / 跳过**。不扫就新建 = 制造同义技能。
**扫描范围默认锁在项目内**（项目根的 `skills/`、`.agents/skills/`、`AGENTS.md`、项目 rules）；
`~/.agents/skills/` 等全局库与其它项目**只有用户明确要求才看**，并要在产出里注明「已超出项目范围（用户要求）」。
流程与相似度算法 → [skill-dedup.md](references/skill-dedup.md)；示例与清单 → [skill-dedup-examples.md](references/skill-dedup-examples.md)。

**Step 3 提取模式**
把重复操作、决策路径、边界条件列出来再归纳。每条都要能回答「下次在什么信号下照做」。

**Step 4 提炼铁律 + 反例**
MUST / NEVER / ROLLBACK 三类不可协商规则，**每条都要能被机器或人一眼判定**——
"函数 ≤ 50 行"能判，"保持代码整洁"不能判；后者直接丢弃重写。
同时记下踩过的坑：当时以为 X、实际是 Y、教训是 Z。**只写正例的产出视为未完成**。
提问清单 → [distillation-steps.md](references/distillation-steps.md)。

**Step 5 产出并打分**
生成 SKILL.md（正文 ≤150 行，第一屏必须是主轴）+ references + templates。
然后逐项打五项分（验证性 / 具体性 / 完整性 / 反例 / 可执行性）：**≥4.0 交付，<4.0 返工**。
清单 → [quality-checklist.md](references/quality-checklist.md)；算分与常见问题 → [quality-scoring.md](references/quality-scoring.md)。

> 三条底层取向（为什么这么挑内容）：验证性 > 叙述性、具体性 > 抽象性、反例价值 > 正例。
> 展开与边界原则 → [distillation-methodology.md](references/distillation-methodology.md)。

---

## 错误路径诊断（单独的路）

**触发**：同一问题道歉 ≥ 2 次 / "我搞错了"式无效道歉 / "重新尝试"但说不出具体改了什么。

**三步**：识别错误模式（5 大模式）→ 根因归类（技能缺陷 / 提示词歧义 / 工具选错 / 上下文缺失）
→ 生成反向提示词（把"不要 X"改写成"遇到 Y 时做 Z"）。
诊断命中后照做的处置协议（失败分析 / 子代理产物验证 / Completion Report 校验 / 上下文纪律 / 工具选择）
→ [apology-protocols.md](references/apology-protocols.md)。

模式清单与实战案例 → [apology-diagnosis.md](references/apology-diagnosis.md)；
两份完整演练（看生成的禁止项 / 铁律 / 门禁长什么样）→ [examples/](examples/)。

---

## 情绪中性化（单独的路）

**什么时候走**：用户发言带情绪载荷（骂人、连问、叹号），而你要把它变成可执行的诉求。

**三步**：
1. 算温度值 —— `temperature --emotion-score … --history-count … --days-ago …`
2. 做中性化：剥离情绪词、保留事实/意图/约束，**原始话术必须留在输出里**（否则用户失去审计能力）。
3. 跑 `verify` 校验：不通过**不得**进入下游任务。

```bash
python <skill_dir>/scripts/emotional-neutralize.py --self-test
python <skill_dir>/scripts/emotional-neutralize.py temperature --emotion-score 0.75 --history-count 3 --days-ago 2
python <skill_dir>/scripts/emotional-neutralize.py verify --original "…" --neutral "…" --annotations a.json
```

温度值 = 该诉求域的历史失败累积指数，不是当次情绪强度：**高温 = 规则冲突已固化，先自省再动手**。
公式与六个关注度档位 → [temperature.md](references/temperature.md)；
六步算法与 4 条越权边界 → [emotional-neutralizer.md](references/emotional-neutralizer.md)；
输出格式 → [templates/emotional-neutralize.md](templates/emotional-neutralize.md)；
示例与失败处置矩阵 → [neutralize-examples.md](references/neutralize-examples.md)。

---

## 子代理产物怎么验（不盲信）

委派质量决定成败。四项检查：委派类型对不对 / 白名单有没有越 / Completion Report 的 evidence 与
pass_count 是否真实（主上下文必须自己抽检） / 连续失败 ≥2 换 agent、≥3 出阻塞报告。
展开 → [distillation-steps.md](references/distillation-steps.md)。

---

安装位置：`~/.agents/skills/session-distiller/`（本仓 `skills/session-distiller/` 逐字节一致）。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
