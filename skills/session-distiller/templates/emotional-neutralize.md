# 情绪中性化产出模板

> 使用此模板生成标准化的"情绪→中性"**四段式**输出(V2.2.1 新增第四段:温度)。

---

## §1 模板结构

```markdown
## 情绪中性化输出

### 1. 原始话术(保留)
> {user 原话,完整保留,不加任何修改}

### 2. 中性化诉求(主用)
{经过 6 步算法后的中性句,不含情绪词/语气词/攻击词}

### 3. 转化标注(透明化)
- 情绪类型: {frustrated/anxious/impatient/doubtful/angry/confused/neutral}
- emotion_score: {0-1}
- 剥离内容:
  - {情绪词/语气词 1}
  - {情绪词/语气词 2}
- 显式意图: {原话直陈}
- 隐式意图: {从语气推断,标注}
- 保留要素: {用户原话中的关键事实/路径/命令}

### 4. 【V2.2.1 新】温度值 + 关注度等级
- temperature: {T 值,0-10+}
- attention_level: {🟢冷区 / 🟡微温 / 🟠热区 / 🔴灼热 / 🔥红区 / 🚨危机}
- accumulation_factor: {1.0/1.5/2.5/3.5 — 取决于历史爆发次数}
- history_weight: {1.0/0.8/0.5/0.3 — 取决于最近爆发距今天数}
- history_count: {同诉求域历史爆发次数}
- last_incident_days_ago: {最近一次爆发距今 N 天}
- agent_self_check_required: {true / false}
  - true 时:agent 必须先输出"本次诉求域相关规则冲突清单"
- protocol_change_suggestion: {T ≥ 6.0 必填,否则 null}
  - 例: "建议将 X 规则从 A 处拆出,因为已与 B 规则冲突 5 次"
```

---

## §2 必填字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| 原始话术 | str | 用户原话,逐字符保留 | "为什么又错了?!" |
| 中性化诉求 | str | 6 步算法输出,不含情绪词 | "上一步结果与预期不符,请定位根因。" |
| 情绪类型 | enum | frustrated/anxious/impatient/doubtful/angry/confused/neutral | frustrated |
| 剥离内容 | list[str] | 具体列出剥了哪些词 | ["2 叹号", "1 攻击词:又"] |
| 显式意图 | str | 原话动词直陈 | "定位根因" |
| 隐式意图 | str\|null | 语气推断(可选) | null 或 "希望快速修复" |
| **temperature(V2.2.1 新必填)** | float | 历史失败累积指数 0-10+ | 2.5 |
| **attention_level(V2.2.1 新必填)** | enum | 🟢冷区 / 🟡微温 / 🟠热区 / 🔴灼热 / 🔥红区 / 🚨危机 | 🟠 热区 |
| **history_count(V2.2.1 新必填)** | int | 同诉求域历史爆发次数 | 3 |
| **last_incident_days_ago(V2.2.1 新必填)** | int | 最近一次爆发距今 N 天 | 7 |
| **agent_self_check_required(V2.2.1 新必填)** | bool | T ≥ 1.0 时必 true | true |
| **protocol_change_suggestion(V2.2.1 新必填,T ≥ 6)** | str\|null | T ≥ 6.0 必填,否则 null | null |

---

## §3 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| emotion_score | float(0-1) | 情绪载荷密度,0=中性,1=极度情绪化 |
| preserve_raw | bool | 用户要求保留原话时=true,跳过中性化 |
| language | str | "zh-CN" / "en-US" / "ja-JP" — 决定礼貌词保留规则 |
| accumulation_factor | float | 1.0/1.5/2.5/3.5 — 取决于历史爆发次数 |
| history_weight | float | 1.0/0.8/0.5/0.3 — 取决于时间衰减 |

---

## §4 使用示例

> 五种场景（纯情绪 / 带事实 / 高温 / 英文 / 多轮累积）的完整输出示例已抽到
> [../references/neutralize-examples.md](../references/neutralize-examples.md)。照抄格式时读它。

