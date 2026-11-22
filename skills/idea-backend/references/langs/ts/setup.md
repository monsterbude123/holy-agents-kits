# TS / JavaScript 分册 —— 把 TS 项目接进 IntelliJ IDEA

> **本分册的由来**：原 `idea-ts-setup` 技能（2026-11-20 合并进 `idea-backend`）。清单、模板、探测器、引文快照都原样保留，路径改为 `references/langs/ts/`。
> **通用部分不在这里**：装环境/机器事实见 [../../setup-0to1.md](../../setup-0to1.md) 与 `scripts/setup-env.sh`；运行期能力档位见 [runtime.md](runtime.md)；与其它语言的门禁对照见 [../../capability-matrix.md](../../capability-matrix.md)。

## 先看版本门禁（它决定后面哪些能做）

**IDEA 社区版（IdeaIC）能做 TS 编写与静态检查，做不了 TS 的运行/调试与测试执行。**

- Node.js 与 JavaScript Debugger 插件（= 跑和调 TS）只在 Ultimate 订阅下提供；
- Marketplace 上 JavaScript and TypeScript 插件（id 22069）的兼容产品只有 `IDEA_PRO` / `PYCHARM_PRO`，**不含社区版**——别指望在社区版里补装语言插件（能装的只有免费的 JavaScript Debugger 插件 id 17562，它只管调试不管语言服务）；
- 社区版的出路：IntelliJ IDEA Ultimate，或 **WebStorm**（非商用免费、商业 30 天试用）——WebStorm 里本文所有设置页路径与布局完全一致。

本机实测（2026-11-20）：IdeaIC2026.2.5，`productCode=IC`，62 个捆绑插件里没有任何 JS/TS 插件栈，配置目录里也没有 TypeScript 语言服务的选项文件。

随时复查（**通用**入口，任何语言都能问）：

```bash
bash scripts/setup-env.sh plugins <IDEA安装根>   # 各语言插件在位情况 + edition 门禁
bash scripts/setup-env.sh probe  <IDEA安装根>   # 机器事实（含 IDEA_TS_PLUGINS / IDEA_TS_GATE）
```

## 三步用法

1. **探测机器**：`bash scripts/setup-env.sh roots` 看建议区域 → **问用户** IDEA 装在哪（本仓隐私规则：不全局扫描）→ `bash scripts/setup-env.sh detect <区域>` → `bash scripts/setup-env.sh init <安装根>` 写机器本地 `config.json`（不入库、不分发）。复查用 `bash scripts/setup-env.sh check`。
2. **装工具链**：`bash scripts/setup-env.sh install-deps --lang ts`。不装的话，与执行相关的清单条目无法自证。
3. **接项目**：
   - **已有项目** → `node scripts/inspect-project.mjs <项目目录>` 判语言与形态（`LANG=ts` + `SHAPE=node|web|unknown`）、列关键事实，再按 `--ids` 输出该形态适用的清单条目；
   - **新项目** → `bash scripts/init-project.sh <目标项目目录> --lang ts --template ts-project|ts-web --name <包名>`；
   - 然后照 [TS 逐步操作手册](setup-manual.md) 在 IDE 里逐条勾选。

## 模板即版本组合（别乱改）

**`templates/ts-project`** —— Node ESM 服务，tsc 构建（nodenext + dist/ + sourcemap + d.ts）。
**`templates/ts-web`** —— 打包器驱动的前端（Vite + React + TS，preserve + bundler 解析 + noEmit + `@/` 别名）。

两份模板共享同一套版本组合：

- **typescript 6.0.3**（精确钉版）。`typescript-eslint@8.73.0` 的 peer 是 `typescript >=4.8.4 <6.1.0`，所以**不能**用 TS 7.x——升上去会装不上 lint 工具链。
- eslint 10.15.0 + @eslint/js 10.0.1 + typescript-eslint 8.73.0（flat config：`eslint.config.mjs` + `tseslint.configs.recommended`）。
- prettier 3.10.1、vitest 5.1.1、tsx 4.23.15、@types/node 22.20.5、Node 22 LTS（`.nvmrc` 钉版）。

## 自证机制（本分册的核心，也是全仓通用机制）

清单在 [checklist.json](checklist.json)（项目侧 + IDE 侧共 64 条），每条含 `id / title / category / action / verify / source / quote`：

- `verify` 是**在本机真跑**的命令，退出 0 才算这一条配好了；
- `source` + `quote` 必须能在 [sources.md](sources.md) 的抓取快照里逐字命中——**引文不许凭记忆写**；
- `applies_to` 是条件列表（`any` / `node` / `web` / `tsc-build` / `bundler` / `vitest` / `pnpm` / `workspace` / `multi-tsconfig` / `tsconfig`），探测器按项目事实过滤，前端专属项不会出现在 Node 项目里；
- IDE 设置项另有一张表 [idea-settings.json](idea-settings.json)（路径 + 期望状态 + 怎么断言 + 出处 + `edition`），由 `scripts/check-registry-entry.sh --lang ts` 逐条校验。

**这份清单在真实大型仓库上跑过**：Next.js 15 + pnpm 工作区（302 个 npm 脚本、2284 个包、3 个 tsconfig），
首轮 PASS 2 / FAIL 41——多数是清单自己的误报，已逐条改正；复测 PASS 26 / FAIL 12，剩下的都是真问题。
回归记录见 [field-test.md](field-test.md)。

**注意 verify 验的是本技能随附的模板，不是用户的项目。** 接到用户项目上时，`action` 说的是"这一项在目标项目里应该长什么样"，由 agent 对着用户的 tsconfig/package.json 逐条核对；`verify` 保证的是"这套要求本身是自洽且可执行的"。

跑：`bash scripts/verify-item.sh --lang ts <id>` 跑单条，`bash scripts/verify-item.sh --lang ts --all` 跑全部。

## 五个高频坑

- **IDE 与 CLI 诊断分叉**：IDE 默认可能用自己的 TS 编译器。Settings → TypeScript 把 TS 包指向项目的 `node_modules/typescript`，并让 `package.json` 钉死同一版本。
- **tsconfig 不生效**：IDEA 不是取"最近的 tsconfig"，而是取**最近的、且该文件被它的 include/exclude/files 真正引用到的** tsconfig.*.json；文件名还得登记在 Editor → File Types → Typescript config 里，否则被当普通文本。
- **node_modules 拖垮索引**：`.idea/<module>.iml` 里用 `excludeFolder` 排除（模板已带 node_modules / dist / coverage）。
- **社区版跑不了 TS**：版本问题不是配置问题，换 Ultimate/WebStorm，或命令行 `npm run dev` / `npm test` 兜底。
- **ESLint/Prettier 与保存钩子打架**：IDE 侧选 Automatic 配置 + Run on save；命令行侧用 `npm run lint` / `npm run format:check` 走同一道门禁。
