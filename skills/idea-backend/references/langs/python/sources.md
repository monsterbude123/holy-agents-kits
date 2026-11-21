# 来源快照（Sources）—— Python 分册

> 本文件是 `checklist.json` / `idea-settings.json` 的**溯源底账**：每一条的 `source`（URL）与
> `quote`（原句）都必须能在这里逐字命中（`bash scripts/verify-quotes.mjs --lang python` 机器核验）——
> **不许凭记忆写引文**。
>
> 抓取时间：2026-11-20。JetBrains 文档对应 2026.3 文档构建；本仓实测的 IDEA 是 IdeaIC2026.2（社区版），
> 文档版本比实测新一个次版本，涉及设置项时以实测为准。
> Marketplace 兼容列表取自 JetBrains 官方 API（`plugins.jetbrains.com/api/plugins/<id>/updates`），
> `IDEA_PRO` = IntelliJ IDEA Ultimate，`IDEA_COMMUNITY` = IntelliJ IDEA Community。

---

## [P1] Python language support — IntelliJ IDEA 官方文档
- URL: https://www.jetbrains.com/help/idea/python.html
- 用于条目：`ide-plugin-gate`、`idea-python-plugin`、`idea-python-interpreter`

> Make sure that the Python plugin is installed and enabled.

> The plugin implements all the features of PyCharm.

> All Python functionality in IntelliJ IDEA is fully supported on Python 3.9 or later.

> Python 3: from the version 3.9 up to the version 3.15

> IntelliJ IDEA provides the following features to help you work with Python:

> Python support in IntelliJ IDEA

---

## [P2] Configuring a Python SDK / interpreter — IntelliJ IDEA 官方文档
- URL: https://www.jetbrains.com/help/idea/configuring-python-sdk.html
- 用于条目：`idea-python-interpreter`、`idea-uv-environment`、`idea-indexing-excludes`

> Navigate to File | Project Structure or press Ctrl+Alt+Shift+S.

> Select Virtualenv from the list of environment types.

> Select uv from the list of environment types.

> Select Conda from the list of environment types.

> The selected SDK will be used for the current project and all its modules.

> Click the Python Interpreter widget on the status bar.

---

## [P3] Testing frameworks: pytest — JetBrains 官方文档
- URL: https://www.jetbrains.com/help/idea/pytest.html
- 用于条目：`pytest-config`、`pytest-gate`、`idea-pytest-runner`、`idea-pytest-run-configuration`

> press Ctrl+Alt+S to open settings and select Python | Tools | Integrated Tools

> select pytest from the Default test runner list.

> PyCharm detects it and makes it the default project test runner.

> Specify the pythonpath option in the pytest configuration file, for example, in pyproject.toml.

> PyCharm provides a pytest Run/Debug configuration automatically.

---

## [P4] Managing plugins — IntelliJ IDEA 官方文档
- URL: https://www.jetbrains.com/help/idea/managing-plugins.html
- 用于条目：`ide-plugin-gate`、`idea-python-plugin`、`idea-plugin-edition-note`

> Open settings or press Ctrl+Alt+S in your IDE and then select Plugins.

> Most plugins can be used with any JetBrains product.

> Some are limited only to commercial products, others require a separate license.

> By default, IntelliJ IDEA is configured to use plugins from JetBrains Marketplace.

---

## [P5] Indexing — IntelliJ IDEA 官方文档
- URL: https://www.jetbrains.com/help/idea/indexing.html
- 用于条目：`idea-indexing-excludes`

> Right-click a folder and select Mark Directory As | Excluded.

> Excluded files and folders are not indexed during project analysis

> they remain part of the project.

---

## [P6] Marketplace 兼容列表（API）—— 决定每门语言的 edition 门禁
- URL: https://plugins.jetbrains.com/api/plugins/631/updates?size=1 （Python 语言插件，id 631）
- URL: https://plugins.jetbrains.com/api/plugins/22069/updates?size=5 （JavaScript and TypeScript，id 22069）
- URL: https://plugins.jetbrains.com/api/plugins/5047/updates?size=1 （Go Language，id 5047）
- URL: https://plugins.jetbrains.com/api/plugins/20574/updates?size=1 （Ruff，id 20574）
- 用于条目：`ide-plugin-gate`、`idea-plugin-edition-note`

