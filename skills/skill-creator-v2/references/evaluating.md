# 跑用例与评分

对应骨架流程的 ⑥ 跑评测。**这一节是一段连续动作，不要中途停下。**
本仓没有 `/skill-test` 之类的测试技能，不要去调用不存在的命令。

结果放在技能目录**同级**的 `<skill-name>-workspace/`（不要放进 `skills/` 目录里，会被当成技能）。
workspace 内按迭代分目录（`iteration-1/`、`iteration-2/`），迭代内每个用例一个目录（`eval-0/`、`eval-1/`）。
**不要提前把目录全建出来**，用到一个建一个。

---

## Step 1 同一轮里把「带技能」和「基线」全部发起

每个用例发起两个子代理：一个是带技能的，一个是基线的。
**要在同一轮里全部发起**——先跑带技能的、过一会儿再回头跑基线，两边的环境条件会漂移，比对就不成立了。

**带技能：**

```
执行这个任务：
- 技能路径：<path-to-skill>
- 任务：<eval prompt>
- 输入文件：<eval files 或 "none">
- 输出保存到：<workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- 需要保存的产物：<用户真正关心的东西，例如"生成的 .docx 文件">
```

**基线**（同一个提示词，基线取决于场景）：
- **新建技能**：完全不给技能。同一个提示词，不给技能路径，存到 `without_skill/outputs/`。
- **改造已有技能**：改造前的旧版本。动手前先快照（`cp -r <skill-path> <workspace>/skill-snapshot/`），
  基线子代理指向快照，存到 `old_skill/outputs/`。

每个用例目录写一份 `eval_metadata.json`（断言此时可以留空）：

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "用户的任务提示",
  "assertions": []
}
```

**目录用描述性名字**，不要用 `eval-0` 这种无意义的名字。
本轮若新增或改动了用例提示，就为新用例目录各写一份，不要假设它会从上轮继承。

---

## Step 2 趁运行中起草断言

别干等。趁子代理还在跑，起草每个用例的量化断言，并**解释给用户听**。
`evals/evals.json` 里已有断言就先审一遍再讲。

好断言的标准：**客观可验证 + 名字能读懂**——在 benchmark 视图里扫一眼就知道这条在查什么。
主观输出（写作风格、设计质量）靠人判断，不要硬套断言。

断言写好后同步更新 `eval_metadata.json` 与 `evals/evals.json`，
并告诉用户视图里会看到什么：定性输出 + 定量指标各占一栏。

---

## Step 3 运行完成时立刻抓耗时

每个子代理完成时会带回 `total_tokens` 与 `duration_ms`，**这是唯一一次能拿到它的机会**，
别指望它被持久化。逐个处理通知，不要攒到最后一起处理。

存到该运行目录的 `timing.json`：

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

---

## Step 4 评分、聚合、出视图

全部跑完后：

1. **逐个评分** —— 起一个评分子代理（或内联评分），读 `agents/grader.md`，
   把结果写进该运行目录的 `grading.json`。
   `grading.json` 的 `expectations` 数组字段**必须**是 `text` / `passed` / `evidence`
   （不能是 `name` / `met` / `details`），视图依赖这些字段名。
   能用脚本检查的断言就写脚本跑——比肉眼看又快又准，还能跨轮复用。

2. **聚合成 benchmark** —— 在 skill-creator 目录下执行：

   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```

   产出 `benchmark.json` 与 `benchmark.md`：各配置的通过率、耗时、token，均值 ± 标准差与差值。
   要手写 `benchmark.json` 时，字段严格按 `references/schemas.md`。
   `with_skill` 的版本排在各自的基线前面。

3. **做一遍分析** —— 读 benchmark 数据，找出聚合统计会盖住的问题：
   恒过的断言（没有区分度）、方差大的用例（可能不稳）、耗时与 token 的取舍。
   详见 `agents/analyzer.md`。

4. **出评审视图**：

   ```bash
   nohup python <skill-creator-path>/eval-viewer/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "my-skill" \
     --benchmark <workspace>/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```

   第 2 轮起加 `--previous-workspace <workspace>/iteration-<N-1>`。

   **没有显示环境 / 无头环境**：改用 `--static <output_path>` 输出独立 HTML 文件。
   用户点「Submit All Reviews」后会下载 `feedback.json`，把它复制回 workspace 目录供下一轮读取。

   **不要自己另写 HTML**，用 `generate_review.py`。

5. **告诉用户**：「结果已经在浏览器里打开了。两个标签页——『Outputs』逐个看用例并留反馈，
   『Benchmark』看定量对比。看完回来跟我说一声。」

### 用户在视图里能看到什么

**Outputs** 标签页一次显示一个用例：提示词、产出（能内联渲染的就内联）、
第 2 轮起还有折叠的「上一轮产出」、跑了评分就有折叠的「Formal Grades」、
自动保存的反馈输入框、上一轮的反馈原文。

**Benchmark** 标签页：通过率、耗时、token 的汇总，含逐用例明细与分析结论。

导航用上下按钮或方向键。看完点「Submit All Reviews」保存成 `feedback.json`。

---

## Step 5 读反馈

用户说看完了就读 `feedback.json`：

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "图缺坐标轴标签", "timestamp": "..."},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..."},
    {"run_id": "eval-2-with_skill", "feedback": "完美", "timestamp": "..."}
  ],
  "status": "complete"
}
```

**空反馈表示用户觉得没问题。** 改进重点放在用户提出具体意见的用例上。

用完把视图服务杀掉：

```bash
kill $VIEWER_PID 2>/dev/null
```
