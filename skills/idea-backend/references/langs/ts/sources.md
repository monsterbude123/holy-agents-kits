# 来源快照（Sources）

> 本文件是 `references/langs/ts/checklist.json` 的**溯源底账**：清单里每一条的 `source`（URL）与
> `quote`（原句）都必须能在这里逐字命中，否则该条在 `scripts/verify-quotes.mjs` 的溯源门
> 里判负——**不许凭记忆写引文**。
>
> 抓取时间：2026-11-20。JetBrains 文档对应 2026.3 文档构建；本仓实测的 IDEA 是
> IdeaIC2026.2（社区版），文档版本比实测新一个次版本，涉及设置项时以实测为准。

---

## [S1] TypeScript — tsconfig 官方总览
- URL: https://www.typescriptlang.org/tsconfig/
- 用于条目：`tsconfig-strict`、`tsconfig-module`、`tsconfig-module-resolution`、`tsconfig-out-dir`、`tsconfig-source-map`、`tsconfig-include-exclude`、`tsconfig-types`、`tsconfig-build-excludes-tests`、`tsconfig-paths`、`tsconfig-no-emit`、`web-alias-resolves`、`tsc-typecheck-gate`、`build-gate`

> The strict flag enables a wide range of type checking behavior that results in stronger guarantees of program correctness. Turning this on is equivalent to enabling all of the strict mode family options

> You very likely want "nodenext" for modern Node.js projects and preserve or esnext for code that will be bundled.

> 'node16' or 'nodenext' for modern versions of Node.js. Node.js v12 and later supports both ECMAScript imports and CommonJS require, which resolve using different algorithms.

> If specified, .js (as well as .d.ts, .js.map, etc.) files will be emitted into this directory. The directory structure of the original source files is preserved; see rootDir if the computed root is not what you intended.

> Enables the generation of sourcemap files. These files allow debuggers and other tools to display the original TypeScript source code when actually working with the emitted JavaScript files.

> Important: exclude only changes which files are included as a result of the include setting.

> If types is specified, only packages listed will be included in the global scope.

> Do not emit compiler output files like JavaScript source code, source-maps or declarations.

> A series of entries which re-map imports to lookup locations relative to the baseUrl if set, or to the tsconfig file itself otherwise.

> You can then use TypeScript as a tool for providing editor integration, and as a source code type-checker.

## [S1b] TypeScript — jsx
- URL: https://www.typescriptlang.org/tsconfig/jsx.html
- 用于条目：`tsconfig-jsx`

> Controls how JSX constructs are emitted in JavaScript files. This only affects output of JS files that started in .tsx files.

## [S2] TypeScript — target
- URL: https://www.typescriptlang.org/tsconfig/target.html
- 用于条目：`tsconfig-target`

> The target setting changes which JS features are downleveled and which are left intact.

## [S3] TypeScript — lib
- URL: https://www.typescriptlang.org/tsconfig/lib.html
- 用于条目：`tsconfig-lib`

> TypeScript includes a default set of type definitions for built-in JS APIs (like Math), as well as type definitions for things found in browser environments (like document).

## [S4] TypeScript — esModuleInterop
- URL: https://www.typescriptlang.org/tsconfig/esModuleInterop.html
- 用于条目：`tsconfig-es-module-interop`

> By default (with esModuleInterop false or not set) TypeScript treats CommonJS/AMD/UMD modules similar to ES6 modules.

## [S5] TypeScript — verbatimModuleSyntax
- URL: https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html
- 用于条目：`tsconfig-verbatim-module-syntax`

> With this new option, what you see is what you get.

## [S6] TypeScript — skipLibCheck
- URL: https://www.typescriptlang.org/tsconfig/skipLibCheck.html
- 用于条目：`tsconfig-skip-lib-check`

> This can save time during compilation at the expense of type-system accuracy. For example, two libraries could define two copies of the same type in an inconsistent way.

## [S7] tsconfig / bases（$schema 约定）
- URL: https://github.com/tsconfig/bases
- 用于条目：`tsconfig-json-schema`

> "$schema": "https://www.schemastore.org/tsconfig"

## [S8] Node.js — Packages（type 字段）
- URL: https://nodejs.org/api/packages.html
- 用于条目：`pkg-type-module`

> The "type" field defines the module format that Node.js uses for all .js files that have that package.json file as their nearest parent.

## [S9] npm — scripts
- URL: https://docs.npmjs.com/cli/v11/using-npm/scripts
- 用于条目：`pkg-scripts`

> The "scripts" property in your package.json supports built-in lifecycle events and arbitrary scripts.

## [S10] npm — package.json（devDependencies / engines）
- URL: https://docs.npmjs.com/cli/v11/configuring-npm/package-json
- 用于条目：`pkg-dev-dependencies`、`pkg-engines-node`

