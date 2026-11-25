# 情绪中性化器(Emotional Neutralizer)— V2.2.1 升级

> **V2.2.1 重大修正(用户实战反馈)**: 完全中性化会让 agent 丢失"问题严重程度信号"。温度值(temperature)是**历史失败累积指标**,高温区域 = 用户疲于纠正 = agent 重点自审视区。
>
> **职责**:在 agent 接收用户发言**之前**,把"情绪噪声"剥离,但保留"严重程度信号"(温度值),让 agent 既不内耗在情绪上、又知道哪些地方历史踩坑多。
>
> **与 `apology-diagnosis.md` 的边界(必读)**:
> - 本协议 = **输入端预处理**(用户发来就剥) → 防患于未然
> - `apology-diagnosis.md` = **输出端诊断**(agent 反复道歉时根因分析) → 亡羊补牢
> - 两者正交,不可合并(Skeptic a/b/c/d/e 分类:本协议 = `b 伪重叠` 表面相似,实质一前一后)
>
> **与 SKILL.md §2.6 / §2.6.1 的对应**: SKILL.md 正文只留指针(定位 + 六步一句话 + 与 §2.5 的边界),
> 六步中性化算法 = 本文 §3,4 条铁律 = 本文 §2,映射表 = 本文 §4,5 条边界 = 本文 §5,
> 温度值(Temperature)公式与关注度映射 = 本文 §2.5。冲突时以本文为准。

---

## §1 为什么需要情绪中性化

### 1.1 内耗来源(基于实战)

```
用户原话(情绪化):
  "为什么又错了?!你到底会不会?!"
       ↓
agent 接收后:
  ├─ 把问号当质疑 → 触发防御性道歉
  ├─ 把感叹号当攻击 → 进入"保命模式"
  ├─ 真实诉求被情绪淹没 → 答非所问
  └─ token 内耗在"安抚用户"而非"解决问题"

用户原话(中性化):
  "上一步结果与预期不符,请定位根因并修复。"
       ↓
agent 接收后:
  ├─ 明确诉求 = 定位根因
  ├─ 明确动作 = 修复
  └─ 直接进入任务执行,零防御开销
```

### 1.2 核心收益(可验证)

| 指标 | 中性化前 | 中性化后 | 验证方法 |
|------|---------|---------|---------|
| agent 道歉次数 | ≥ 2 次 | 0 次 | grep "抱歉\|对不起\|我搞错了" |
| agent 误判率 | 高(把情绪当事实) | 低(只接收事实) | LLM-as-judge |
| 用户真实诉求识别率 | ~50% | ≥ 90% | 蒸馏前后 diff |
| token 内耗 | 防御性回复占 ~30% | < 5% | token 计数 |
| **严重程度信号保留率(V2.2.1 新)** | **0%(完全剥光)** | **100%(温度值)** | **see §2.5** |

---

## §2.5 温度值(Temperature)

> 完整协议（公式、区间映射、为什么必保留、数据采集点、与 emotion_score 的区别）已抽到
> [temperature.md](temperature.md)。算温度或判「严重程度信号是否丢失」时读它。
> 机器实现：`scripts/emotional-neutralize.py`（`compute_temperature` / `get_agent_self_check_actions`）。

## §2 中性化铁律(4 条,不可协商)

```
1. 分离事实与情绪
   - ❌ "你又错了!"(事实 + 情绪混合)
   - ✅ "上一步结果与预期不符。"(仅事实)

2. 保留意图,剥离修饰
   - ❌ "能不能麻烦你顺便帮我看看..."(客气话 + 模糊诉求)
   - ✅ "检查 X 是否存在 Y 风险。"(明确动作 + 对象)

3. 显式约束优先于隐式期望
   - ❌ "你应该知道我要什么"(隐式期望)
   - ✅ "输出 JSON schema: {a, b, c}"(显式约束)

4. 拒绝替用户加戏
   - ❌ "听起来你很生气,要不要..."(替用户情绪脑补)
   - ✅ 不加戏,只翻译
```

