# setup-0to1 —— 把一个 TS 项目接进 IntelliJ IDEA

> 本文件是**人/agent 照着走的操作手册**；`references/checklist.json` 是**可机器自证的清单**。
> 两者配套：手册讲"怎么做"，清单讲"怎么算做完了"。

---

## 第 0 步：版本门禁（先看这个，它决定后面哪些能做）

IDEA 的 TS 能力分两层，别混：

| 能力 | 社区版 IdeaIC | Ultimate / WebStorm |
| --- | --- | --- |
| TS 代码编写、补全、语法/错误高亮、格式化、inspection、ESLint/Prettier 集成 | ✅ | ✅ |
| **TS 运行与调试**（Node.js / JavaScript Debugger 插件） | ❌ | ✅ |
| **JS/TS 测试执行**（Jest / Mocha / Vitest） | ❌ | ✅ |
| File Watchers、WSL 调试 | ❌ | ✅ |

依据（出处见 [sources.md](sources.md) 的 [S20]、[S30]）：

- Node.js 与 JavaScript Debugger 插件 "The plugins are available only in IntelliJ IDEA with the Ultimate subscription."
- JetBrains Marketplace 上 JavaScript and TypeScript 插件（id 22069）的兼容产品是 `["IDEA_PRO","PYCHARM_PRO"]`，**不含社区版的 `IDEA`**——所以在社区版里补装语言插件这条路走不通（可用的只有免费的 JavaScript Debugger 插件 id 17562，它只管调试，不管语言服务）。
- JetBrains 文档说 JS/TS 插件 "is bundled and enabled in IntelliJ IDEA by default" —— 这里的 "IntelliJ IDEA" 指 Ultimate。**社区版安装里根本没有这个插件目录**，实测已确认（见下）。

本机实测（2026-11-20）：`D:/workplace/idea-2026.2.5`，`productCode=IC`，62 个捆绑插件里没有 `javascript-impl` / `javascript-frontend` / `nodejs`，配置目录 `%APPDATA%/JetBrains/IdeaIC2026.2/options/` 下也没有 `javascriptLanguageService.xml` / `typescriptLanguageService.xml` / `nodejs.xml`。

**判定脚本**：`bash scripts/setup-env.sh probe <IDEA安装根>` 会输出 `IDEA_EDITION=` 与 `IDEA_TS_PLUGINS=`。

**决策**：

- 你的机器是 Ultimate / WebStorm → 走完整流程（第 1–5 步）。
- 你的机器是社区版，但只是要**写** TS、要补全和静态检查 → 社区版也能做（语法高亮、基础补全、inspections），但请接受"没有运行/调试/测试执行"，跑不了就交给命令行 `npm run dev` / `npm test`。
- 你的机器是社区版，且要**跑/调/测** TS → 换 IntelliJ IDEA Ultimate（付费或 30 天试用）或 **WebStorm**（非商用免费，商业 30 天试用）。WebStorm 里本文所有设置页路径与布局完全一致。

---

## 第 1 步：机器准备

1. Node.js：装一个受支持的 LTS（本仓模板钉 Node 22；.nvmrc 里就是精确版本号）。命令行 `node -v` 要能跑。
2. 包管理器：npm / yarn / pnpm 任选其一，项目根要有对应的 lock 文件（`package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`）。
3. IDEA：Ultimate 或 WebStorm。社区版请先按第 0 步做决策。

配置机器事实（写进机器本地 `config.json`，不入库、不分发）：

- `bash scripts/setup-env.sh roots` —— 列出建议探测区域
- 问用户 IDEA 装在哪（**不要全局扫描**，这是本仓的隐私规则）
- `bash scripts/setup-env.sh detect <用户确认的区域>` —— 定向探测
- `bash scripts/setup-env.sh init <安装根>` —— 生成 `config.json`
- `bash scripts/setup-env.sh check` —— 复查

---

## 第 2 步：项目准备

把模板落到项目里：

- `bash scripts/init-ts-project.sh <目标项目目录> --template ts-project --name <包名>` —— Node ESM 服务（tsc 构建，nodenext + dist/ + sourcemap）
- `bash scripts/init-ts-project.sh <目标项目目录> --template ts-web --name <包名>` —— 前端（Vite + React + TS，preserve + bundler 解析 + noEmit + `@/` 别名）

**接已有项目**（更常见）先跑探测：