> These are development-only tools, such as test or documentation frameworks, rather than packages required by consumers at runtime.

> You can specify the version of node that your stuff works on

## [S11] TypeScript — Download（版本钉死）
- URL: https://www.typescriptlang.org/download
- 用于条目：`pkg-typescript-pinned`

> To do this, run `npm install -g typescript`. This will install the latest version (currently 7.0).

## [S12] ESLint — Configuration Files（flat config）
- URL: https://eslint.org/docs/latest/use/configure/configuration-files
- 用于条目：`eslint-config-file`、`eslint-ignores`

> It should be placed in the root directory of your project and export an array of configuration objects.

> If ignores is used without any other keys (besides name) in the configuration object, then the patterns act as global ignores.

## [S13] typescript-eslint — Getting Started
- URL: https://typescript-eslint.io/getting-started/
- 用于条目：`eslint-ts-recommended`

> extends: [js.configs.recommended, tseslint.configs.recommended],

## [S14] ESLint — Command Line Interface（退出码 / 配置解析）
- URL: https://eslint.org/docs/latest/use/command-line-interface
- 用于条目：`eslint-gate`、`eslint-print-config`

> Linting was successful and there are no linting errors.

> This option outputs the configuration to be used for the file passed.

## [S15] Prettier — Configuration
- URL: https://prettier.io/docs/configuration
- 用于条目：`prettier-config`

> "trailingComma": "es5", "tabWidth": 4, "semi": false, "singleQuote": true

## [S16] Prettier — Ignoring Code
- URL: https://prettier.io/docs/ignore
- 用于条目：`prettier-ignore`

> Create .prettierignore in the root of your project. It uses gitignore syntax to exclude files and folders from formatting.

## [S17] Prettier — CLI
- URL: https://prettier.io/docs/cli
- 用于条目：`prettier-gate`、`prettier-find-config`

> When you want to check if your files are formatted, you can run Prettier with the --check flag (or -c).

> In order to skip this, you may ask Prettier to find the config file once, and re-use it later on.

## [S18] nvm — .nvmrc
- URL: https://github.com/nvm-sh/nvm#nvmrc
- 用于条目：`node-nvmrc`、`node-nvmrc-matches-runtime`

> nvm use, nvm install, and nvm which will use the version specified in the .nvmrc file

## [S19] Vitest — include
- URL: https://vitest.dev/config/include
- 用于条目：`vitest-config`、`vitest-gate`

> A list of glob patterns that match your test files.

---

## [S20] JetBrains — Node.js 运行配置（版本门禁）
- URL: https://www.jetbrains.com/help/idea/run-debug-configuration-node-js.html
- 用于条目：`idea-edition-gate`

> The plugins are available only in IntelliJ IDEA with the Ultimate subscription.

## [S21] JetBrains — NPM 运行配置
- URL: https://www.jetbrains.com/help/idea/run-debug-configuration-npm.html
- 用于条目：`idea-run-configs`

> In this field, specify the `package.json` file to run the scripts from.

## [S22] JetBrains — Content Roots（排除目录）
- URL: https://www.jetbrains.com/help/idea/content-roots.html
- 用于条目：`idea-node-modules-excluded`

> Right-click a folder and select `Mark Directory As | Excluded`.

## [S23] JetBrains — TypeScript 支持（TS 包来源 / 类型定义）
- URL: https://www.jetbrains.com/help/idea/typescript-support.html
- 用于条目：`idea-ts-version-selection`、`idea-install-type-definitions`

> By default, the `typescript` package from the project's `node_modules` folder is used.

> IntelliJ IDEA lets you get reference for symbols from your project and from its dependencies, for symbols defined in external libraries, and for standard JavaScript APIs because TypeScript implements all of them.

## [S24] JetBrains — TypeScript 设置页
- URL: https://www.jetbrains.com/help/idea/settings-languages-typescript.html
- 用于条目：`idea-ts-language-service`、`idea-ts-service-powered-engine`

> By default, the TypeScript Language Service checkbox is selected.

> By default, the checkbox is cleared, so type evaluation, resolution, code inspections and refactorings are based on the type information from the IntelliJ IDEA internal TypeScript engine.

## [S25] JetBrains — 开发 Node.js 应用（添加本地解释器）
- URL: https://www.jetbrains.com/help/idea/developing-node-js-applications.html
- 用于条目：`idea-node-runtime`

> select  Add Local from the context menu  and choose the installation of Node.js, then click OK.

## [S26] JetBrains — JavaScript Runtime（包管理器）
- URL: https://www.jetbrains.com/help/idea/javascript-runtime.html
- 用于条目：`idea-package-manager`

> In this field,   choose the package manager (npm, Yarn, pnpm, bun) for the current project.

## [S27] JetBrains — ESLint 集成
- URL: https://www.jetbrains.com/help/idea/eslint.html
- 用于条目：`idea-eslint-automatic`