---

## §3 中性化算法(6 步 + 温度分支)

```
Step 1 — 检测情绪载荷
  ├─ 扫描关键词: 叹号/问号密度、感叹词("啊/呀/哦")、攻击词("又/到底/再/总是")
  ├─ 扫描语气词: "麻烦/请/能不能/万一"
  └─ 输出: emotion_score (0-1)  +  emotion_type

Step 1.5 — 【V2.2.1 新】计算温度值 T
  ├─ 查 self-improving-agent .learnings/ERRORS.md 同 tag 爆发次数 → accumulation_factor
  ├─ 查最近一次爆发时间戳 → 计算 history_weight
  ├─ T = emotion_score × accumulation_factor × history_weight
  └─ 输出: temperature (0-10+) + attention_level (🟢/🟡/🟠/🔴/🔥/🚨)

Step 2 — 提取事实
  ├─ 命名实体(对象/路径/命令/模块)
  ├─ 动作动词(做/查/改/删/跑/读/写)
  ├─ 期望结果(正确/失败/特定状态)
  └─ 约束条件(格式/时间/工具)

Step 3 — 提取意图
  ├─ 显式意图(动词直陈)
  └─ 隐式意图(从语气推断,但保留原始标注)

Step 4 — 翻译为中性句
  ├─ 主语: 明确化(从"你"转"agent"或"系统")
  ├─ 谓语: 保留事实动词
  ├─ 宾语: 保留事实对象
  └─ 修饰语: 删除情绪形容词/语气词

Step 5 — 标注转化痕迹(含温度)
  ├─ 原始情绪类型: [frustrated/anxious/neutral/curious/...]
  ├─ 剥离内容: "x2 叹号, x1 攻击词"
  ├─ 保留意图: {显式: ..., 隐式: ...}
  ├─ 【V2.2.1 新】temperature: {T 值} + attention_level + history_count
  └─ 【V2.2.1 新】if T ≥ 1.0 → 自动追加 agent_self_check 触发标记

Step 6 — 输出四段式(V2.2.1 由三段升级为四段)
  ├─ 原始: 用户原话(保留)
  ├─ 中性: 翻译后中性句(主用)
  ├─ 标注: 转化痕迹(供后续追溯)
  └─ 【V2.2.1 新】温度: T + 关注度等级 + 历史爆发次数 + agent 自检动作指引
```

---

## §4 实战映射表(高频情绪 → 中性表达 + 温度值)

| 情绪类型 | 用户原话 | 中性化输出 | 剥离了什么 | **温度值(V2.2.1 新)** |
|---------|---------|-----------|-----------|---------------------|
| **frustrated(挫败)** | "为什么又错了?!" | "上一步结果与预期不符,请定位根因。" | 2 叹号 + 1 攻击词 | T=0.4~2.0(取决于历史) |
| **frustrated** | "到底会不会啊?" | "检查实现是否符合 spec。" | 1 问号 + 1 攻击词 | T=0.4~2.0 |
| **anxious(焦虑)** | "求求你快一点" | "请在 N 分钟内完成。" | 1 哀求词 + 模糊时间 | T=0.6~2.5 |
| **anxious** | "万一又崩了怎么办?" | "失败时执行回滚 + 通知。" | 1 假设词 + 1 情绪 | T=0.6~2.5 |
| **impatient(急躁)** | "快点快点快点" | "立即执行。" | 重复词 + 急躁感 | T=0.5~2.0 |
| **doubtful(质疑)** | "你确定这样行?" | "请说明决策依据与失败回退方案。" | 1 质疑词 | T=0.4~1.8 |
| **polite(过度客气)** | "如果方便的话能不能..." | "执行 X。" | 3 客气词 + 模糊化 | T=0.2~1.5 |
| **angry(愤怒)** | "我受够了,从来没用!" | "当前方案失败,需新方案。" | 1 情绪宣泄 | **T=3.0~8.0(几乎必历史累积)** |
| **confused(困惑)** | "我不知道到底怎么回事..." | "请汇总当前状态 + 卡点。" | 1 情绪铺垫 | T=0.5~2.5 |
| **neutral(中性)** | "执行 X" | "执行 X"(原样输出) | 0 剥离 | T=0.0~0.3 |

