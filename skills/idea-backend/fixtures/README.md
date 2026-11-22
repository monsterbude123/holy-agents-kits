# 测量夹具（fixtures）—— 用来**复现**能力测量，不是给用户用的模板

这些工程是为「同一批任务、多个引擎」对测量造的小夹具，刻意做到**零外部依赖**，
这样离线就能跑（`cargo metadata --offline` 秒回、tsserver 直接建 program）。

| 夹具 | 语言 | 里面有什么 | 测什么 |
|---|---|---|---|
| `experiment/repo/ts/` | TypeScript | `src/alpha.ts` 导出 `probeCore` / `ProbeItem` / `ProbeRunner`；`beta.ts` `gamma.ts` `alpha.test.ts` 各自引用它 | tsserver / codegraph / IDEA 三引擎同题对照（引用召回、符号检索、改名编辑面、诊断） |
| `experiment/repo/py/src/` | Python | `probe_item.py` 定义 class 锚点 `ProbeItem` 与 function 锚点 `probe_run`；`probe_consumer.py` 平铺导入写出跨文件调用点；`probe_broken.py` 放一处解析器必拒的语法错 | IDEA / BifrostMCP / agent-lsp / codegraph 四配置**同题**对照（跨臂定量只比 Python） |
| `probe-rust/` | Rust | `src/lib.rs` 一个 struct + 两个 pub fn + 一个 `#[cfg(test)]` | IDEA 社区版（Rust 插件在位）的 L2/L3/L5 实测 |

`experiment/repo/` 是**一个仓两个子工程**（`py/` + `ts/`）—— 跨语言任务要求两种语言在同一个工作区
（IDEA 一个工程 / VS Code 一个窗口），拆成两个仓就测不到「统一符号空间」。

## 真值（机器可数）：`experiment/gold.json` 为准

**计数口径以 `experiment/gold.json` 为准**（每个锚点记两个口径 + 计数范围 + 各引擎的归一规则）；
`check-experiment.js` 会回仓重数一遍，对不上就非 0 退出。下面是人工标注的背景，两处口径**并排看**：

| 口径 | `probeCore`（TS 侧） | 说明 |
|---|---|---|
| **语义引用**（不含定义行） | **7 处 / 4 个文件** | `alpha.ts:17`、`alpha.test.ts:1`(import)、`alpha.test.ts:5`、`beta.ts:1`(import)、`beta.ts:4`、`gamma.ts:1`(import)、`gamma.ts:5` |
| **整词命中**（**含定义行**） | **8 次 / 4 个文件** | gold.json 的 `expect_hits` 用这个口径；比语义口径多 1 = 定义行本身 |

> 差 1 的来源：**定义行算不算**。grep 口径含定义行，语义引擎（IDEA `ide_find_references` /
> pyright `find_references`）默认不含 —— 换算规则写在 gold.json 的 `normalization` 里，
> **两个口径不许混算**。

其它锚点的整词命中数：`ProbeItem` 在 `ts/` 是 **9 次 / 4 个文件**，在 `py/` 是 **4 次 / 2 个文件**；
`probe_run` 在 `py/` 是 **3 次 / 2 个文件**。`probe_broken.py` 是**故意的语法错**（Python 解析器必拒）。

实测（2026-11-22）：**tsserver `references` = 8 命中**（含定义）、**codegraph `impact` = 8 个受影响符号** —— 与真值一致。

## 怎么用

```bash
# tsserver（VS Code 自带引擎）
node scripts/tsserver-probe.js fixtures/experiment/repo/ts --symbol probeCore --file src/alpha.ts --line 8 \
     --tsserver "<VSCode>/resources/app/extensions/node_modules/typescript/lib/_tsserver.js"

# codegraph（先索引；**在 experiment/repo 根 init**，覆盖 py/ + ts/ 两个子工程）
codegraph init fixtures/experiment/repo && codegraph impact probeCore -p fixtures/experiment/repo

# 三引擎同题对比台（IDEA 侧需要该工程已在 IDEA 里打开）
bash scripts/backend-compare.sh fixtures/experiment/repo/ts --symbol probeCore --file src/alpha.ts --line 8 \
     --tsserver "<...>/_tsserver.js"
```

⚠️ `codegraph init` 会在夹具目录写 `.codegraph/`（本仓已 gitignore，外部仓要先确认）。
