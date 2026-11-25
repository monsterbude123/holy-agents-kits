# 去重实战示例与检查清单

> 四、实战示例 / 五、检查清单 / 六、常见问题 / 七、模板与工具。
> 流程与算法见 [skill-dedup.md](skill-dedup.md)。

---


## 四、实战示例

### 示例一: 高度相似 → 合并

```
已有技能: apology-discipline
  - name: "apology-discipline"
  - description: "反复道歉治理 — 失败计数 + 切换 agent + 阻塞报告"
  - triggers: ["反复道歉", "道歉", "失败计数"]

新会话提炼: agent-apology-fix
  - 核心主题: 反复道歉
  - 触发词: 反复道歉、道歉、agent 道歉
  - 解决的问题: Agent 反复道歉但无效
  - 铁律: 连续失败 ≥ 2 次 → 切换 agent

相似度计算:
  - 核心主题: 100% (都是"反复道歉")
  - 触发词: 66% (2/3 重叠)
  - 解决的问题: 100% (相同问题)
  - 方法论: 80% (铁律相似)

综合相似度: 0.4×1.0 + 0.2×0.66 + 0.3×1.0 + 0.1×0.8 = 88.4%

判定: 高度相似 → 合并

增量内容:
  - 新铁律: "道歉必须配具体改进方案"
  - 新反例: "2026-05-16 搜索框盲目重试"

合并执行:
  - Edit apology-discipline/SKILL.md
  - 补充 §N 新铁律
  - Edit apology-discipline/references/traps.md
  - 补充新反例
```

### 示例二: 中度相似 → 评估后决策

```
已有技能: code-review-discipline
  - name: "code-review-discipline"
  - description: "代码审查铁律 — 影响面评估 + 漂移检测 + 完成审计"
  - triggers: ["代码审查", "review", "影响面"]

新会话提炼: code-merge-gate
  - 核心主题: 代码合并门禁
  - 触发词: 代码合并、merge、门禁
  - 解决的问题: 防止不合格代码合并
  - 铁律: 无测试禁止合并

相似度计算:
  - 核心主题: 40% (代码审查 vs 代码合并)
  - 触发词: 20% (1/5 重叠)
  - 解决的问题: 50% (代码质量,但角度不同)
  - 方法论: 30% (部分铁律相似)

综合相似度: 0.4×0.4 + 0.2×0.2 + 0.3×0.5 + 0.1×0.3 = 38%

判定: 低相似 → 可新建

决策: 新建独立技能 "code-merge-gate"
```

### 示例三: 无增量价值 → 跳过

```
已有技能: test-blocking-resolver
  - name: "test-blocking-resolver"
  - description: "测试阻塞解决 — 分区定位 + 坏测试识别"
  - 铁律: 分区测试 + 连续失败阻塞报告

新会话提炼: test-partition-runner
  - 核心主题: 测试分区运行
  - 解决的问题: 测试阻塞定位
  - 铁律: 分区测试 + 连续失败阻塞报告

相似度: 95%

增量检查:
  - 新铁律? → 无
  - 新反例? → 无
  - 新方法论? → 无

判定: 无增量价值 → 跳过

决策: 告知用户"已有相似技能: test-blocking-resolver,无增量价值,跳过蒸馏"
```

---

## 五、去重检查清单

蒸馏会话后,强制执行以下检查:

```
[ ] Step 1 — 扫描已有技能
    ├─ 扫描 .trae/skills/
    ├─ 扫描 skill-markets/
    └─ 提取每个技能的核心特征

[ ] Step 2 — 计算相似度
    ├─ 核心主题相似度
    ├─ 触发词相似度
    ├─ 问题相似度
    └─ 方法论相似度

[ ] Step 3 — 判定决策
    ├─ 综合相似度 ≥ 80% → 合并
    ├─ 综合相似度 50%-80% → 评估
    └─ 综合相似度 < 50% → 新建

[ ] Step 4 — 执行决策
    ├─ 合并 → Edit 已有技能
    ├─ 新建 → Write 新技能
    └─ 跳过 → 告知用户

[ ] Step 5 — 输出去重报告
    └─ 包含在 Completion Report 中
```

---

## 六、常见问题

### Q1: 如果两个技能都有价值,但角度不同怎么办?

```
答: 判定为"中度相似" → 独立维护,但在各自的 SKILL.md 中交叉引用。

示例:
  - code-review-discipline (审查铁律)
  - code-merge-gate (合并门禁)

在 code-merge-gate 中补充:
  "前置条件: 参考 code-review-discipline 的审查铁律"
```

### Q2: 如何判断"增量价值"是否真的有价值?

```
答: 增量价值必须满足:
  1. 具体可执行 (不是空泛建议)
  2. 有反例支撑 (有失败案例)
  3. 未在已有技能中出现 (真增量)

否则视为"伪增量" → 跳过
```

### Q3: 合并后版本号如何更新?

```
答: 小版本号升级:
  - 补充铁律: x.X.0 → x.X+1.0
  - 补充反例: x.X.Y → x.X.Y+1
  - 补充方法论: x.X.0 → x.X+1.0

示例:
  - apology-discipline V2.0.0 → 补充新铁律 → V2.1.0
```

---

## 七、模板与工具

### 去重检查脚本 (伪代码)

```python
def check_skill_duplication(new_skill, project_skills_dir):
    """去重检查主流程"""

    # Step 1: 扫描已有技能
    existing_skills = scan_existing_skills(project_skills_dir)

    # Step 2: 计算相似度
    for skill in existing_skills:
        similarity = calculate_similarity(new_skill, skill)

        if similarity >= 0.8:
            # Step 3: 判定为高度相似
            increment_value = check_increment_value(new_skill, skill)

            if increment_value:
                # Step 4: 合并
                merge_skills(skill, new_skill)
                return "merged", skill.name
            else:
                # Step 5: 跳过
                return "skipped", skill.name

    # Step 6: 无相似技能 → 新建
    return "created", new_skill.name

def calculate_similarity(skill1, skill2):
    """计算四维相似度"""
    theme_sim = calculate_theme_similarity(skill1, skill2)
    trigger_sim = calculate_trigger_similarity(skill1, skill2)
    problem_sim = calculate_problem_similarity(skill1, skill2)
    method_sim = calculate_method_similarity(skill1, skill2)

    return (theme_sim * 0.4 + trigger_sim * 0.2 +
            problem_sim * 0.3 + method_sim * 0.1)
```

---
