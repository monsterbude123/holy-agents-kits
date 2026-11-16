# scripts

本目录存放固化的可执行程序：把「每次都要重写一遍」的代码固定下来。

要求：
- 只依赖运行时自带能力（这里是 **Node ≥ 18，零第三方依赖**；不引入 npm 包）
- 提供 `--help`，错误信息写清怎么修
- stdout 输出结果，stderr 输出过程日志

## build_surface.mjs

Markdown 语料 → 单文件 HTML（数据内嵌，双击即开）+ 同份 JSON。

```bash
node build_surface.mjs --in ./docs --out ./surface.html \
     --config ./docs/surface.config.json --echarts ./vendor/echarts.min.js
```

- `--in` 递归扫描 `*.md`；`--out` 写单文件界面；`--json` 同时导出数据。
- `--echarts` 给本地 `echarts.min.js` → 内联进产物，离线自包含；不给则走 CDN。
- `--config` 默认读 `<in>/surface.config.json`（分组映射 / 摘要段 / 色板）。
- 输出结构、解析规则、关联算法见 `../references/parsing.md`、`../references/relations.md`。
- 脚本同时是可导入模块：`import { pickSummary, buildNodes, computeLinks } from './build_surface.mjs'`，便于写自检。