`node scripts/inspect-project.mjs <项目目录>` —— 判形态、列事实。几个必看字段：

- `PACKAGE_MANAGER` —— 以 package.json 的 `packageManager` 字段为准（不是 lockfile）。
  **IDEA 的 Settings > JavaScript Runtime > Package manager 要跟它一致**，否则 Run 'npm install' 跑的是另一套依赖树。
  `MULTIPLE_LOCKFILES=yes` 说明仓库里躺着两套 lockfile（npm + pnpm），先定一个再谈别的。
- `TS_CONFIG_COUNT` / `TS_CONFIG_EXTENDS_MAIN` —— 大于 1 时，**每一个** `tsconfig.*.json` 都要登记在
  Editor > File Types > Typescript config 文件类型下，否则 IDEA 不认它（IDE 取的是"最近且真正引用到该文件"的那份）。
- `AT_TYPES_NODE_MATCHES_PIN` —— 为 no 时说明 @types/node 与运行时的 Node 主版本不一致，IDE 里的 Node API 签名会是错的。
- `WORKSPACE` / `WORKSPACE_PACKAGES` —— 是工作区时，子包各有各的 tsconfig 与 `type`，要逐包核对，别只看根。

它会做四件事：

1. 复制 `templates/ts-project/`（跳过 node_modules/dist/coverage，已存在的文件默认不覆盖）
2. 把 IDEA 模块从 `ts-project.iml` 改名成项目名，并同步 `.idea/modules.xml`
3. 把 `package.json` 的 `name` 改成项目名
4. `npm install` 装好工具链（`--no-install` 可跳过）

模板带的东西和为什么：

| 文件 | 为什么必须有 |
| --- | --- |
| `tsconfig.json` | IDE 的类型服务读它；`strict` / `module` / `moduleResolution` / `lib` / `types` 决定 IDE 与 CLI 是否给同一套诊断 |
| `tsconfig.build.json` | 构建用，额外排除 `**/*.test.ts`，测试代码不进产物但仍被 IDE 检查 |
| `package.json` | `scripts` 供运行配置按名字调用；`type` 与 `module` 必须对齐；`devDependencies` 钉死精确版本 |
| `eslint.config.mjs` | flat config，IDE 的 ESLint provider 与 `npx eslint .` 读同一份 |
| `.prettierrc.json` + `.prettierignore` | IDE 格式化器与 `prettier --check` 同源；没有 ignore 文件，`--check` 会在 dist 上失败 |
| `.nvmrc` | IDE 应该读它来选 Node 解释器（`engines.node` 只是声明，不会切换解释器） |
| `vitest.config.ts` | IDE 测试运行器与命令行用同一套 glob 发现用例 |
| `.idea/modules.xml` + `.idea/<name>.iml` | 把 node_modules / dist / coverage 排除出索引 |
| `.idea/runConfigurations/*.xml` | 共享运行配置，clone 即用；npm 型 + Node 型各一组 |

**版本组合不要乱改**：`typescript-eslint@8.73.0` 的 peer 是 `typescript >=4.8.4 <6.1.0`，所以模板用 TypeScript **6.0.3** 而不是 7.x——升到 7.x 会装不上 lint 工具链。

---

## 第 3 步：IDE 侧设置（Ultimate / WebStorm）

按 `references/idea-settings.json` 的顺序逐条做，那里有每一项的**路径 + 期望状态 + 怎么断言**。要点：

1. **Settings > Languages & Frameworks > JavaScript Runtime**：Preferred runtime → Browse → Add Local → 选 Node 安装目录；Version 字段要和 `node -v` 一致；勾 "Coding assistance for Node.js" 才有 Node 内置类型。
   （IDEA 认识哪些解释器会记在 `<configDir>/options/nodejs.xml` 的 `NodeJsLocalInterpreterManager` 组件下；这个文件只有 JS/TS 插件栈装上后才出现，`setup-env.sh probe` 报的 `IDEA_NODE_REGISTRY` 就是它。）