## §5 完整字段示例

```yaml
emotional_neutralization:
  input:
    raw: "为什么又错了?!你到底会不会?!"
    source: "user_message"
    timestamp: "2026-08-25T10:30:00Z"
    language: "zh-CN"
  output:
    raw_preserved: "为什么又错了?!你到底会不会?!"
    neutral: "上一步结果与预期不符。请定位根因并修复。"
    annotations:
      emotion_type: "frustrated"
      emotion_score: 0.75
      stripped:
        - "3 个叹号 (!)"
        - "1 个问号 (?)"
        - "攻击词: '又'"
        - "攻击词: '到底'"
      explicit_intent: "定位根因 + 修复"
      implicit_intent: null
      preserved_entities:
        - "上一步"
        - "预期不符"
        - "根因"
        - "修复"
    # 【V2.2.1 新】温度值 + 关注度
    temperature:
      value: 1.875                    # 0.75 × 2.5 × 1.0
      attention_level: "🟠 热区"
      accumulation_factor: 2.5        # 3 次历史爆发
      history_weight: 1.0             # 最近 1 周内
      history_count: 3
      last_incident_days_ago: 2
      agent_self_check_required: true
      protocol_change_suggestion: null
  metadata:
    neutralizer_version: "V2.2.1"
    algorithm_steps: 6
    verified: true
```

---

## §6 填写指南

### 6.1 何时触发

```
MUST 触发(输入端预处理):
  - 检测到 emotion_score ≥ 0.5
  - 检测到攻击词(又/到底/再/总是)
  - 检测到 2+ 个叹号或问号

SHOULD 触发:
  - 检测到客气词密度 ≥ 3
  - 检测到情绪铺垫("我受够了"/"求求你")

MAY 触发:
  - 任何不确定是否含情绪的输入(默认剥,标注兜底)

MUST NOT 触发:
  - 用户明确说 "preserve_raw: true"
  - 已经是中性句(emotion_score < 0.1)
```

### 6.2 双指标判定参考(emotion_score + temperature)

| emotion_score | 含义 | temperature 计算 |
 | 0.0-0.1 | 纯中性 | T ≈ 0.0~0.3 → 🟢 冷区 |
 | 0.1-0.3 | 轻微情绪(礼貌词) | T ≈ 0.2~1.0 → 🟡 微温 |
 | 0.3-0.5 | 中度情绪 | T ≈ 0.4~2.5 → 🟡~🟠 |
 | 0.5-0.8 | 重度情绪 | T ≈ 0.75~4.0 → 🟠~🔴 |
 | 0.8-1.0 | 极度情绪 | T ≈ 1.0~10.0 → 🟠~🔥 |

**重要**: emotion_score 单看不可决定关注度,必须乘以 `accumulation_factor × history_weight` 得到 T 后,才能映射到 agent 自检动作。

### 6.3 多语言注意

```
中文: 保留 "麻烦/请" 不算情绪词(文化礼貌)
英文: 保留 "please" 不算情绪词
日文: 保留 "お願いします" 不算情绪词
韩文: 保留 "부탁합니다" 不算情绪词

跨语言攻击词(必剥):
  - 中文: 又 / 到底 / 再 / 总是 / 从来
  - 英文: again / always / never / why
  - 日文: また / いつも / なぜ
```

---

## §7 验证（机器可执行）

> 三个函数（verify_neutralization / compute_temperature / get_agent_self_check_actions）的真实实现在
> `scripts/emotional-neutralize.py`，本文不再复制伪代码。`--self-test` 跑断言；
> `verify --original ... --neutral ... --annotations a.json` 校验产出（stdout 单行 JSON）。
> 算法说明见 [../references/emotional-neutralizer.md](../references/emotional-neutralizer.md) 与
> [../references/temperature.md](../references/temperature.md)。

## §8 调用示例与失败处置

> 端到端调用、反例、失败处置矩阵见
> [../references/neutralize-examples.md](../references/neutralize-examples.md)。组装标注前读它。