> go to `Languages & Frameworks | JavaScript | Code Quality Tools | ESLint`, and select the Automatic ESLint configuration option.

## [S28] JetBrains — Prettier 集成
- URL: https://www.jetbrains.com/help/idea/prettier.html
- 用于条目：`idea-prettier-run-on-save`

> To apply Prettier automatically to saved files, select the Run on save checkbox.

## [S29] JetBrains — 文件类型与文件关联
- URL: https://www.jetbrains.com/help/idea/creating-and-registering-file-types.html
- 用于条目：`idea-file-type-associations`

> For language-specific features (such as syntax highlighting and code analysis) in files representing different languages and technologies, IntelliJ IDEA maintains a list of file types, each of which links a language service with one or more file name patterns.

## [S30] JetBrains — 运行与调试 TypeScript（tsconfig 文件类型 / 运行与 sourcemap）
- URL: https://www.jetbrains.com/help/idea/running-and-debugging-typescript.html
- 用于条目：`idea-tsconfig-file-type-pattern`、`idea-run-ts-file`、`idea-source-map-debug`

> go to `Editor | File Types`, and make sure the names of all these files match the patterns from the Typescript config file name pattern list.

> IntelliJ IDEA creates a temporary run/debug configuration of the type Node.js which you can save, edit, and reuse for running and debugging.

> During compilation, there can also be generated source maps that set correspondence between your TypeScript code and the JavaScript code that is actually executed.

## [S31] JetBrains — 配置 JavaScript 库（作用域 / node_modules 自动库）
- URL: https://www.jetbrains.com/help/idea/configuring-javascript-libraries.html
- 用于条目：`idea-library-scopes`、`idea-node-modules-library`

> IntelliJ IDEA lets you tune code completion by configuring scopes for libraries.

> To provide code completion for project dependencies, IntelliJ IDEA creates a node_modules library automatically so Node.js modules are kept in your project but no inspections are run against them, which improves performance.

## [S32] JetBrains — Vitest
- URL: https://www.jetbrains.com/help/idea/vitest.html
- 用于条目：`idea-vitest-run-config`

> You can run, debug, do snapshot testing, and measure test coverage both from the editor and via a run/debug configuration.

## [S33] JetBrains — Jest 运行配置
- URL: https://www.jetbrains.com/help/idea/run-debug-configuration-jest.html
- 用于条目：`idea-jest-run-config`

> In this field, specify the `jest.config.js` or `jest.config.ts` file to use

## [S34] JetBrains — File Watchers
- URL: https://www.jetbrains.com/help/idea/using-file-watchers.html
- 用于条目：`idea-file-watchers`

> The plugin is available only in IntelliJ IDEA with the Ultimate subscription.

## [S35] JetBrains — 新建项目向导（React / Vite / TypeScript）
- URL: https://www.jetbrains.com/help/idea/new-project-wizard.html
- 用于条目：`web-react-types`

> your development environment is preconfigured to use Vite with React and TypeScript

---

## 附：版本门禁的机器事实（2026-11-20 实测，非文档）

- 本机 IDEA：`<IDEA安装根>`（2026.2.5），`product-info.json` 的 `productCode` = **IC**（社区版），
  `version` = 2026.2.5，`buildNumber` = 262.12573.28。
- 该安装的 `plugins/` 共 62 个插件，**不含** `javascript-impl` / `javascript-frontend` /
  `nodejs` 等 JS/TS 插件栈——社区版不捆绑它们。
- 配置目录 `%APPDATA%/JetBrains/IdeaIC2026.2/options/` 下**没有** `javascriptLanguageService.xml` /
  `typescriptLanguageService.xml` / `nodejs.xml`——TS 语言服务从未被启用过。
  （`nodejs.xml` 是 IDEA 登记已知 Node 解释器的文件：`<component name="NodeJsLocalInterpreterManager">`
  下每条 `<local-interpreter path="..." />`。它在 JS/TS 插件栈装上之后才会出现，所以「有没有这个文件」
  本身就是一个可靠的版本门禁标记——技能用 `setup-env.sh probe` 的 `IDEA_NODE_REGISTRY=present|absent` 报出来。）
- JetBrains Marketplace 上 JavaScript and TypeScript 插件（id 22069）的兼容产品为
  `["IDEA_PRO","PYCHARM_PRO"]`，**不含** 社区版的 `IDEA`；因此不要指望在社区版里从
  Marketplace 装上语言插件。社区版里可用的只有免费的 JavaScript Debugger 插件（id 17562）。
- 结论：**社区版可以做 TS 代码编写与静态检查，但没有 TS 的运行/调试与测试执行**；
  要跑要调，必须用 IntelliJ IDEA Ultimate 或 WebStorm（WebStorm 非商用免费）。
