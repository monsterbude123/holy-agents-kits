# 缺失-CLI 走开发的工作流（2026-08-13 新增）

> 核心：**用户给任务 → 查 CLI → 缺失 → 走 TDD 开发 CLI → 再完成任务**。
> 反模式：发现 CLI 不支持就**手动拼凑命令**（裸 git + Edit manifest + 调 python）完成任务。结果下次同类任务又得手搓一遍，命令无法复用，错误也无法兜底。
> 关联：[tdd.md](./tdd.md)（TDD 模板） / [doc-verify.md](./doc-verify.md)（doc manager 验证流程）。
> 完整命令清单见 [commands.md](./commands.md)

## 触发场景

- 用户说「加个仓库 facebook/react」→ `add` 不存在
- 用户说「验证下 doc manager」→ `verify-docs` 不存在
- 用户说「查 freshness」→ `query` 不存在
- 任何用户给定的指令，CLI 现有子命令覆盖不了

## 协议（5 步强制）

```
Step 1 — 探查现有 CLI
  ├─ node scripts/cli.mjs --help / 看 scripts/cli.mjs
  └─ 找到匹配的子命令？
      ├─ 是 → 直接用现有命令完成任务
      └─ 否 → 进入 Step 2

Step 2 — 写测试（红）
  ├─ 在 scripts/test/<command>.test.mjs 或 <command>.e2e.test.mjs 写测试
  ├─ 覆盖：正常路径 / 边界 / 错误路径
  └─ node --test scripts/test/ 看到红（实现文件不存在 / 函数未实现）

Step 3 — 写实现（绿）
  ├─ 在 scripts/commands/<command>.mjs 实现
  ├─ 复用现有 lib（git.mjs / manifest.mjs / paths.mjs / time.mjs）
  └─ 跑 Step 2 的同一条命令看到绿

Step 4 — 注册到 cli.mjs
  ├─ 在 COMMANDS 表加一项（usage / summary / 选项声明 / 执行体）
  └─ node scripts/cli.mjs <command> 真命令验证

Step 5 — 用新 CLI 重做用户任务
  ├─ 把"先做的工作"回滚（如果手动操作已污染状态）
  └─ 跑新 CLI 完成用户原始任务
```

## 反模式

- ❌ 看到 CLI 没有就「先用 git clone + Edit manifest 凑合」 — 下次又得手搓
- ❌ 跳过测试直接写 .mjs — 违反 TDD
- ❌ 实现完不写测试 — 「已跑通」不算交付
- ❌ 注册到 cli.mjs 后没跑新命令真验证 — 单元测试绿 ≠ 命令能跑
- ❌ 完成用户任务前没回滚手动操作 — 留下脏状态

## 验证

- [ ] 是否有「先红后绿」的 TDD 证据（git log 或 commit message）？
- [ ] 测试命令全绿？
- [ ] 新命令 `--help` 有输出，且真命令跑通？
- [ ] 用户原始任务是用新 CLI 完成的（不是手动）？

> 缺失的命令 → 触发本协议，不要手动拼凑。命令清单的唯一出处是 [commands.md](./commands.md)。
