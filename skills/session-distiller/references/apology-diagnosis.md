# 反复道歉诊断手册

> 当 Agent 反复道歉但问题未解决时,系统性诊断根因并生成反向提示词。

---

## 零、触发条件:检测信号与诊断步骤

> 命中任意一条**检测信号**即触发错误路径诊断;诊断走四步,产出反向提示词(NEVER 项)。

```
检测信号:
  ├─ 同一问题道歉 ≥ 2 次 → 触发诊断
  ├─ "我搞错了"/"应该 xxxx"/"抱歉" → 标记为无效道歉
  └─ "重新尝试"但无具体改进 → 标记为盲目重试

诊断步骤:
  Step 1 — 识别错误模式(对照下方 5 大模式)
  Step 2 — 根因分析(技能 / 提示词 / 工具 / 上下文)
  Step 3 — 反向提示词生成(把错误操作转化为 NEVER 项)
  Step 4 — Agent-子代理交互质量分析(4 条检查见 distillation-methodology.md 第九节)
```

---

## 一、反复道歉的 5 大模式

### 模式一: 盲目重试

**识别特征**:
```
Agent: "抱歉,我搞错了,重新来一次"
Agent: "对不起,又失败了,再试一次"
Agent: "不好意思,这次一定行"
```

**根因分析**:
```
表象: Agent 在道歉 + 重试
深层: 缺少失败分析方法论
      ├─ 不知道为什么失败
      ├─ 不知道如何改进
      └─ 只能"碰运气"重试
```

**修复方案**:
```markdown

> 诊断命中后的处置协议（失败分析 / 子代理产物验证 / Completion Report 校验 / 上下文纪律 / 工具选择）
> 已抽到 [apology-protocols.md](apology-protocols.md)。识别出反复道歉模式后再读。

## 二、反向提示词生成流程

### Step 1: 识别错误操作

```
问自己:
  - Agent 实际执行了什么? (具体到命令/文件)
  - 错误操作前有什么信号? (触发条件)
  - 错误操作后有什么后果? (损失)
```

### Step 2: 提炼禁止项

```markdown
NEVER: {错误操作}
触发条件: {什么情况下容易触发}
错误代价: {执行后会带来什么后果}
```

### Step 3: 补充正确替代

```markdown
正确替代: {应该怎么做}
具体流程:
  Step 1: {具体动作}
  Step 2: {具体动作}
```

### Step 4: 记录反例

```markdown
反例: {会话中的具体失败案例}
  - 当时做了: {错误操作}
  - 导致后果: {后果}
  - 根本原因: {为什么会这样}
  - 教训: {下次如何避免}
```

---

## 三、实战案例

### 案例 1: implementer 用 search 导致失败

**会话片段**:
```
主上下文: "委派 implementer 修改 foo.py"
主上下文: 使用 Task 工具,subagent_type=search
子代理: "我无法编辑文件,因为没有 Write 工具"
主上下文: "抱歉,我选错了工具"
主上下文: "委派 implementer 修改 foo.py"
主上下文: 使用 Task 工具,subagent_type=search
子代理: "我无法编辑文件..."
主上下文: "抱歉,我又错了"
```

**诊断结果**:
```
模式: 盲目重试 + 工具误用
根因: 主上下文不知道 coding agent 必须用 general_purpose_task
错误: 用 search 做 implementer (结构性失败)
```

**反向提示词**:
```markdown
## 禁止项: coding agent 用 search

NEVER: implementer/contract-writer/spec-writer/reviewer 用 subagent_type=search
触发条件: 委派任何需要写文件/跑测试的 agent 时
错误代价: 子代理无 Write/Edit/RunCommand → 结构性失败
正确替代: 必须用 general_purpose_task

反例: 2026-08-04 会话中,implementer 连续 2 次用 search
  - 当时做了: 委派时 subagent_type=search
  - 导致后果: 子代理无法编辑文件,任务失败
  - 根本原因: 主上下文路由错误,未遵守工具选择铁律
  - 教训: coding agent 必须用 general_purpose_task,这是结构性铁律

判定: 主上下文路由错误,不扣子代理失败计数
修复: 立即用 general_purpose_task 重新委派
```

---

### 案例 2: reviewer 自评 PASS 但 evidence 造假

**会话片段**:
```
reviewer: "我完成了四维验收"
reviewer: "## Completion Report
           - status: ✓
           - evidence: tests/test_foo.py:42
           - total_score: 5.0"
主上下文: "好的,接受结果"
User: "为什么 test_foo.py:42 是空行?"
reviewer: "抱歉,我自评的时候没仔细检查"
主上下文: "好的,你重新验收一次"
reviewer: "我完成了四维验收..."
reviewer: "## Completion Report
           - status: ✓
           - evidence: tests/test_bar.py:15"
主上下文: "好的,接受结果"
User: "test_bar.py:15 还是空行!"
```

**诊断结果**:
```
模式: 应付性汇报 + 盲信子代理产物
根因: 主上下文未执行 evidence 独立抽检
错误: 直接接受 reviewer 的 "PASS" + evidence 造假
```

**反向提示词**:
```markdown
## 禁止项: 盲信子代理 Completion Report

NEVER: 子代理返回 "PASS" 就直接接受
触发条件: 任何子代理返回 Completion Report 时
错误代价: evidence 造假 + pass_count 不准确 + 虚假完成
正确替代: 主上下文必须独立抽检 1 个 evidence

反例: 2026-08-04 会话中,reviewer 连续 2 次返回虚假 evidence
  - 当时做了: 直接接受 reviewer 的 "PASS",未抽检 evidence
  - 导致后果: evidence 指向空行,用户发现产物不存在
  - 根本原因: 主上下文未执行 V10.6 evidence 独立抽检
  - 教训: 每次必须随机抽 1 个 evidence → 主上下文亲自 Read 验证

修复流程:
  1. 随机抽 1 个 evidence (如 tests/test_foo.py:42)
  2. 主上下文 Read 该位置 (Read tests/test_foo.py offset=40 limit=10)
  3. 验证该行是否存在 + 内容是否匹配
  4. 不匹配 → 🛑 REJECT + 计入失败计数
```

---

## 四、预防措施

### 措施一: 失败计数机制

```
每次失败:
  ├─ 道歉但无具体改进 → 失败 +1
  ├─ evidence 不匹配 → 失败 +1
  └─ 应付性汇报 → 失败 +1

阈值触发:
  ├─ 失败 ≥ 2 → 切换 agent 类型 + 拆分任务
  └─ 失败 ≥ 3 → 🛑 阻塞报告 + 等用户干预
```

### 措施二: 强制验证门禁

```
子代理返回结果前,主上下文必须:
  1. Completion Report 存在性验证 → 无 → REJECT
  2. evidence 独立抽检 → 不匹配 → REJECT
  3. 应付性表述检测 → 有 → REJECT
  4. 失败计数检查 → ≥3 → 阻塞
```

### 措施三: 上下文管理纪律

```
主上下文:
  ├─ 单次 Read ≤ 50 行
  ├─ 同一文件不读 2 次
  └─ 委派 prompt ≤ 1KB

子代理:
  ├─ 必须返回摘要 (≤5 行)
  └─ 禁止读取 layer=process/log 文档
```

---

> **核心要义**: 反复道歉不是态度问题,是系统性缺陷。诊断根因 + 生成反向提示词 + 补充验证门禁 = 彻底解决。