Python 语言插件（id 631）最新版的 products：

> "products": ["JBCLIENT","IDEA_PRO"]

JavaScript and TypeScript（id 22069）最新版的 compatibleVersions：

> "PYCHARM_PRO": "2026.2.5", "IDEA_PRO": "2026.2.5"

Go Language（id 5047）最新版的 compatibleVersions（含社区版）：

> "IDEA_COMMUNITY"

Ruff（id 20574）最新版的 compatibleVersions（含社区版）：

> "IDEA_COMMUNITY"

> ⇒ **门禁是"每个插件一行"，不是"每门语言一行"**：Python 与 JS/TS 的**语言插件**都只发布到 `IDEA_PRO`（Ultimate），
> 而 Go 语言插件、Ruff 这类**工具插件**发布到 `IDEA_COMMUNITY`。同一门语言里，语言插件与工具插件可以落在不同门禁上。

---

## [P7] uv — 官方文档
- URL: https://docs.astral.sh/uv/
- 用于条目：`uv-lock-reproducible`、`package-manager`

> An extremely fast Python package and project manager, written in Rust.

> uv manages dependencies and environments for single-file scripts.

---

## [P8] Ruff — 官方文档
- URL: https://docs.astral.sh/ruff/
- 用于条目：`ruff-config`、`ruff-format-config`、`idea-ruff-format`

> An extremely fast Python linter and code formatter, written in Rust.

> Ruff aims to be orders of magnitude faster than alternative tools while integrating more functionality behind a single, common interface.

---

## [P9] PEP 621 — pyproject.toml 项目元数据
- URL: https://peps.python.org/pep-0621/
- 用于条目：`pyproject-parse`、`deps-declared`

> Tools MUST specify fields defined by this PEP in a table named [project].

> This PEP specifies how to write a project’s core metadata in a pyproject.toml file for packaging-related tools to consume.

---

## [P10] mypy 配置 — 官方文档
- URL: https://mypy.readthedocs.io/en/stable/config_file.html
- 用于条目：`mypy-config`

> Mypy supports reading configuration settings from a file.

> Instead of using a `mypy.ini` file, a `pyproject.toml` file (as specified by PEP 518) may be used instead.

> The `[mypy]` section should have `tool.` prepended to its name:

---

## [P11] Python Community Edition —— JetBrains 官方 Marketplace 条目（社区版 Python 语言插件）
- URL: https://plugins.jetbrains.com/api/plugins/7322
- 兼容列表 URL: https://plugins.jetbrains.com/api/plugins/7322/compatible-products
- 用于条目：python 门禁段（[setup.md](setup.md) 的"版本门禁"节、[runtime.md](runtime.md) 的 §1）
- 抓取时间：2026-11-22。**这是本分册此前记错的那条事实的更正依据** —— Python 不是"社区版装不了"。

> The Python plug-in provides smart editing for Python scripts. The feature set of the plugin
 corresponds to PyCharm IDE Community Edition.

（`id` = 7322，`name` = "Python Community Edition"，`xmlId` = `PythonCore`，vendor = JetBrains）

> ["ANDROID_STUDIO","CLION","DATASPELL","DBE","GOLAND","IDEA","JBCLIENT","PYCHARM","RIDER","RUST","WEBSTORM"]

（`compatible-products` 的原文数组 —— 含 `IDEA`；**注意 Marketplace 的 `IDEA` 表示 IntelliJ IDEA 这个产品（社区版也在内），
`IDEA_PRO` 才表示 Ultimate** —— 判据见 [../../capability-matrix.md](../../capability-matrix.md) §3.2。）

**社区版为什么装得上（本机实测取证）**：插件级依赖 `com.intellij.modules.python-core-capable`，
而 IDEA 社区版平台裁剪包 `lib/intellij.idea.community.customization.jar` 的 `META-INF/IdeaPlugin.xml` 里声明了：

> <module value="com.intellij.modules.python-core-capable" />

（同一张表里还有 `com.intellij.modules.java-capable` 与 `com.intellij.modules.python-in-non-pycharm-ide-capable`；
**没有** `go-capable` / `rust-capable` —— 这就是 Go/Rust 插件在社区版装不上的根因。）
