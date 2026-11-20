---
name: idea-ts-setup
description: 把 TypeScript 项目接进 IntelliJ IDEA 的可执行配置清单与初始化步骤。含版本门禁（社区版 IdeaIC 有 TS 编写与静态检查，但 Node.js/JavaScript Debugger 插件与 JS/TS 测试执行是 Ultimate 独占，社区版需换 WebStorm 或 Ultimate）、Node 解释器与包管理器、TypeScript 语言服务与 TS 包版本、tsconfig/package.json/eslint/prettier/vitest 的关键项、共享运行配置与 .idea 索引排除。核心是可自证：清单每条都带真跑的 verify 命令与官方文档出处。触发词：IDEA、IntelliJ、idea、IntelliJ IDEA、TypeScript、TS、tsconfig、JS、JavaScript Runtime、Node 解释器、ESLint、Prettier、Vitest、运行配置、run configuration、IDE 配置、前端环境、接进 IDEA。
---

# idea-ts-setup —— 把 TS 项目接进 IntelliJ IDEA

> 与 `idea-backend` 是兄弟技能、不重叠：`idea-backend` 管"让 agent 调 IDEA 的语义能力"（检视、引用、索引），本技能管"把一个 TS 项目正确地接进 IDEA"。两者都遵循本仓规矩：机器事实进 `config.json`，正文不硬编码机器路径。

## 先看版本门禁（它决定后面哪些能做）

**IDEA 社区版（IdeaIC）能做 TS 编写与静态检查，做不了 TS 的运行/调试与测试执行。**

- Node.js 与 JavaScript Debugger 插件（= 跑和调 TS）只在 Ultimate 订阅下提供；
- JS/TS 测试执行（Jest / Mocha / Vitest）同样 Ultimate 独占；
- Marketplace 上 JavaScript and TypeScript 插件（id 22069）的兼容产品只有 `IDEA_PRO` / `PYCHARM_PRO`，**不含社区版**——别指望在社区版里补装语言插件（能装的只有免费的 JavaScript Debugger 插件 id 17562，它只管调试不管语言服务）；
- 社区版的出路：IntelliJ IDEA Ultimate，或 **WebStorm**（非商用免费、商业 30 天试用）——WebStorm 里本文所有设置页路径与布局完全一致。

本机实测（2026-11-20）：IdeaIC2026.2.5，`productCode=IC`，62 个捆绑插件里没有任何 JS/TS 插件栈，配置目录里也没有 TypeScript 语言服务的选项文件。

随时复查：`bash scripts/setup-env.sh probe <IDEA安装根>` 会输出 `IDEA_EDITION=` 与 `IDEA_TS_PLUGINS=`。

## 三步用法

1. **探测机器**：`bash scripts/setup-env.sh roots` 看建议区域 → **问用户** IDEA 装在哪（本仓隐私规则：不全局扫描）→ `bash scripts/setup-env.sh detect <区域>` → `bash scripts/setup-env.sh init <安装根>` 写机器本地 `config.json`（不入库、不分发）。复查用 `bash scripts/setup-env.sh check`。
2. **装工具链**：`bash scripts/setup-env.sh install-deps`。不装的话，与执行相关的清单条目无法自证。
3. **接项目**：`bash scripts/init-ts-project.sh <目标项目目录> --template ts-project|ts-web --name <包名>`，然后照 [references/setup-0to1.md](references/setup-0to1.md) 在 IDE 里逐条勾选。

## 模板即版本组合（别乱改）

**`templates/ts-project`** —— Node ESM 服务，tsc 构建（nodenext + dist/ + sourcemap + d.ts）。
**`templates/ts-web`** —— 打包器驱动的前端（Vite + React + TS，preserve + bundler 解析 + noEmit + `@/` 别名）。

两份模板共享同一套版本组合：

- **typescript 6.0.3**（精确钉版）。`typescript-eslint@8.73.0` 的 peer 是 `typescript >=4.8.4 <6.1.0`，所以**不能**用 TS 7.x——升上去会装不上 lint 工具链。
- eslint 10.15.0 + @eslint/js 10.0.1 + typescript-eslint 8.73.0（flat config：`eslint.config.mjs` + `tseslint.configs.recommended`）。
- prettier 3.10.1、vitest 5.1.1、tsx 4.23.15、@types/node 22.20.5、Node 22 LTS（`.nvmrc` 钉版）。

## 自证机制（本技能的核心）

清单在 `references/checklist.json`（项目侧 + IDE 侧共 58 条），每条含 `id / title / category / action / verify / source / quote`：

- `verify` 是**在本机真跑**的命令，退出 0 才算这一条配好了；
- `source` + `quote` 必须能在 `references/sources.md` 的抓取快照里逐字命中——**引文不许凭记忆写**；
- `applies_to` 标出适用形态（`any` / `web`），前端专属项不会污染 Node 项目的自检；
- IDE 设置项另有一张表 `references/idea-settings.json`（路径 + 期望状态 + 怎么断言 + 出处），由 `scripts/check-registry-entry.sh` 逐条校验。

跑：`bash scripts/verify-item.sh <id>` 跑单条，`bash scripts/verify-item.sh --all` 跑全部。

## 模板即版本组合（别乱改）

- **typescript 6.0.3**（精确钉版）。`typescript-eslint@8.73.0` 的 peer 是 `typescript >=4.8.4 <6.1.0`，所以**不能**用 TS 7.x——升上去会装不上 lint 工具链。
- eslint 10.15.0 + @eslint/js 10.0.1 + typescript-eslint 8.73.0（flat config：`eslint.config.mjs` + `tseslint.configs.recommended`）。
- prettier 3.10.1、vitest 5.1.1、tsx 4.23.15、@types/node 22.20.5、Node 22 LTS（`.nvmrc` 钉版）。

## 五个高频坑

- **IDE 与 CLI 诊断分叉**：IDE 默认可能用自己的 TS 编译器。Settings → TypeScript 把 TS 包指向项目的 `node_modules/typescript`，并让 `package.json` 钉死同一版本。
- **tsconfig 不生效**：IDEA 不是取"最近的 tsconfig"，而是取**最近的、且该文件被它的 include/exclude/files 真正引用到的** tsconfig.*.json；文件名还得登记在 Editor → File Types → Typescript config 里，否则被当普通文本。
- **node_modules 拖垮索引**：`.idea/<module>.iml` 里用 `excludeFolder` 排除（模板已带 node_modules / dist / coverage）。
- **社区版跑不了 TS**：版本问题不是配置问题，换 Ultimate/WebStorm，或命令行 `npm run dev` / `npm test` 兜底。
- **ESLint/Prettier 与保存钩子打架**：IDE 侧选 Automatic 配置 + Run on save；命令行侧用 `npm run lint` / `npm run format:check` 走同一道门禁。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