**温度值变化规律**:
- **单次激烈 + 首次踩坑**(T≈0.4~1.0):🟡 提示"待观察"
- **多次激烈 + 同领域反复**(T≈1.0~3.0):🟠 触发"规则审视"
- **反复愤怒 + 历史累积**(T≈3.0~8.0):🔴🔥 触发"根因诊断"或"协议变更建议"

---

## §5 边界(必读 — 防越权)

```
MUST NOT:
  1. ❌ 删除用户的"个人信息"(名字/项目名/路径)
  2. ❌ 改变用户的事实主张(就算听起来错)
  3. ❌ 把用户的"不要做 X"翻译成"做 X"(反转语义)
  4. ❌ 替用户做决策("听起来你要的是 Y")
  5. ❌ 输出不带原始话术(否则用户失去审计能力)
  6. 【V2.2.1 新】❌ 剥光情绪后**丢失温度值**(完全中性化 = 丢失严重程度 = 高优先级诉求被当成普通诉求)

MUST:
  1. ✅ 保留原始话术(供溯源)
  2. ✅ 标注剥离了什么(透明化)
  3. ✅ 中性句必须保留原始诉求(不可漏掉关键信息)
  4. ✅ 用户明确说"保留原话"时 → 跳过中性化,只标注情绪
  5. ✅ 跨文化保留:保留用户的"礼貌词"(中/日/韩),不强行删除
  6. 【V2.2.1 新】✅ T ≥ 1.0 时必须输出"温度 + 关注度等级"四段式,触发 agent 自检动作
  7. 【V2.2.1 新】✅ T ≥ 3.0 时必须在标注中追加"该诉求域历史爆发 N 次"的显式计数
  8. 【V2.2.1 新】✅ T ≥ 6.0 时必须触发"协议变更建议"(不直接修复,先汇报用户)
```

---

## §6 与其他协议的协作关系

| 上游协议 | 提供什么 | 中性化器消费什么 |
|---------|---------|----------------|
| `apology-diagnosis.md` | 反复道歉识别 | 触发"输入是否需中性化"自检 |
| `distillation-methodology.md` | 会话事实提取 | 中性化后送入蒸馏 |
| `project-rule-skill §7` signal-detect | 用户信号检测 | signal-detect 命中后,中性化器**在委派子代理前**先跑 |

| 下游协议 | 接收什么 | 用途 |
|---------|---------|------|
| 主 agent 主循环 | 中性化后的诉求 | 直接执行,无情绪负载 |
| self-improving-agent | 情绪载荷统计 | 沉淀"高频情绪词"到 `.learnings/ERRORS.md` |
| session-distiller 主流程 | 中性化三段式输出 | 蒸馏时只取"中性"段,保留"原始"段做情绪治理分析 |

---

## §7 反模式(踩坑清单)

| # | 反模式 | 后果 | 修法 |
|---|--------|------|------|
| 1 | **【V2.2.1 升级】丢失严重程度信号**(完全中性化,无温度值) | agent 把高优先级诉求当普通诉求执行,用户疲于纠正 | **强制四段式输出 + 温度值计算**(§2.5) |
| 2 | **【V2.2 旧 #1】过度中性化**(把专业术语也剥掉) | 用户专业诉求被磨平 | 只剥情绪词,不剥专业术语 |
| 3 | **替用户道歉**(中性化时加 "我理解...") | 重复 apology-diagnosis 的失败模式 | 中性化器只翻译,不道歉 |
| 4 | **强制中性化所有输入** | 用户明确要"原汁原味"也被剥 | 加 `preserve_raw: true` flag |
| 5 | **忘记保留原始话术** | 用户无法审计是否漏翻 | 强制四段式输出(原始 + 中性 + 标注 + 温度) |
| 6 | **把中性化当 LLM prompt 不当算法** | 不可验证 + 不可重现 | 中性化必须是 6 步确定性算法 |
| 7 | **【V2.2.1 新】高温区不汇报用户**(T ≥ 6 直接行动) | 用户失去对齐机会,规则冲突固化 | T ≥ 6 强制"协议变更建议"先行 |
| 8 | **【V2.2.1 新】温度值拍脑袋**(不查历史 .learnings/) | 温度值失真,触发错误的关注度等级 | 必须查 self-improving-agent .learnings/ 同 tag |

