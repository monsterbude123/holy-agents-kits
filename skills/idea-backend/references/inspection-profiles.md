# Inspection 规则与 Profile 配置（权威参考）

> （本文个别验证命令含开发机路径示例——通用的是机制与判断依据。）

> 目标读者：要在 IDEA 里**新增/调整 inspect 规则**的 agent。本文只写判断依据与 262 实证事实；
> 引擎调用层的坑见 [ide-inspect-extension.md](ide-inspect-extension.md) §0.5。日期：2026-11-18，IDEA 2026.2.5。

## 1. Profile 的双层结构与优先级

| 层 | 位置 | 作用 |
| --- | --- | --- |
| 项目 profile | `<项目>\.idea\inspectionProfiles\*.xml` + 同目录 `profiles_settings.xml` | 项目生效配置（本 skill 的 `rules/Project_Default.xml` 即此物，随 skill 分发复用） |
| IDE 全局 | `<configDir>\options\`（编辑器共享 profile） | 未启用项目 profile 时兜底 |

- `profiles_settings.xml` 的 `<component name="InspectionProjectProfileManager"><option name="PROJECT_PROFILE" value="Project Default"/>` 决定项目用哪份 profile——**新项目 setup 时必须连这份一起拷**，否则 profile 文件在但不生效。
- 编程侧"生效 profile" = `InspectionProjectProfileManager.getInstance(project).currentProfile`。
- **离线/文件加载**（inspect.bat 同款）：`ApplicationInspectionProfileManagerBase.getInstanceBase().loadProfile(<xml 路径>)` 得到独立 profile 实例，再 `context.setExternalProfile(...)`（与项目内存实例**行为可能不同**，见 §4）。

## 2. Profile XML schema（真实样本锚定）

```xml
<component name="InspectionProjectProfileManager">
  <profile version="1.0">
    <option name="myName" value="Project Default" />
    <inspection_tool class="AliEqualsAvoidNull" enabled="true" level="WARNING" enabled_by_default="true" />
    <!-- 带作用域的状态（可选）：工具在特定 scope 下的 enabled/level 覆盖 -->
    <inspection_tool class="UnusedDeclaration" enabled="true" level="WARNING" enabled_by_default="true">
      <option name="myLocalVariables" value="false" />  <!-- 工具自带选项也是子 option -->
    </inspection_tool>
  </profile>
</component>
```

- `class` = 工具短名（**不是实现类名**，如 `AliEqualsAvoidNull`）；与 EP 的 `shortName` 一一对应。
- `enabled`（用户覆盖态）与 `enabled_by_default`（注册默认）并存；per-scope 覆盖时出现带 `<scope_name>` 的层级。
- 读取链（源码 `InspectionProfileImpl.readExternal`）：`inspection_tool` 子元素 → ToolsImpl（含 per-scope `ScopeToolState`）。
- 运行时 per-file 生效判定：`ToolsImpl.getEnabledTool(psiFile, includeDoNotShow)`——`state.isEnabled() && (includeDoNotShow || level 不是 DO_NOT_SHOW)` 才返回 wrapper；`includeDoNotShow = profile.getSingleTool() != null`（单工具运行才包含 DO_NOT_SHOW 级）。**查某文件某工具为何没跑，先查这里**。

## 3. 规则从哪来（注册机制）

- 规则 = 插件注册的 `com.intellij.localInspection` EP：
  ```xml
  <extensions defaultExtensionNs="com.intellij">
    <localInspection implementationClass="com.x.YourInspection"
                     shortName="YourShortName" displayName="..."
                     groupPath="Java" groupBundle="..." key="..."
                     level="WARNING" enabledByDefault="true"/>
  </extensions>
  ```
  实现类 extends `LocalInspectionTool`（`buildVisitor` 提供 PsiElementVisitor；`getID`/`getAlternativeID` 参与 suppress；`isUnfair` 表示一次 visit 不能覆盖全文件语义）。EP 属性载体 = `InspectionEP`（analysis-api）。
- **装第三方插件 = 批量装规则**（P3C 2.3.0 的 65 条 Ali*、CheckStyle-IDEA 等）：装完即在 profile 候选里（默认启用与否看 `enabledByDefault` 与 IDE 的 "Disable new inspections by default" 选项）。
- 262 实证：P3C 2.3.0（since=251，无 until）加载正常、daemon/批处理均产出；`com.alibaba.p3c.xenoamess` 为第三方 TPM 维护版，另有 `io.github.godfather1103.alibaba.p3c` 分支可作备选。

## 4. 新增/调整规则的三个路线（按成本排序）

| 路线 | 做法 | 适用 |
| --- | --- | --- |
| ① 装第三方规则插件 | Marketplace 装（P3C 等）→ profile 里出现 → 按需 enabled/level | 有现成规则集 |
| ② Structural Search inspection（SSR） | GUI: Settings→Inspections→Structural search→模板检索（如 `@$Annotation$//`）；模板存 profile | 无需写代码的模式类规则 |
| ③ 自写 LocalInspectionTool 插件 | 新插件注册 EP（见 §3）→ side-load 到 `configDir\plugins\` → 重启 | 定制语义规则 |

- **调整现有规则**：直接改项目 profile XML（enabled/level/选项子 option）→ 让 IDE 重新加载（GUI 改设置即时生效；外部改 XML 需重启或触发改文件刷新）。改完把新 XML 拷回本 skill `rules/` 目录保持资产同步。
- **agent 验证规则生效**：`scripts/inspect-diff.sh`（改动文件集）或 `scripts/mcp-call.sh index ide_inspect '{...engine:"full"...}'`，对照金标准文件/行（如 UsageTracker.java:185 的 AliEqualsAvoidNull）。注意 daemon/`ide_diagnostics` 有**后台初始化延迟**（IDE 启动后 2 分钟内别下结论）。

## 5. 与检视工具的对接矩阵（262 实证）

| 工具 | profile 来源 | 覆盖 |
| --- | --- | --- |
| `ide_inspect {engine:"full"}`（files/uncommitted） | 项目 currentProfile（daemon-core 段）+ 文件加载（批处理段） | local 全量含 P3C + global 工具出 XML |
| `ide_inspect {engine:"full"}`（whole） | 同上 | 纯批处理管线（local 段对第三方 local 工具可能沉默，daemon-core 段已覆盖） |
| headless `inspect.bat -profile <xml>` | 命令行指定文件（`loadProfile`） | 离线全量（P3C 实证可用） |
| daemon / `ide_diagnostics` | 项目 currentProfile | 实时增量（有后台延迟） |

## 6. 已知边界（踩过）

- 批处理管线（GlobalInspectionContext）的 local 段对第三方 local 工具的调度在 262 有静默缺失观察（daemon-core 直调路线无此问题）——规则排查时**别把工具批处理结果当规则未生效的证据**，先跑 `inspect-diff.sh` 或 GUI。
- profile XML 被 IDE 运行时重写过的话，外部脚手架改动会被覆盖——**先改 GUI 或改 XML 后重启**再固化到 skill。
- `level` 合法值：`ERROR` / `WARNING` / `WEAK WARNING` / `INFO` / `SERVER PROBLEM`；DO_NOT_SHOW 不落 XML（即禁用）。
