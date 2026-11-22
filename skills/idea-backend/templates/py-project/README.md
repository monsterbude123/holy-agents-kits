# py-project —— IDEA 多语言后端 · Python 分册模板

这个模板是 `idea-backend` 技能 Python 分册的"标准答案"：每条清单条目的 `verify` 都在这个模板上真跑。

## 常用命令

```bash
uv sync                # 装依赖（用 uv.lock 复现）
uv run ruff check .    # lint 门禁
uv run ruff format --check .
uv run mypy             # 类型门禁
uv run pytest           # 测试门禁
```

## 约定

- 依赖与工具链全部声明在 `pyproject.toml`（PEP 621）；开发依赖在 `[dependency-groups].dev`。
- 版本钉在 `.python-version`，与 `requires-python` 保持一致。
- 源码在 `src/<包名>/`，测试在 `tests/`；pytest 通过 `pythonpath = ["src"]` 直接可见源码。
- `uv.lock` 入库 → 依赖可复现；`.venv/` 不入库。