---

## §8 验证方法(机器可校验)

```python
# 伪代码 — 真实实现见 scripts/emotional-neutralize.py
def verify_neutralization(original: str, neutral: str, annotations: dict) -> bool:
    # 1. 中性句必须保留原诉求的所有事实实体
    original_entities = extract_entities(original)
    neutral_entities = extract_entities(neutral)
    if not original_entities.issubset(neutral_entities):
        return False  # ❌ 漏翻

    # 2. 中性句不可包含情绪词
    emotion_words = {"抱歉", "对不起", "!", "又", "到底", "求求"}
    if any(w in neutral for w in emotion_words):
        return False  # ❌ 没剥干净

    # 3. 必须保留原始话术
    # (在调用方检查,中性化器返回 dict 含 'original' 字段)

    # 4. 标注必须列出剥离了什么
    if not annotations.get("stripped"):
        return False  # ❌ 没标注

    # 【V2.2.1 新】5. 必须保留温度值(防丢失严重程度)
    if "temperature" not in annotations:
        return False  # ❌ V2.2.1 违反:丢失温度值

    # 【V2.2.1 新】6. T ≥ 1.0 时必须含 attention_level
    T = annotations["temperature"]
    if T >= 1.0 and "attention_level" not in annotations:
        return False  # ❌ T ≥ 1 但缺关注度等级

    # 【V2.2.1 新】7. T ≥ 3.0 时必须含 history_count
    if T >= 3.0 and not annotations.get("history_count"):
        return False  # ❌ T ≥ 3 但缺历史计数

    # 【V2.2.1 新】8. T ≥ 6.0 时必须含 protocol_change_suggestion
    if T >= 6.0 and not annotations.get("protocol_change_suggestion"):
        return False  # ❌ T ≥ 6 但缺协议变更建议

    return True  # ✅
```

### §8.1 温度值校验伪代码

```python
def verify_temperature(emotion_score: float, history_count: int,
                       last_incident_days_ago: int) -> Tuple[float, str]:
    """计算温度值并返回关注度等级"""
    # accumulation_factor 查表
    acc_factor = {0: 1.0, 1: 1.5, 2: 1.5, 3: 2.5, 4: 2.5,
                  5: 2.5, 6: 3.5}.get(history_count, 3.5)

    # history_weight 时间衰减
    if last_incident_days_ago <= 7:
        hw = 1.0
    elif last_incident_days_ago <= 30:
        hw = 0.8
    elif last_incident_days_ago <= 90:
        hw = 0.5
    else:
        hw = 0.3

    T = emotion_score * acc_factor * hw

    # 关注度等级
    if T < 0.3: level = "🟢 冷区"
    elif T < 1.0: level = "🟡 微温"
    elif T < 3.0: level = "🟠 热区"
    elif T < 6.0: level = "🔴 灼热"
    elif T < 10.0: level = "🔥 红区"
    else: level = "🚨 危机"

    return T, level
```

---

## §9 一句话总结

**情绪中性化 V2.2.1 = 输入端预处理,把"情绪噪声"剥离,但保留"严重程度信号"(温度值 T = 历史失败累积指数)。让 agent 既不内耗在情绪上、又知道哪些地方历史踩坑多,高温区必触发"协议变更建议"。**

与 `apology-diagnosis.md`(输出端诊断)正交,合并 = 错误合并(Skeptic b 类)。
