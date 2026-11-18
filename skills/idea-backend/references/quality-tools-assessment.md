# 质量工具评估：Live Template / 时序图 / Coverage（2026-11-18）

> （判定与理由通用；`jacoco-report.sh` 默认容器名为本仓库 devcontainer，其他项目用 `DEVCONTAINER` 环境变量覆盖。）

> 结论性文档——防止后续 agent 重复探索。每项给出判定 + 理由 + 已落地的替代路径。

## 1. Live Template —— ❌ 不做 MCP 工具（等价能力已有）

- **机制**：`TemplateManager.startTemplate` 需要活跃 Editor（交互式展开 `$VAR$` 占位符），头less 化后只剩"文本渲染+插入"——与 `ide_create_from_template`（IDEA 文件模板，package/文件头/格式化自动）/ `InsertMemberTool` / `EditMemberTool` 语义重叠。
- **质量张力**：模板固化的样板代码会被 DuplicateExpressions/重复检查打脸；LLM 直写语义更强的代码优于套固定模板。
- **保留路径**：团队若沉淀了**必须一致**的骨架（如测试类结构、版权头），走两条已有路：
  1. `ide_create_from_template { kind: "JUnit4TestClass", ... }`（IDEA 内置/自定义文件模板，模板本身可在 `configDir/fileTemplates` 定制）
  2. `InsertMemberTool`（把标准片段插进既有类）
- Live Template 对**人**在 IDE 里仍是好工具——不否定，只是 agent 不需要。

## 2. 时序图 —— ❌ 不做 IDE 工具（✅ skill 层替代）

- **事实**：IDEA 社区版**没有内置时序图**（内置 Diagram 是类图/依赖矩阵）；时序图靠第三方插件（SequenceDiagram 等），输出是 Swing GUI 面板——头less 化成本高。
- **本质**：时序图 = 调用序列的文本变换。**`ide_call_hierarchy` 已给出全部数据**，agent 渲染 Mermaid sequenceDiagram 是零成本纯文本工作（不需要 IDE 参与）。
- **用法**：`scripts/mcp-call.sh index ide_call_hierarchy '{"symbolId":"...","direction":"OUTGOING","depth":3,...}'` → 让 agent 按 mermaid 语法渲染。理解类需求（非质量类），按需用。

## 3. Coverage —— ❌ 不走 IDE 引擎（✅ JaCoCo via devcontainer）

- **事实**：IDEA coverage 引擎绑定 run configuration + 执行器（`CoverageExecutor`），头less 化要复刻执行/引擎选择/数据落盘/视图读取全链路——高成本。
- **本质**：coverage 的价值在**数据**（哪些类没被测到），不在 IDE 高亮。项目测试跑在 devcontainer（`mvn test`）→ **JaCoCo 是正解**。
- **已落地**：`scripts/jacoco-report.sh [mvnTestArgs]` —— devcontainer 内 `mvn test + jacoco:prepare-agent + jacoco:report`，解析 `target/site/jacoco/jacoco.xml`，输出整体行覆盖率 + 覆盖最低的前 15 个类（质量信号）。
- **前置条件（当前阻塞）**：项目测试须先绿。**2026-11-18 实测 devcontainer 内 `ApplicationSmokeTest` 全红**（Spring context 启动失败：Logback 配置加载错误）——先修复项目的 logback/logDir bootstrap 问题，coverage 才有意义。链路本身已验证（jacoco agent 注入 + surefire 执行均正常）。

## 4. 已落地增量（本轮）

- `ide_create_from_template`（monster 5.21.0-monster.1）：IDEA 文件模板头less 创建（New | Java Class 同引擎）——package 推导、文件头、格式化、落盘、索引一步到位。
- `scripts/jacoco-report.sh`：coverage 数据管道（JaCoCo）。
- 本文档。