2. **同页 > Package manager**：选 npm（或 yarn/pnpm）。
3. **Settings > Languages & Frameworks > TypeScript > TypeScript**：TS 包指向项目的 `node_modules/typescript`（不要 Bundled），版本要和 `package.json` 里钉的一致。
4. **同页 > TypeScript language service**：勾 "TypeScript Language Service"（默认勾）。内置引擎算错类型或卡顿时才勾 "Enable service-powered type engine"，改完在状态栏 TS 挂件上重启服务。
5. **Settings > Editor > File Types**：`tsconfig*.json` 要登记在 **Typescript config** 文件类型下；`.ts/.tsx/.js/.jsx` 不能绑到 Plain text。
6. **Settings > Languages & Frameworks | JavaScript | Code Quality Tools | ESLint**：选 **Automatic ESLint configuration**。
7. **Settings > Languages & Frameworks | JavaScript | Prettier**：Automatic + **Run on save**；要让 Ctrl+Alt+L 也走 Prettier，就用 Manual 配置并勾 "Run on 'Reformat Code' action"。
8. **Settings > Languages & Frameworks | JavaScript | Libraries > Manage Scopes**：收窄 Node.js Core 的作用域到后端目录。
9. **运行与调试**：右键 `.ts` 入口 → Run/Debug（临时 Node.js 配置，记得存下来）；要断点调试就加 **JavaScript Debug** 配置指向 dev server URL，依赖 tsconfig 的 `sourceMap: true`。
10. **测试**：Run | Edit Configurations → 加 **Vitest**（或 Jest）配置，让 IDE 的测试视图和 `npm test` 用同一套用例发现规则。
11. **File Watchers**（Ultimate 独占）：Settings | Tools | File Watchers 建一个 watcher，比如 `tsc --noEmit -w`。

---

## 第 4 步：自证

- 单条：`bash scripts/verify-item.sh <id>`
- 全部：`bash scripts/verify-item.sh --all`

每条的 `verify` 都是**真跑**的命令（装好了工具链的话，`tsc --noEmit`、`eslint .`、`prettier --check .`、`vitest run` 会真的执行）。跑不过就是没配好，别嘴硬。

依赖没装时（`templates/ts-project/node_modules` 不存在），与执行相关的条目会明确报 "toolchain not installed"，先跑 `bash scripts/setup-env.sh install-deps`。

**真实项目上跑门禁前先限定范围**：几百个包的仓库里，`eslint .` / `prettier --check .` / `vitest run` / `tsc --noEmit` 都是分钟到几十分钟量级（实测一个 2284 包的 pnpm 仓库，vitest 那一跑直接把整个测试套件拉起来了）。先用项目自带的 `npm run lint` / `npm run format:check` / `npm run typecheck`（通常已经封好了范围、并行度甚至堆上限），或先跑单个文件 / `vitest related <file>` 做配置验证，全量留给 CI。**类型检查尤其要走项目自己的入口**——裸 `tsc --noEmit` 在某些仓库会因默认堆上限 SIGABRT，日志里一条 `error TS` 都没有，很容易被读成"类型检查挂了"，真实原因只是内存不够。

---

## 第 5 步：常见坑对照表

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| IDE 里没类型、命令行 `tsc` 正常 | IDE 用了自带 TS 编译器 | Settings > TypeScript 选项目的 `node_modules/typescript`，并让 `package.json` 钉死同一版本 |
| 改了 tsconfig 的 paths 但 IDE 不认 | tsconfig 没被登记为 Typescript config，或该文件没被最近 tsconfig 的 include/exclude/files 引用 | Editor > File Types 补登记；IDEA 取的是"最近**且引用到该文件**的 tsconfig"，不是单纯最近的 |
| 索引巨慢、node_modules 里到处是红波浪线 | node_modules 没排除 | `.idea/<module>.iml` 里加 `<excludeFolder url="file://$MODULE_DIR$/node_modules"/>`，或 Project 视图右键 Mark Directory As > Excluded |
| 前端文件里补全出 `fs` / `path` | 库作用域是全项目 | Libraries > Manage Scopes 按目录分配 |
| 测试/调试在社区版跑不了 | 版本问题，不是配置问题 | 换 Ultimate / WebStorm；命令行用 `npm test` |
| ESLint 报错和命令行不一致 | IDE 没开 Automatic 配置，或 ESLint 包路径不对 | Code Quality Tools > ESLint → Automatic ESLint configuration |
| 存盘后格式被改坏 | Prettier 和 IDE 内置格式化器同时生效 | Prettier 页开 Run on save；要 Ctrl+Alt+L 也走 Prettier 就用 Manual + Run on 'Reformat Code' action |
| `npm install` 后 TS 版本对不上 | `^` 范围让编译器悄悄升级 | `devDependencies.typescript` 钉精确版本，并提交 lock 文件 |
