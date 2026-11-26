# codebase-slimming · 工具链对账清单与踩坑避雷指南

> 本指南总结了在大型 TypeScript/React 项目中进行代码审计、可达性扫描与体量度量时必须遵守的工具准则与常见血泪陷阱。

---

## 一、 推荐的标准开源工具链（拒绝手搓脆弱正则）

| 审计维度 | 推荐工具 | 替代的反模式 | 关键参数与命令范式 |
|---|---|---|---|
| **代码行数与结构** | **cloc** (≥2.12，2.12 修复归档处理 RCE) | 裸 `wc -l` 或手搓 awk 统计 | `cloc src/ --by-file`（按文件）或默认按语言汇总；区分 Code / Comment / Blank；⚠️ 官方默认跳过 >100MB 文件（`--max-file-size` 默认 100，仅对目录遍历生效，显式传参文件不受限） |
| **真实依赖导入图** | **vscode-backend 技能**（LSP 引用查找）或 AST 工具 dpdm | 手搓正则匹配 `import ... from` | 对每个入口符号查真实引用与调用链；`import type` 与动态 `import()` 都进语言服务器索引，不靠正则猜 |
| **未引用文件与导出** | **vscode-backend 技能**（引用查找零引用 + 诊断工具未用声明） | 暴力全局 grep 文件名 | 先用引用查找确认零消费者，再用未用声明诊断交叉验证；⚠️ 索引可能滞后，结论必须落到 `文件:行` 依据 |
| **代码克隆拦截** | **jscpd** (5.4+) | 人工肉眼审 diff | `jscpd src --min-tokens 50 --ignore-identifiers -t <实测值+0.1余量> -r console --output .scratch/jscpd`<br>`-t/--threshold` 超标退出码 1；`--ignore-identifiers` 抓改名克隆（Type-2，`=blind` 可匹配任意改名）；挂接至 `pre-push`，只许收紧不许放宽 |

---

## 二、 全景摸底五表生成范式（The Panorama Recipes）

摸清现状前置时，推荐使用以下严谨命令范式，杜绝脚本统计失真：

1. **互斥四桶账本（宏观分布）**：
   ```bash
   cloc src/ tests/ scripts/ packages/ --by-file --csv --out=tmp/cloc-all.csv
   # 按顶级目录聚合，分别统计 src(产品)、tests(测试)、scripts(工程门禁)、其他(设计/文档)
   ```
2. **产品域排行账本（精准提取，防双计）**：
   ```bash
   # 避坑：wc -l 末尾自带 total 汇总行！提取子目录总量时必须取最后一行的首字段，严禁 awk 全量累加
   find "src/app/[locale]/admin" -type f \( -name "*.ts" -o -name "*.tsx" \) -exec wc -l {} + | tail -1 | awk '{print $1}'
   ```
3. **跨域边与生产死代码闭包（dpdm / AST）**：
   ```bash
   npx dpdm --no-progress --no-tree -o tmp/dpdm-tree.json \
     --detect-unused-files-from "src/**/*.{ts,tsx}" \
     "src/app/**/page.tsx" "src/app/**/layout.tsx" "src/app/**/route.ts"
   # 语义不可写反：位置参数=可达性入口（生产根），--detect-unused-files-from=候选全集，反了会静默漏报；
   # 解析 JSON 获得生产可达集，并统计各域前缀之间的跨域引用文件对数
   ```

---

## 三、 五大经典踩坑陷阱（血泪实证）

### 1. 二进制文件字节当行数（数据量级失真 10 倍）
- **现象**：媒体项目内常有 mp4/zip/ttf 文件，若脚本简单用换行符统计行数，一个 27MB 的 mp4 视频会被解析为 **87 万行代码**，瞬间污染整个架构报表。
- **防线**：统计前先判 NUL 字节（`\0`），对二进制文件仅记录文件大小（MB），绝不计入代码行数（SLOC）。

### 2. 统计脚本汇总行双计（导致代码量虚高一倍）
- **现象**：使用 `find ... -exec wc -l {} + | awk '{s+=$1} END {print s}'` 统计行数；`wc -l` 自带 `total` 行，`awk` 将明细与 `total` 同时求和，导致行数恰好**翻倍**（如把 56 万行算成 109 万行）。
- **防线**：行数统计以 `cloc` 为准；手写脚本时只取 `tail -1` 的汇总数字，严禁无脑累加。

### 3. 漏算 `import type` 类型边（虚假死代码高估）
- **现象**：手搓正则时若只识别 `import { A } from 'B'`，漏掉 `import type { A } from 'B'`，会导致几十个核心类型/接口文件被错误标记为“零引用死代码”并误删，导致构建直接崩溃。
- **防线**：必须用语言服务器语义索引（vscode-backend）或 AST 解析器（如 dpdm），将值依赖与类型依赖统一纳入导入图可达闭包。

### 4. 动态 `dynamic(() => import(...))` 边断裂
- **现象**：Next.js 前端普遍采用 `const X = dynamic(() => import('./X'))` 做路由或抽屉懒加载。简单的静态扫描器无法识别动态 Import，误把生产核心业务链判成死代码。
- **防线**：可达性扫描必须同时覆盖 `ImportDeclaration`、`CallExpression(import)` 以及 `require()`。

### 5. `git ls-files` 路径转义导致静默跳过中文文件
- **现象**：默认执行 `git ls-files` 时，git 会对包含中文或特殊字符的路径加双引号并进行八进制转义（如 `"\351\227\250..."`）。如果不做反转义，`fs.existsSync()` 会直接判定文件不存在，**静默漏掉成百上千个文件**！
- **防线**：一律使用 `git ls-files -z` 配套 NUL 分隔符解析路径。

### 6. 自造债务陷阱（为了过门禁搞出数千行豁免）
- **现象**：把 ESLint 规则升为 `error` 时遇到 1,800 个存量报错，为了让门禁变绿，执行脚本自动生成了一个多达 3,905 行的 `eslint-suppressions.json`。结果“业务代码没减多少，基线文件又暴增 4,000 行”，形成了新一轮水肿。
- **防线**：**严格遵守增量拦截原则**——严格规则只针对暂存区（staged files）生效，不许为了全仓假绿而在仓库里维护庞大的存量错误词典！
