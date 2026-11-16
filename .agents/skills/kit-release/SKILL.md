---
name: kit-release
description: "holy-agents-kits 仓库的发版与发布流程。核心语义：npm publish ≠ git push ≠ npx 更新，三者各自独立、互不触发。凡涉及「发布 / 发新版 / npm publish / npx 装的还是旧版 / install 没生效 / GitHub 上看不到」时先读本技能。触发词：发布、release、npm publish、npx 缓存、版本没生效、push。"
---

# kit-release · 本仓库的发版流程

发布 = **三条独立通道全部打通**，只通一条都叫「没生效」：

| 通道 | 动作 | 不做的后果 |
|---|---|---|
| npm registry | `npm publish` | npx / npm 装不到新版 |
| GitHub 仓库 | `git push` | README、反馈入口指向的仓库永远是旧代码 |
| 本机全局 skills | `install --force` | 本机 agent 用不上新版 |

**npm publish 不会触发 push，push 也不会刷新 npx 缓存。** 每条通道单独验证，缺一不可。

## 发版 7 步（每步带判据）

| 步 | 动作 | 判据 |
| --- | --- | --- |
| 1 | 改技能 + 同步门面：README（导语 / mindmap / 技能表 / 详解 / 仓库结构）、package.json（version / description / keywords） | 三处技能数一致 |
| 2 | `npm test`（= 规范校验 `--all` + `cli.js list`） | 「全部通过」，且 list 里看得到新技能 |
| 3 | commit：只 `git add` 相关文件；工作区常有 `.v2c/` `.video_agent/` `.zcode/` 等无关目录，**不要整目录 add** | `git status` 里 staged 清单逐个核对 |
| 4 | `npm publish`（prepublishOnly 自动再跑一遍门禁） | `+ holy-agents-kits@x.y.z` |
| 5 | 等 registry 传播后再验证：`npm view holy-agents-kits version` | 显示新版本才许宣布「已发布」 |
| 6 | `git push` 后 `git log origin/main..HEAD` | **必须为空**（不为空 = 还有 commit 没上去） |
| 7 | 全局覆盖：`node bin/cli.js install <skills> --force`，再 `diff -r skills/<s> ~/.agents/skills/<s>` | diff 无输出 = 逐字节一致 |

## npx / 缓存语义（「装了没生效」的头号根因）

- **npx 裸包名吃旧缓存**：`npx holy-agents-kits list` 复用 `_npx` 缓存里满足 spec 的旧版本，**永远不会主动追 latest**。实测：registry 已是 0.5.0 时，裸名 npx 仍跑 0.3.3（只列 7 个技能）。
  - 强制新版：`npx holy-agents-kits@latest …`（实测立即生效）
  - 清缓存：删 `%LOCALAPPDATA%\npm-cache\_npx\`（Windows）或 `~/.npm/_npx/`（mac/linux）
  - 判别方法：`npm view <pkg> version`（registry 真值）vs npx 实际行为，两者不一致 = 缓存问题
- **registry CDN 传播延迟**：`npm publish` 成功后几十秒到几分钟内，`npm view` / npx 可能仍解析到旧版。这是传播，不是失败——等，再验。
- **安装器对已存在目录默认跳过**：输出「跳过 xxx：已存在（加 --force 覆盖）」并返回码 1。看到「跳过」就是没装，补 `--force`。

## 失败模式速查

| 症状 | 根因 | 修法 |
| --- | --- | --- |
| npx list / install 跑出来还是旧技能集 | 裸包名 npx 缓存 | `@latest` 或清 `_npx` |
| install 提示没生效，输出里有「跳过」 | 目标已存在、未带 --force | 补 `--force` |
| GitHub 上看不到新版本 | publish 不等于 push | `git push`，验 `origin/main..HEAD` 为空 |
| 刚 publish 完 `npm view` 还是旧版 | CDN 传播延迟 | 等几分钟重验，别重复 publish |
| 装完 diff 不一致 | 装的是旧缓存包 | 先解决 npx 缓存，再 --force 重装 |

## 一键复检

```bash
npm view holy-agents-kits version        # registry 真值 = package.json 版本
git log --oneline origin/main..HEAD      # 必须为空
npx holy-agents-kits@latest list         # 技能数与内容 = 本仓库 skills/
diff -r skills/<s> ~/.agents/skills/<s>  # 无输出 = 全局与本仓一致
```

四条全绿，发布才算完成。任何一条红，按上表对号入座，不要宣布完成。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
