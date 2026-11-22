# Python 分册 —— 把 Python 项目接进 IntelliJ IDEA

> **本分册是首批（2026-11-20 建册）**：清单 16 条 + IDE 侧设置 6 条，每条都带真跑的 `verify` 与官方引文；TS 分册有 64 条，本册是首批骨架，不是终稿。
> **通用部分不在这里**：机器事实与插件门禁见 `scripts/setup-env.sh`（通用入口）；语言能力档位见 [../../capability-matrix.md](../../capability-matrix.md)；项目形态探测走通用分发器 `scripts/inspect-project.mjs`。

## 先看版本门禁（它决定后面哪些能做）

**Python 在社区版 IDEA 是官方支持的 —— 走 "Python Community Edition" 这个市场条目（id 7322，xmlId `PythonCore`）。**
（此前本册记的「社区版没有 Python 语言插件」是**错的**，2026-11-22 实测更正。）

- Python 在 Marketplace 上有**两个**条目：完整版 id **631**（只发到 `IDEA_PRO`/`JBCLIENT`）与 **Python Community Edition id 7322**（**社区版可装**，功能对标 PyCharm Community）；
- 社区版为什么装得上：IDEA 社区版平台裁剪包 `lib/intellij.idea.community.customization.jar` 声明了 `com.intellij.modules.python-core-capable` —— 插件级硬依赖的正是它；
- **装完实测**：插件加载成功，Index 插件打出 `Python plugin detected via plugin ID (PythonCore)` + `Registered SymbolReferenceHandler for Python`，
  **L0/L1/L2/L3/L5 全可用**（L2 的 `resolvedSymbol.kind` = `function`，L3 能报真语法错，L5 改名 dryRun 返回受影响文件清单）→ 明细见 [runtime.md](runtime.md)；
- 对照组：JS/TS（22069）、Go（9568）、Rust（22407）**社区版都装不上**（机制与判据见 [../../capability-matrix.md](../../capability-matrix.md) §3.1/§3.2）。

⇒ **门禁是"每个插件一行"，不是"每门语言一行"**：同一门语言里，语言插件与工具插件可以落在不同门禁上（Python 的语言插件与 Ruff 工具插件都社区版可装；
JS/TS 的语言插件社区版装不了，但 JavaScript Debugger 这类工具插件可装）。

**装法**：Marketplace 搜 "Python Community Edition" 正常安装即可，**版本必须对上 IDE build**（本机 IDE build 262.12573.28 ↔ 插件 262.12573.28），
装完**重启 IDEA**。

随时复查（**通用**入口）：

```bash
bash scripts/setup-env.sh plugins <IDEA安装根>   # 各语言插件在位情况 + edition 门禁
bash scripts/setup-env.sh probe  <IDEA安装根>   # 机器事实（含 IDEA_PYTHON_PLUGINS / IDEA_PYTHON_GATE）
```

## 三步用法

1. **探测机器**：`bash scripts/setup-env.sh roots` → 问用户 IDEA 装在哪 → `detect <区域>` → `init <安装根>` 写机器本地 `config.json`（不入库、不分发）；复查用 `check`。
2. **装工具链**：`bash scripts/setup-env.sh install-deps --lang python`（模板里的 uv 依赖装到 `.venv`）。不装的话，与执行相关的清单条目无法自证。
3. **接项目**：
   - **已有项目** → `node scripts/inspect-project.mjs <项目目录>` 判语言与形态（`LANG=python` + `PYPROJECT`/`PACKAGE_MANAGER`/`VENV_DIR`/`TEST_RUNNER`/`TYPE_CHECKER`/`LINTER`/`SRC_LAYOUT`），按 `--ids` 输出该形态适用的清单条目；
   - **新项目** → `bash scripts/init-project.sh <目标目录> --lang python --name <包名>`；
   - 然后照 [checklist.json](checklist.json) 与 [idea-settings.json](idea-settings.json) 逐条落配置。

## 模板与版本组合

`templates/py-project` —— src 布局的 Python 项目：`uv` 管依赖与锁文件、`ruff` 管 lint 与 format、`mypy` 管类型、`pytest` 管测试。

