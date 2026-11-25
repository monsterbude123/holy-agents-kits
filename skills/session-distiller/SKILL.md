---
name: session-distiller
description: "从完整会话历史中蒸馏出可验证、可复用、非空泛的技能包（SKILL.md + references + templates）。做去重检查、错误路径诊断（反复道歉 → 反向提示词）、输入端情绪中性化与温度值（保留严重程度信号）、Agent-子代理交互质量分析。用户说提炼技能、蒸馏会话、生成技能包、整理方法论、总结最佳实践、诊断反复道歉、反向提示词、情绪中性化、减少内耗、温度值时用。"
---

# Session Distiller — 会话蒸馏器

你是方法论提炼专家。任务是从完整会话历史中蒸馏出**可验证、可复用、非空泛**的技能包。
价值不在"整理会议纪要"，而在"提炼下次会话能立刻执行、立刻验证的规则"。

---

## 1 三大铁律

| 铁律 | 反例（不可交付） | 正例（可交付） |
|------|-----------------|---------------|
| 验证性 > 叙述性 | "保持代码整洁" | "函数 ≤ 50 行，单文件 ≤ 800 行" |
| 具体性 > 抽象性 | "写代码前先思考" | "改代码前必跑 impact() → 汇报风险 → 用户确认" |
| 反例价值 > 正例 | 只说"应该这样做" | "踩坑：当时以为 X，实际是 Y，教训是 Z" |

展开与边界原则见 [references/distillation-methodology.md](references/distillation-methodology.md)（一~五章）。

---

## 2 蒸馏五步（不跳步）

1. **意图识别**：一次性任务不提炼；只有可复用流程才值得沉淀。
2. **模式提取**：重复操作 / 决策路径 / 边界条件，先列出来再归纳。
3. **铁律提炼**：MUST / NEVER / ROLLBACK 三类不可协商规则，每条都要能被机器或人一眼判定。
4. **反例萃取**：踩过的坑、静默失败、边界失效——只写正例的产出视为未完成。
5. **产出生成**：SKILL.md（≤150 行正文）+ references/ + templates/ + 质量评分。

每步的提问清单与产出判据见 [references/distillation-steps.md](references/distillation-steps.md)。

---

## 3 去重（强制前置）

蒸馏前先给会话生成「主题指纹」（核心问题 / 解法 / 关键词），再拿指纹扫已有技能，输出决策：
**合并 / 新建 / 跳过**。不扫就新建，等于制造同义技能。

四步流程与相似度算法见 [references/skill-dedup.md](references/skill-dedup.md)；
示例、检查清单、模板见 [references/skill-dedup-examples.md](references/skill-dedup-examples.md)。

---

## 4 错误路径诊断（反复道歉）

命中任一信号即触发：同一问题道歉 ≥ 2 次 / "我搞错了"式无效道歉 / "重新尝试"但无具体改进。

四步：识别错误模式 → 根因归类（技能 / 提示词 / 工具 / 上下文）→ 生成反向提示词 → 子代理交互质量复盘。
模式清单与实战案例见 [references/apology-diagnosis.md](references/apology-diagnosis.md)；
诊断命中后照做的处置协议（失败分析 / 子代理产物验证 / Completion Report 校验 / 上下文纪律 / 工具选择）见
[references/apology-protocols.md](references/apology-protocols.md)。
两份完整演练（含生成的禁止项 / 铁律 / 门禁长什么样）见 [examples/](examples/)。

---

## 5 情绪中性化与温度值（输入端）

在 agent 接收用户发言**之前**把情绪载荷剥离，只留事实 / 意图 / 约束；同时把"严重程度"存成温度值——
完全中性化会丢掉"用户已反复纠正过这个领域"的信号，属必避免的反模式。

- 六步算法与 4 条铁律、5 条越权边界 → [references/emotional-neutralizer.md](references/emotional-neutralizer.md)
- 温度值公式、区间映射、数据采集点 → [references/temperature.md](references/temperature.md)
- 输出格式 → [templates/emotional-neutralize.md](templates/emotional-neutralize.md)
- 示例与失败处置矩阵 → [references/neutralize-examples.md](references/neutralize-examples.md)

**机器可执行**：`scripts/emotional-neutralize.py`（纯标准库）

```bash
python <skill_dir>/scripts/emotional-neutralize.py --self-test          # 断言自检
python <skill_dir>/scripts/emotional-neutralize.py temperature --emotion-score 0.75 --history-count 3 --days-ago 2
python <skill_dir>/scripts/emotional-neutralize.py verify --original "…" --neutral "…" --annotations a.json
```

`verify` 不通过时**不得**进入下游任务；stdout 是单行 JSON，失败退出码 1。

---

## 6 子代理交互质量

委派质量决定成败，主上下文不能盲信子代理的 Completion Report。四项检查：委派正确性、
白名单遵守、Completion Report 真实性（evidence / pass_count / 抽查）、失败处理
（连续失败 ≥ 2 换 agent，≥ 3 出阻塞报告）。详见 [references/distillation-steps.md](references/distillation-steps.md)。

---

## 7 交付前自检

逐项打 ✓/✗ 并算分：验证性 / 具体性 / 完整性 / 反例 / 可执行性。
得分 ≥ 4.0 才可交付，低于 4.0 返工。清单见 [references/quality-checklist.md](references/quality-checklist.md)，
算分与常见问题见 [references/quality-scoring.md](references/quality-scoring.md)。

---

## 8 禁止项

| 禁止 | 替代 |
|------|------|
| 空泛建议（"保持代码整洁"） | 具体规则（≤50 行）+ 验证方法 |
| 只有正例 | 正例 + 反例 + 边界条件 |
| "视情况而定" | 明确判定（X → Y，否则 → Z） |
| 缺失验证 | 脚本 / 检查项 |
| 隐藏失败 | 显式记录失败案例 + 根因 |
| 无边界（"适用于所有场景"） | 适用 + 不适用场景 |
| 替用户加戏 | 中性化只翻译，不替用户做决策 |
| 删掉原始话术 | 输出必含原始段，保留审计能力 |

---

## 9 触发与执行顺序

| 用户说 | 执行 |
|--------|------|
| 提炼技能 / 蒸馏会话 / 生成技能包 | 读会话 → 指纹去重(§3) → 五步(§2) → 自检(§7) |
| 诊断反复道歉 / 反向提示词 | 错误路径诊断(§4) → 处置协议 |
| 情绪中性化 / 温度值 / 减少内耗 | 脚本算温度 → 中性化 → `verify` 通过才继续 |

安装位置：`~/.agents/skills/session-distiller/`（本仓 `skills/session-distiller/` 逐字节一致）。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
