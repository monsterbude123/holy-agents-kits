# 情绪中性化：使用示例与失败处置

> 产出结构（必填/可选字段）见 [../templates/emotional-neutralize.md](../templates/emotional-neutralize.md)；
> 函数实现在 `scripts/emotional-neutralize.py`。

---

## §4 使用示例

### 示例 1:frustrated → 中性

**输入**:
```
用户: "为什么又错了?!你到底会不会?!"
同领域历史: 近 7 天内爆发 3 次(规则冲突已固化)
```

**中性化器输出(V2.2.1 含温度)**:
```markdown
## 情绪中性化输出

### 1. 原始话术(保留)
> "为什么又错了?!你到底会不会?!"

### 2. 中性化诉求(主用)
上一步结果与预期不符。请定位根因并修复。

### 3. 转化标注(透明化)
- 情绪类型: frustrated
- emotion_score: 0.75
- 剥离内容:
  - 3 个叹号
  - 1 个问号
  - 1 个攻击词: "又"
  - 1 个攻击词: "到底"
- 显式意图: 定位根因 + 修复
- 隐式意图: null
- 保留要素: "上一步" / "预期不符" / "根因" / "修复"

### 4. 【V2.2.1 新】温度值 + 关注度等级
- temperature: 1.875 (= 0.75 × 2.5 × 1.0)
- attention_level: 🟠 热区
- accumulation_factor: 2.5 (3 次历史爆发)
- history_weight: 1.0 (最近 1 周内)
- history_count: 3
- last_incident_days_ago: 2
- agent_self_check_required: true
- protocol_change_suggestion: null
- 解读: agent 必须先输出"本次诉求域相关规则冲突清单",再行动
```

### 示例 2:过度客气 → 中性

**输入**:
```
用户: "如果方便的话能不能麻烦你顺便帮我检查一下 X 是否存在 Y 风险,谢谢!"
```

**中性化器输出**:
```markdown
## 情绪中性化输出

### 1. 原始话术(保留)
> "如果方便的话能不能麻烦你顺便帮我检查一下 X 是否存在 Y 风险,谢谢!"

### 2. 中性化诉求(主用)
检查 X 是否存在 Y 风险。

### 3. 转化标注(透明化)
- 情绪类型: polite(过度客气)
- emotion_score: 0.6
- 剥离内容:
  - 3 个客气词: "如果方便的话" / "能不能" / "麻烦你"
  - 1 个语气词: "顺便"
  - 1 个感谢词: "谢谢"
  - 1 个叹号
- 显式意图: 检查 X 是否有 Y 风险
- 隐式意图: null
- 保留要素: "X" / "Y 风险" / "检查"
```

### 示例 3:已经中性 → 原样输出

**输入**:
```
用户: "执行 git status 并报告输出。"
```

**中性化器输出**:
```markdown
## 情绪中性化输出

### 1. 原始话术(保留)
> "执行 git status 并报告输出。"

### 2. 中性化诉求(主用)
执行 git status 并报告输出。

### 3. 转化标注(透明化)
- 情绪类型: neutral
- emotion_score: 0.05
- 剥离内容: []
- 显式意图: 执行 git status
- 隐式意图: null
- 保留要素: "git status" / "报告输出"
- 备注: 原话已中性,无修改。
```

---

### 示例 4(V2.2.1 新):🔥 红区 — 必须触发协议变更建议

**输入**:
```
用户: "我受够了,从来没用!每次都犯同样错误!"
同领域历史: 近 30 天内爆发 7 次(规则冲突已固化)
最近一次: 2 天前
```

**中性化器输出(V2.2.1 升级 — 含 🔥 红区协议变更建议)**:
```markdown
## 情绪中性化输出

### 1. 原始话术(保留)
> "我受够了,从来没用!每次都犯同样错误!"

### 2. 中性化诉求(主用)
当前方案失败,需新方案。请识别重复错误模式并输出协议变更建议。

### 3. 转化标注(透明化)
- 情绪类型: angry
- emotion_score: 0.95
- 剥离内容:
  - 1 个情绪宣泄: "我受够了"
  - 1 个攻击词: "从来没用"
  - 1 个叹号
  - 1 个重复攻击词: "每次都"
- 显式意图: 识别重复错误模式 + 输出协议变更建议
- 隐式意图: null
- 保留要素: "当前方案失败" / "新方案" / "重复错误模式" / "协议变更建议"

### 4. 【V2.2.1 新】温度值 + 关注度等级
- temperature: 6.65 (= 0.95 × 3.5 × 1.0)
- attention_level: 🔥 红区
- accumulation_factor: 3.5 (≥ 6 次历史爆发,规则冲突已固化)
- history_weight: 1.0 (最近 1 周内)
- history_count: 7
- last_incident_days_ago: 2
- agent_self_check_required: true
- protocol_change_suggestion: |
    ⚠️ 建议: 该诉求域规则冲突已固化(7 次/30 天)
    推荐方案: 将 X 规则从 A 处拆出 → 独立为新 skill
    理由: 已与 B 规则冲突 7 次,无法通过增量修复解决
    下一步: 请用户确认是否启动"规则拆分协议"
- 解读: 🛑 不直接修复,先汇报用户对齐"为什么该领域已成规则冲突黑盒"
```