| 项 | 取值 | 为什么 |
|---|---|---|
| Python | 3.13（`.python-version` 钉版，与 `requires-python = ">=3.13"` 一致） | 两处版本不一致 → IDE 与命令行跑在不同版本上 |
| 依赖/锁 | `uv` + `uv.lock`（入库） | `uv lock --check` 退出 0 才算依赖可复现 |
| lint + format | `ruff`（`[tool.ruff]`，`select = ["E","F","I","UP","B"]`） | lint 与 format 只有一个工具定义规则，避免两边打架 |
| 类型 | `mypy`（`[tool.mypy]`，`strict = true`，`files = ["src"]`） | Python 的类型权威是 mypy，不是 IDE |
| 测试 | `pytest`（`[tool.pytest.ini_options]`，`pythonpath = ["src"]`） | 测试免安装直接看见 `src/` 里的源码 |
| 项目元数据 | PEP 621 `[project]` | 依赖声明只有一处，IDE 与命令行读同一份 |

## 自证机制（与 TS 分册同机制）

- 清单在 [checklist.json](checklist.json)（项目侧 16 条），每条含 `id / title / category / action / verify / source / quote / applies_to`；
- IDE 侧设置在 [idea-settings.json](idea-settings.json)（6 条，含 `path / expected / assertion / source / quote / edition`）；
- 引文底账在 [sources.md](sources.md)；**每条 quote 必须能逐字命中** —— `node scripts/verify-quotes.mjs --lang python` 机器核验；
- `verify` 是**在本机真跑**的命令，退出 0 才算这一条配好了：`bash scripts/verify-item.sh --lang python <id>`，全量 `--all`；
- IDE 侧条目结构校验：`bash scripts/check-registry-entry.sh --lang python <id>`。

**注意 verify 验的是本技能随附的模板，不是用户的项目。** 接到用户项目上时，`action` 说的是"这一项在目标项目里应该长什么样"，由 agent 对着用户的 pyproject.toml 逐条核对。

## 五个高频坑

- **IDE 与命令行版本分叉**：IDE 的解释器与 `uv run` 的解释器不是同一个 → 现象是"IDE 里不报错、命令行报错"。对策：解释器指向 `.venv`，`.python-version` 与 `requires-python` 对齐。
- **`.venv` 拖垮索引**：几万个文件进索引，IDE 卡住。对策：`.gitignore` 忽略 + IDE 侧 Mark Directory As | Excluded（两处都要）。
- **src 布局下测试导入不到包**：没配 `pythonpath = ["src"]` 时 pytest 直接 ImportError。对策：写在 `[tool.pytest.ini_options]` 里，IDE 与命令行共用。
- **工具版本没钉**：ruff/mypy/pytest 随环境漂移，两台机器结果不同。对策：进 `[dependency-groups].dev`，锁文件入库。
- **装错市场条目**：Marketplace 里搜 "Python" 会先命中**完整版**（id 631，社区版装不上）。社区版要装的是 **"Python Community Edition"（id 7322）** —— 认 xmlId `PythonCore`，别认名字。

## 本册还没做的部分（诚实标注）

| 缺什么 | 影响 | 补法 |
|---|---|---|
| IDE 侧"索引排除"的机器可验证项 | `idea-indexing-excludes` 目前只有结构校验（路径/期望/断言/引文），没有"真的排除了"的机器判据 | 补一条检查 `.idea/*.iml` 里 excludeFolder 的 verify |
| 解释器注册表事实 | `profile.json` 的 `registries` 留空 —— IDEA 侧 Python 解释器注册在哪个 options 文件未取证 | 取证后补（别凭印象写） |
| 多包/工作区形态 | 探测器还没判 uv workspace / 多 pyproject | 按 TS 分册的 `multi-tsconfig` 经验补 `multi-pyproject` 条件 |
| Python 侧"审查→修复流水线" | 流水线（`ide_inspect` 批检视 → 归一化清单 → 分簇 → 并发修）是 JVM 侧能力，Python 仓照搬会拿空清单 | 走 `ruff`/`mypy`/`pytest` 作为权威源（见 setup.md 工具链段） |
