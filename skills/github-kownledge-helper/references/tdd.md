# TDD 模板（node:test）

> 本项目技能内的脚本开发走 TDD。本文件沉淀红绿循环、测试组织、node:test 用法的最小模板。

## 核心约定

1. **测试在 `scripts/test/`**，与 `scripts/lib/` `scripts/commands/` 并列，匹配模式 `*.test.mjs`。
2. **TDD 三步**：先写测试（红）→ 跑测试确认红 → 写实现（绿）→ 跑测试确认绿 → 重构。**禁止**先写实现后补测试。
3. **测试先行于脚本**：用户说"写一个 X 脚本"→ 先写 X 的测试 → 再写 X。
4. **临时脚本禁止**：所有 .mjs / .ps1 脚本必须有对应测试文件。无测试 = 不交付。
5. **e2e 用真实 tmp 目录 + 真 git**：不 mock git（mock 会掩盖真实 bug）。tmp 用 `mkdtempSync(tmpdir() + 'prefix-')`，每个 test 自己清理。

## node:test 用法（已就位）

- 零依赖：`node:test` + `node:assert/strict`，无需任何 npm 包。
- 导入约定：
  ```js
  import { describe, it, beforeEach, afterEach } from 'node:test';
  import assert from 'node:assert/strict';
  ```
- 断言映射（vitest → node:test）：

  | vitest | node:test |
  |---|---|
  | `expect(x).toBe(y)` | `assert.strictEqual(x, y)` |
  | `expect(x).toEqual(y)` | `assert.deepStrictEqual(x, y)` |
  | `expect(x).toBeNull()` | `assert.strictEqual(x, null)` |
  | `expect(fn).toThrow(/re/)` | `assert.throws(() => {...}, /re/)` |
  | `expect(x).toMatch(/re/)` | `assert.match(x, /re/)` |
  | `expect(x).toContain(s)` | `assert.ok(x.includes(s))` |
  | `expect(x).toHaveLength(n)` | `assert.strictEqual(x.length, n)` |
  | `expect(x).toMatchObject({...})` | 逐字段 `assert.strictEqual` |

- **无模块 mock 能力**：需要替换依赖时用**依赖注入**（如 `runBuildIndex(scriptsDir, docsDir, spawnFn)` 注入假 spawn），不要 mock `node:child_process`。
- 测试文件放在 `scripts/test/` 下会被 `node --test <dir>` 自动发现（`*.test.mjs`）。

## 测试类型与典型用法

### 1. 纯函数单测（parseRepoInput / summarizeFreshness）

- 不用 fs / git / process.chdir。
- 每个 case 直接 `it('...', () => assert.strictEqual(fn(input), expected))`。
- 边界：空 / 非法 / 极端值。

### 2. 集成测（buildEntryFromRepo）

- 用 `mkdtempSync` 建 tmp dir + 真 git init + 真 commit + 真 clone URL（`https://github.com/...` 或 `file://` 协议）。
- 验证副作用（fs 状态）。
- afterEach：`rmSync` + chdir 离开。

### 3. e2e（addRepo）

- 真实 bare remote fixture（用 `git init --bare` + `symbolic-ref HEAD refs/heads/<branch>`，避免 "remote HEAD refers to nonexistent ref"）。
- process.chdir(tmpRoot) → getProjectRoot 自动定位。
- 验证：clone 后 .git 存在、docs 镜像存在、manifest 已追加。
- afterEach：chdir 离开 + `rmSync({ maxRetries: 10, retryDelay: 200 })` 抗 Windows EBUSY。

### 4. 涉及外部命令的（verifyDocs / runBuildIndex）

- 接受可配置 `cwd` 参数（默认 process.cwd()），测试不污染真项目根。
- 真实 spawn 子进程 + 解析 stdout，**不** mock 子进程（mock 会让"命令改了路径"类问题逃过测试）。
- 需要断言 spawn 调用参数时，用注入的假 spawn 捕获参数。

## 路径解析的测试隔离模式

> `scripts/lib/paths.mjs` 的 `getProjectRoot(cwd = process.cwd())` 从 cwd 向上找 `manifest.json` 定位最近的根。
> 解决：测试中 `process.chdir(tmpRoot)`，所有 lib 函数读 cwd → getProjectRoot 找到 tmpRoot。

测试中 `process.chdir(tmpRoot)`，所有受影响的函数（readManifest / writeManifest / runSyncDocs / addRepo / runVerifyDocs）都接 `cwd` 参数。

> 当前测试通过情况由测试命令实时产生，禁止在文档中硬编码用例数快照。

## 反模式

- ❌ 先写 `scripts/commands/foo.mjs` 再补 `scripts/test/foo.test.mjs`（违反 TDD，常见于赶进度）
- ❌ 用模块 mock 替换 fs / git / 子进程（逃逸真实 bug；改用依赖注入）
- ❌ 测试不清理 tmp → 磁盘爆炸
- ❌ e2e 跑在真项目根 → 污染 manifest
- ❌ 在文档里写死"几个套件 / 几个用例"快照 → 必然失真

## 跑测试

```bash
node --test "scripts/test/*.test.mjs"     # 在技能目录内执行（一次性）
```

> 在项目根执行时路径为 `node --test ".agents/skills/github-kownledge-helper/scripts/test/*.test.mjs"`。
> 注：Node 22 的 `--test` **对目录参数不做递归发现**（会当模块加载报错），必须传 glob；或在测试目录下不带参数执行 `node --test`。

## 与项目规则的对应

- [evolution.md](./evolution.md) §1 大型任务判定：TDD 实现新 CLI 是大型任务，完成后必须升级 skill。
- 缺失-CLI 走开发的工作流：见 [cli-development.md](./cli-development.md)。
