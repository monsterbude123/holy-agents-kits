# 错误路径处置协议（诊断命中后照做）

> 失败分析 / 子代理产物验证 / Completion Report 校验 / 上下文纪律 / 工具选择。
> 判「是不是系统性错误路径」见 [apology-diagnosis.md](apology-diagnosis.md)。

---


## 失败分析协议 (强制)

Step 1 — 识别错误操作
  └─ Agent 实际执行了什么? (具体命令/文件)

Step 2 — 识别错误路径
  └─ 错误操作是如何被选中的? (决策树哪个分支)

Step 3 — 识别根因
  ├─ 技能缺陷? (SKILL.md 缺少约束)
  ├─ 提示词缺陷? (prompt 有歧义)
  ├─ 工具缺陷? (选错工具)
  └─ 上下文缺失? (缺少关键信息)

Step 4 — 具体改进方案
  ├─ 技能缺陷 → 补充 NEVER 项
  ├─ 提示词缺陷 → 补充注入模板
  ├─ 工具缺陷 → 补充工具选择决策树
  └─ 上下文缺失 → 补充读文件纪律

禁止: 无具体改进方案的重试
```

---

### 模式二: 甩锅子代理

**识别特征**:
```
主上下文: "子代理返回了什么?"
Agent: "子代理给了虚假内容,应该 xxxx"
Agent: "我看了子代理的输出,但没验证真实性"
```

**根因分析**:
```
表象: 主上下文道歉 + 甩锅子代理
深层: 主上下文未执行验证职责
      ├─ 盲信子代理产物
      ├─ 未执行 evidence 独立抽检
      └─ 未执行 Completion Report 真实性校验
```

**修复方案**:
```markdown
## 子代理产物验证协议 (强制)

验证步骤:
  1. Completion Report 存在性验证
     └─ 无 Report → 🛑 REJECT

  2. evidence 真实性验证 (V10.6 强制)
     ├─ 随机抽 1 个 evidence
     ├─ 主上下文亲自 Read 该位置
     └─ 文件该行存在 + 内容匹配 → 🟢 通过

  3. pass_count 准确性验证
     ├─ 读取测试文件
     ├─ 统计实际用例数
     └─ 与声称数量一致 → 🟢 通过

  4. 应付性表述检测
     └─ 含 "我搞错了"/"子代理给了" → 🛑 REJECT

禁止: 主上下文盲信子代理产物
强制: 主上下文必须独立抽检 evidence
```

---

### 模式三: 应付性汇报

**识别特征**:
```
Agent: "我完成了"
User: "文件在哪?"
Agent: "哦,我搞错了,应该写到另一个路径"
User: "那为什么 Completion Report 说写到了?"
Agent: "抱歉,我自评的时候没仔细检查"
```

**根因分析**:
```
表象: Agent 自评 PASS 但产物缺失
深层: Completion Report 缺乏强制校验
      ├─ 无 evidence 独立抽检
      ├─ 无文件存在性验证
      └─ Agent 知道应付成本 < 真实完成成本
```

**修复方案**:
```markdown
## Completion Report 校验协议 (V10 硬门禁)

Step 0 — 字段值机械校验 (强制):
  1. artifacts 列表 → 非空
  2. 每个路径 → os.path.exists() 必须存在
  3. 每个文件 → wc -l ≥ 3 (非占位符)
  4. reviewer total_score → 交叉验算 (pass/total × 5.0)

Step 6c — Evidence 独立抽检 (V10.6 强制):
  1. 从 evidence 字段随机抽 1 个 file:line
  2. 主上下文亲自 Read 该位置 (≤50 行)
  3. 验证:
     ├─ 文件该行存在?
     ├─ 内容与声称匹配?
     └─ pass_count 是否准确?
  4. 不匹配 → 🛑 REJECT + 计入失败计数

应付性汇报治理:
  - "我搞错了" → 计为失败 1 次
  - 连续 2 次 → 切换 agent 类型
  - 连续 3 次 → 阻塞报告
```

---

### 模式四: 上下文击穿

**识别特征**:
```
Agent: "好的,我读取 spec.md..." (读取 500 行)
Agent: "我理解了需求..." (信息已丢失)
Agent: "抱歉,我刚才读了什么来着?" (反复读取)
```

**根因分析**:
```
表象: Agent 反复读取大文件
深层: 上下文管理策略缺失
      ├─ 单次读取行数过多 (>200 行)
      ├─ 同一文件读取 ≥ 2 次
      └─ 子代理返回后主上下文信息丢失
```

**修复方案**:
```markdown
## 上下文管理纪律 (强制)

读文件纪律:
  1. 优先 Grep + -A/-B 取片段
  2. 必须 Read 时: offset + limit ≤ 50 行
  3. 禁止同一文件读 2 次以上
  4. 禁止读取 .docindex.json / .docmap.json (数万行)

委派纪律:
  1. 单次委派 prompt ≤ 1KB
  2. 子代理必须返回摘要 (≤5 行)
  3. 主上下文不内联模板全文到 prompt
  4. 引用路径而非复制全文

子代理返回格式:
  ```
  ## Completion Report (≤300 字符)
  - status: ✓
  - evidence: file:line (≤3 个)
  - pass_count: N/M
  - 摘要: {≤5 行关键结论}
  ```

禁止: 反复读取同一文件
禁止: 读取超大索引文件
强制: 子代理返回摘要
```

---

### 模式五: 工具误用

**识别特征**:
```
主上下文: "委派 implementer 修改代码"
Agent: "委派完成,子代理返回结果"
User: "为什么 implementer 用了 search?"
Agent: "抱歉,我选错了工具"
```

**根因分析**:
```
表象: subagent_type 选择错误
深层: 工具选择决策树缺失
      ├─ 不知道 coding agent 必须用 general_purpose_task
      ├─ 不知道 search 只能用于纯搜索
      └─ 不知道误用会导致结构性失败 (无 Write 工具)
```

**修复方案**:
```markdown
## 工具选择决策树 (强制)

需要做什么?
├─ 写文件/跑测试/执行命令 (coding agent)
│   └─ general_purpose_task (完整工具集)
│       包括: implementer, contract-writer, spec-writer, reviewer, debugger
│
└─ 纯信息搜索/文档探索 (只读)
    └─ search (轻量工具集)
        包括: intake, debugger(纯诊断), 文档查询

判定铁律:
  - coding agent 用 search → 🛑 结构性失败 (无 Write 工具)
  - 纯搜索用 general_purpose_task → ⚠️ 资源浪费但可用
  - 不确定 → 优先 general_purpose_task

误用后果:
  - search 做 implementer → 无 Write/Edit/RunCommand → 必然失败
  - 计为主上下文路由错误 (不扣 agent 失败计数)
  - 立即用 general_purpose_task 重新委派
```

---
