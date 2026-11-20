# 检视规则包（rules/）——跨项目复用指南

## 这是什么

本目录携带 agent 用 IDEA 做代码门禁所需的**活配置**：

- `Project_Default.xml` — IDEA 的 inspection profile（项目当前生效的那份）。实战中调优 = 在 IDEA GUI 的 Settings | Inspections 里勾选，IDEA 自动更新该文件；调优后把新版本拷回本目录即可，规则随技能包演进。
- 必装插件引用清单（见下表）——规则由插件自带，profile 只引用不复制。注意 P3C 的 65 条 `Ali*` 规则里**只有 11 条能经 MCP 驱动**（其余 54 条是 PMD 动态规则，daemon-core 与批处理管线都不执行），细节见 SKILL.md「运维备忘」。

## 必装插件

| 插件 | 来源 | 作用 |
| --- | --- | --- |
| Alibaba Java Coding Guidelines(XenoAmess TPM) | Marketplace `com.alibaba.p3c.xenoamess` | P3C 规范检视（65 条 Ali* 规则，其中 11 条经 MCP 可驱动） |
| Lombok | Marketplace | 让 inspection 正确解析 Lombok 生成符号（2026.2.5 不再捆绑） |
| IDE Index MCP Server | Marketplace `com.github.hechtcarmel.jetbrainsindexmcpplugin`（monster 维护仓 fork 构建见 SKILL.md） | MCP 工具面 |

## 新项目 setup（3 步）

1. **装插件**：按上表从 Marketplace 安装（或从本机已装目录拷贝 zip side-load）。
2. **同步 profile**：把本目录 `Project_Default.xml` 拷到新项目 `.idea/inspectionProfiles/`；若新项目没有该目录则连 `profiles_settings.xml`（内容：`<component name="InspectionProjectProfileManager"><option name="PROJECT_PROFILE" value="Project Default" /></component>`）一起带上，使该 profile 成为项目当前 profile。
3. **验证**：IDEA GUI 里 Analyze Code（scope=Whole Project）能跑出全量 Ali* 规则；agent 侧用 `ide_inspect`（增量）或 headless `inspect.bat`（全量）复核——注意 MCP 侧只拿得到 11 条直连 Ali 规则，其余 PMD 规则以 GUI/PMD CLI 为准。

## 门禁分工（复用时同样适用）

- `ide_inspect`（in-process，增量，agent 改完代码即跑）——`files/uncommitted` 走 daemon 同款引擎（local 全量含 P3C，实测与 GUI 对齐）+ 批处理（global 工具出 XML）；`whole` 走纯批处理
- headless `inspect.bat`（低频，全量）——离线权威复核（与 daemon-core 结果一致性已实测对齐）
- **注意**：批处理管线的 local 段对 P3C 等第三方 local 工具沉默（daemon-core 段已覆盖，不影响结论），见 skill references §0.5
