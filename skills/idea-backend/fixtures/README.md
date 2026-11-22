# 测量夹具（fixtures）—— 用来**复现**能力测量，不是给用户用的模板

这两个工程是为「同一批任务、多个引擎」对测量造的小夹具，刻意做到**零外部依赖**，
这样离线就能跑（`cargo metadata --offline` 秒回、tsserver 直接建 program）。

| 夹具 | 语言 | 里面有什么 | 测什么 |
|---|---|---|---|
| `probe-ts/` | TypeScript | `src/alpha.ts` 导出 `probeCore` / `ProbeItem` / `ProbeRunner`；`beta.ts` `gamma.ts` `alpha.test.ts` 各自引用它 | tsserver / codegraph / IDEA 三引擎同题对照（引用召回、符号检索、改名编辑面、诊断） |
| `probe-rust/` | Rust | `src/lib.rs` 一个 struct + 两个 pub fn + 一个 `#[cfg(test)]` | IDEA 社区版（Rust 插件在位）的 L2/L3/L5 实测 |

## `probe-ts` 的真值（人工标注）

`probeCore` 定义在 `src/alpha.ts:8`，引用共 **7 处 / 4 个文件**：
`alpha.ts:17`、`alpha.test.ts:1`(import)、`alpha.test.ts:5`、`beta.ts:1`(import)、`beta.ts:4`、
`gamma.ts:1`(import)、`gamma.ts:5`。

实测（2026-11-22）：**tsserver `references` = 8 命中**（含定义）、**codegraph `impact` = 8 个受影响符号** —— 与真值一致。

## 怎么用

```bash
# tsserver（VS Code 自带引擎）
node scripts/tsserver-probe.js fixtures/probe-ts --symbol probeCore --file src/alpha.ts --line 8 \
     --tsserver "<VSCode>/resources/app/extensions/node_modules/typescript/lib/_tsserver.js"

# codegraph（先索引）
codegraph init fixtures/probe-ts && codegraph impact probeCore -p fixtures/probe-ts

# 三引擎同题对比台（IDEA 侧需要该工程已在 IDEA 里打开）
bash scripts/backend-compare.sh fixtures/probe-ts --symbol probeCore --file src/alpha.ts --line 8 \
     --tsserver "<...>/_tsserver.js"
```

⚠️ `codegraph init` 会在夹具目录写 `.codegraph/`（本仓已 gitignore，外部仓要先确认）。