---

## §8 调用示例(端到端)

### §8.1 完整调用流程

```python
# 输入
raw = "为什么又错了?!你到底会不会?!"
history_count = 3
last_incident_days_ago = 2

# Step 1: 检测情绪载荷
emotion_score = 0.75
emotion_type = "frustrated"

# Step 2: 提取事实
neutral = "上一步结果与预期不符。请定位根因并修复。"
stripped = ["3 个叹号", "1 个问号", "攻击词:又", "攻击词:到底"]

# Step 3: 计算温度值(V2.2.1 整合)
T, level, acc, hw = compute_temperature(
    emotion_score=emotion_score,
    history_count=history_count,
    last_incident_days_ago=last_incident_days_ago,
)
# → T=1.875, level='🟠 热区', acc=2.5, hw=1.0

# Step 4: 组装标注
annotations = {
    "emotion_type": emotion_type,
    "emotion_score": emotion_score,
    "stripped": stripped,
    "explicit_intent": "定位根因 + 修复",
    "implicit_intent": None,
    "preserved_entities": ["上一步", "预期不符", "根因", "修复"],
    "temperature": {
        "value": T,
        "attention_level": level,
        "accumulation_factor": acc,
        "history_weight": hw,
        "history_count": history_count,
        "last_incident_days_ago": last_incident_days_ago,
        "agent_self_check_required": T >= 1.0,
        "protocol_change_suggestion": None,
    },
}

# Step 5: 验证(必跑)
ok, msg = verify_neutralization(raw, neutral, annotations)
assert ok, f"中性化失败: {msg}"
# → ok=True, msg='OK'

# Step 6: 获取 agent 自检动作(若 T ≥ 1)
self_check_actions = get_agent_self_check_actions(T)
# → ['写入 self-improving-agent LEARNINGS',
#    '回查 §1 三大铁律,检查本次诉求域是否违反',
#    '输出本次诉求域相关规则冲突清单',
#    '追加 history_count + last_incident_days_ago 到标注']
```

### §8.2 失败示例(故意违反 V2.2.1 验证)

```python
# 反例:T: 缺 → 应被 §7.1 第 4 条拦截
bad_annotations = {
    "emotion_type": "frustrated",
    "emotion_score": 0.75,
    "stripped": ["3 个叹号"],
    # ❌ 缺 "temperature" 字段
}
ok, msg = verify_neutralization(raw, neutral, bad_annotations)
assert not ok
assert "严重程度信号丢失" in msg
# → ok=False, msg='V2.2.1 违反: 缺 temperature 字段(严重程度信号丢失)'

# 反例 2:T ≥ 6 但缺 protocol_change_suggestion
bad_annotations_2 = {
    "emotion_score": 0.95,
    "stripped": ["1 个情绪宣泄"],
    "temperature": {
        "value": 6.65,
        "attention_level": "🔥 红区",
        "history_count": 7,
        "agent_self_check_required": True,
        # ❌ 缺 "protocol_change_suggestion"
    },
}
ok, msg = verify_neutralization(raw, neutral, bad_annotations_2)
assert not ok
assert "protocol_change_suggestion" in msg
# → ok=False, msg='T ≥ 6.0 但缺 protocol_change_suggestion...'
```

---

## §9 验证失败处置矩阵

| 失败原因 | 严重程度 | 处置动作 |
|---------|---------|---------|
| 事实实体丢失 | 🔴 BLOCK | 重做中性化,不允许进入下游 |
| 情绪词残留 | 🔴 BLOCK | 重做中性化 |
| 缺 stripped 字段 | 🟡 WARN | 补字段后重跑 |
| 缺 temperature 字段(V2.2.1) | 🔴 BLOCK | 补温度计算后重跑 |
| T ≥ 1 但缺 agent_self_check_required | 🔴 BLOCK | 补字段 + 触发自检 |
| T ≥ 3 但缺 history_count | 🟠 WARN | 补字段(查项目内 .learnings/) |
| T ≥ 6 但缺 protocol_change_suggestion | 🔴 BLOCK | 补建议 + 汇报用户 |
| T 与推导值偏差 > 5% | 🟠 WARN | 复核 emotion_score / history_count |
| attention_level 与 T 不一致 | 🟠 WARN | 调表或重算 T |

**所有 🔴 BLOCK 项必须修复,不得绕过。**

---

> **记住**:中性化不是"消除用户情绪",而是"不让情绪占用 agent 算力"。原始话术必须保留,否则用户失去审计能力。
>
> **V2.2.1 加**:温度值必保留,agent 必跑 §7 三个函数,违反 §9 BLOCK 项必须修复,不得绕过。
