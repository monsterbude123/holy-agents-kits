# description 触发率优化

`description` 是技能会不会被用掉的唯一开关。技能写完、评测也过了之后，
可以再单独优化这一段，把「该触发时触发」的比例往上拉。

> **前置条件**：`scripts/run_loop.py` / `scripts/run_eval.py` / `scripts/improve_description.py`
> 都依赖 `claude -p` CLI。**本机默认没有这个 CLI**，直接跑会失败。
> 先确认可用性，没有就走文末的降级路径。

---

## Step 1 生成触发评测集

造 20 条查询，一半该触发、一半不该触发，存成 JSON：

```json
[
  {"query": "用户的原话", "should_trigger": true},
  {"query": "另一条", "should_trigger": false}
]
```

查询必须像真人会打出来的话：**具体、有细节**。文件路径、用户的工作背景、列名与取值、
公司名、URL、一点闲话，有的带错别字或小写，有的长有的短，重点放在**边界情况**上。

**差**：`"整理这份数据"`、`"把 PDF 转成 Markdown"`、`"做个图表"`

**好**：`"我老板刚发我一个 xlsx（下载目录里，叫 'Q4 sales final FINAL v2.xlsx'），
让我加一列算利润率的百分比，营收在 C 列、成本在 D 列，我记得是这样"`

- **该触发**（8~10 条）：覆盖不同说法——正式的、随意的；用户不点技能名但明显需要它的；
  少见用法；与别的技能竞争但本技能该赢的。
- **不该触发**（8~10 条）：**近似干扰项最有价值**——关键词相近但其实要别的东西；
  朴素关键词匹配会误触的模糊表述；同一件事在别的工具更合适的场景。

**别把否定用例做得太显然。** 给 PDF 技能配一条「写个斐波那契函数」等于没测。

---

## Step 2 给用户过目

评测集质量决定优化质量，这一步别省。

1. 读模板 `.agents/skills/skill-creator/assets/eval_review.html`。
2. 替换占位符：
   - `__EVAL_DATA_PLACEHOLDER__` → 评测项 JSON 数组（**不加引号**，它是 JS 变量赋值）
   - `__SKILL_NAME_PLACEHOLDER__` → 技能名
   - `__SKILL_DESCRIPTION_PLACEHOLDER__` → 当前 description
3. 写到临时文件再打开。Windows 用 `start <路径>`，macOS/Linux 用 `open <路径>`。
4. 用户可以改查询、切换 should-trigger、增删条目，然后点「Export Eval Set」。
5. 导出的文件落在下载目录（Windows 是 `%USERPROFILE%\Downloads`，文件名可能是 `eval_set (1).json`）——
   取最新的那一份。

---

## Step 3 跑优化循环

先告诉用户：「这会跑一阵子，我在后台跑，跑完定期汇报进度。」

评测集存进 workspace 后执行：

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <本次会话的模型 id> \
  --max-iterations 5 \
  --verbose
```

模型 id 用当前会话实际在用的那个，这样测出来的触发率才和用户真实体验一致。
运行期间定期看输出，汇报当前迭代与得分。

循环会自动：按 60% 训练 / 40% 留出集切分 → 用当前 description 评测（每条查询跑 3 次取稳定触发率）
→ 调模型基于失败项提改进 → 在训练集与留出集上重新评测 → 最多迭代 5 轮。
最后打开 HTML 报告，返回 JSON，其中的 `best_description` **按测试集得分而非训练集得分**挑选，避免过拟合。

---

## 技能是怎么被触发的

技能以「名字 + description」出现在可用技能列表里，模型据此决定要不要用。
要点：**模型只会为「自己搞不定」的任务去查技能**——像「读一下这个 PDF」这种简单一步的请求，
即使描述完全匹配也可能不触发，因为模型用基础工具就能做。
复杂、多步、有专业性的请求，描述匹配时才会稳定触发。

**推论**：评测查询要足够实质，值得模型去查技能。
「读文件 X」这种查询本身就不该触发，不管描述写多好。

---

## Step 4 落库

取 JSON 里的 `best_description`，写回 SKILL.md 的 frontmatter。
把改动前后和得分一起给用户看。

---

## 降级路径（没有 `claude` CLI 时）

`claude` 不可用时，触发率优化退化成人工流程，仍然有效：

1. **手写触发评测集**（Step 1 的方法照旧，20 条起步）。
2. **人工判定**：逐条把查询读给用户或自己判断「按当前 description该不该触发」。
   记录：应触发却没写清的场景是 description 的**漏**；不该触发却写了的是**过**。
3. **改 description**：漏的地方补触发词与场景描述，过的地方把无关的词删掉或加上排除语
   （「本技能**不**负责……」）。
4. **再判一轮**，直到误触与漏触都收敛。
5. 产出对比表：改前 / 改后 / 各 20 条的判定结果。

这套流程不需要任何外部 CLI，人工成本换来的是可复核的结论。
