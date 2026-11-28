# 实测记录（field test）——把清单拿到真实项目上跑

> 这份记录是**回归证据**：清单不是凭空写的，是在一个真实的大型仓库上跑过一遍、
> 误报被改掉之后留下的结论。改动清单时请对着这份记录看一眼。

## 被测对象

- 路径：`<项目根>`（内部 TS 项目，名略）
- 形态：Next.js 15 + React 19 + pnpm 12 工作区（`pnpm-workspace.yaml` → `packages/*`）+
  Prisma + Vitest + Playwright
- 规模：package.json 里 302 个 scripts（其中 48 个 `test:*`）、48 个 @types 包、
  `node_modules/.pnpm` 下 2284 个包、3 个 tsconfig（`tsconfig.json` /
  `tsconfig.test.json` / `tsconfig.verify.json`，后者是独立的 commonjs 配置）
- 本机 IDEA：IdeaIC2026.2.5 社区版 → **TS 的运行/调试/测试执行全都不具备**

## 怎么跑的

把技能的 `templates/ts-project` 与 `templates/ts-web` 指向该项目（junction），
让清单里的 `verify` 命令**原样**跑在真实项目上，而不是跑在技能自带的模板上。

第一次结果：**PASS 2 / FAIL 41**。看起来像项目一塌糊涂，其实大部分是**清单自己的错**。

## 清单改对之后：PASS 26 / FAIL 12（4 条超时）

### 真问题（8 条，都是技能该抓的）

| 清单条目 | 项目的实际情况 | 为什么重要 |
| --- | --- | --- |
| `idea-node-modules-excluded` | `.idea/*.iml` 里**一个 excludeFolder 都没有** | 2284 个 pnpm 包 + `.next` + `coverage` + `out` + `.pnpm-store` 全量进索引 |
| `idea-run-configs` | 没有 `.idea/runConfigurations/` | 302 个 npm 脚本却没有任何共享运行配置，每人各自重建 |
| `tsconfig-types` | `compilerOptions.types` 没写 | 84 个 @types 全局注入，其中 `@types/jest` 是**传递依赖漏进来的**，和 vitest 的全局 describe/it/expect 撞车 |
| `pkg-types-node-matches-runtime` | `@types/node` 装的是 **20.19.17**，运行时是 **Node 22.14.0** | IDE 里 fs/stream/crypto 的签名按 Node 20 给，运行时是 22，类型与行为分叉 |
| `pkg-typescript-pinned` | `"typescript": "^5"` | 一次 `npm install` 就可能换小版本 → IDE 与 CLI 的诊断分叉 |
| `idea-ts-version-selection` | 实装 TS 5.9.2，package.json 写 `^5` | 同上，IDE 显示的版本与包声明不是一回事 |
| `tsconfig-json-schema` | tsconfig.json 没有 `$schema` | 键名拼错（如 `moduleResoultion`）时 IDE 与 tsc 双双静默忽略 |
| （并入上一条）`.idea/compiler.xml` 残留 | annotationProcessing profile 里引用着早已不存在的模块 `jump3r` | 残留引用让 IDEA 反复提示找不到模块 |
| （并入上一条）`.idea/misc.xml` 残留 | MavenProjectsManager 记着从 `node_modules/.pnpm/lamejs@1.2.1/...` 导入的 Java 库 | 把 node_modules 内部的东西导成了项目模型的一部分 |

### 被改掉的误报（6 条，清单自己的错）

| 原条目 | 为什么错 | 改成 |
| --- | --- | --- |
| `pkg-type-module` | 要求 package.json 必须是 `"type": "module"` | 改成**与 tsconfig 的 module 相容**即可；由打包器接管转译的项目（Next.js/Vite）不受这条约束 |
| `pkg-scripts` | 要求字面上存在 `"test"` 脚本 | 改成要求存在**测试入口**（`test` / `test:all` / `test:unit:all` …）——该仓有 48 个 test:* 脚本，只是没有一个叫 test |
| `eslint-ts-recommended` | 要求配置文件里出现 `tseslint.configs.recommended` | 改成接受**两种合法接法**：v8 元包，或 `@typescript-eslint/parser` 拆包 / `FlatCompat` 桥接 `plugin:@typescript-eslint/recommended`（该仓用的是后者） |
| `pkg-dev-dependencies` | 要求 `typescript-eslint` 这个包名 | 改成元包或拆包二选一 |
| `tsconfig-verbatim-module-syntax` | 要求必须为 true | 降级为**建议**：`isolatedModules` 也算过（SWC/打包器转译的项目本来就靠它） |
| `tsc-typecheck-gate` | 要求直接跑 `npx tsc --noEmit` | 改成**走项目自己的 typecheck 入口**——该仓的裸 tsc 在默认 2096MB 堆上限处 SIGABRT，包了一层加堆上限与范围裁剪 |

外加两条澄清：
- `prettier-config`：`.prettierrc`（无扩展名）也是合法文件名，不能只认 `.prettierrc.json`。
- `idea-run-configs`：目录不存在时要报"没有共享运行配置"，而不是抛 node 异常。

### 门禁必须先限定范围（4 条超时，不是失败）

`eslint .` / `prettier --check .` / `vitest run` / `tsc --noEmit` 在这个仓上都是**分钟到几十分钟**量级，
其中 vitest 那一跑把整个测试套件拉起来了。结论写进了这四条的 action：

- 真实项目上先用项目自带的 `npm run lint` / `npm run format:check`（通常已带 glob 范围）；
- 或先跑单个文件 / `vitest related <file>`，全量留给 CI；
- 类型检查一律走项目自己的入口，不要照抄裸命令。

## 探测器（inspect-project.mjs）也修了

第一次跑这个仓，探测器把 `LOCKFILE` 报成 `package-lock.json`——**错了**，该仓用 pnpm
（`packageManager: "pnpm@12.15.0+sha512..."`，且同时存在 pnpm-lock.yaml）。修的内容：

- `PACKAGE_MANAGER` 优先读 package.json 的 `packageManager` 字段，lockfile 只作兜底；
- `MULTIPLE_LOCKFILES` 单独报出来（同时有 package-lock.json 与 pnpm-lock.yaml 本身就是味道，
  IDE 的 Package manager 设置只能跟其中一个）；
- `WORKSPACE` / `WORKSPACE_GLOBS` / `WORKSPACE_PACKAGES`：认 pnpm-workspace.yaml 与 package.json 的 workspaces；
- `TS_CONFIG_COUNT` / `TS_CONFIG_EXTENDS_MAIN`：多 tsconfig 项目必须让每个 tsconfig.*.json 都登记在
  Editor > File Types > Typescript config，否则 IDEA 不认；
- `AT_TYPES_NODE` / `AT_TYPES_NODE_MATCHES_PIN`：类型包与运行时主版本对齐；
- `TEST_SCRIPT` / `TEST_SCRIPTS` / `TYPECHECK_ENTRY` / `ESLINT_TS_WIRING` / `MODULE_TYPE_COMPAT`：
  清单的断言改为直接读探测器的结论，一处口径。

## 没验到的部分

- **16 条 IDE 设置项**（Node 解释器、TS 语言服务、ESLint/Prettier 集成、库作用域、运行调试、测试执行）
  全是 IDE 的 UI 态，shell 断言不了；本机是社区版，这些能力根本不存在，所以这轮只做了"清单项完整性"校验。
- `tsconfig.test.json` / `tsconfig.verify.json` 是否真被 IDEA 用上，要在 Ultimate 上开
  Editor > File Types > Typescript config 确认——社区版验证不了。
- 该仓**没有**被改动。这次只测了技能，改不改项目是另一个决定。
