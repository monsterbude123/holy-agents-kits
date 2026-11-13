#!/usr/bin/env python3
"""生成一个符合本仓规范的技能骨架。

骨架自带三段式正文：骨架流程 / 核心逻辑 / 核心循环，天然控制在 150 行以内。
细节一律先占位到 references/，需要时再展开。

用法：
    python scaffold_skill.py <skills 根目录> <skill-name> --description "一句话说明"
    python scaffold_skill.py .agents/skills my-skill --description "..."
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SKILL_MD_TEMPLATE = """---
name: {name}
description: {description}
---

# {title}

<!--
一句话说明这个技能解决什么问题、边界在哪。
description 决定触发率：写清「做什么」+「什么时候用」，必要时把触发词也列进来。
-->

## §1 骨架流程

<!-- 用 3~5 步写清主干。每步一行，说清输入与产出。 -->

1. **<步骤名>** —— <输入> → <产出>
2. **<步骤名>** —— <输入> → <产出>
3. **<步骤名>** —— <输入> → <产出>

## §2 核心逻辑

<!-- 只写「为什么这么做」「不这么做会怎样」的判断依据，细节进 references/。 -->

- **<判断点>** —— <依据>

## §3 核心循环

<!-- 技能的核心迭代循环；写清每一圈的输入、动作、退出条件。 -->

```
<输入> → <动作> → <校验> → (不通过) 回到 <动作>
                  └→ (通过) <产出>
```

**退出条件**：<何时算完成>

## §4 脚本

<!-- 可执行的确定性流程一律固化到 scripts/，正文只留调用方式。 -->

```bash
python scripts/<name>.py --help
```

## §5 参考文件

<!-- 详细协议、错误码、参数表等按需读取；每条都要写清「什么时候读」。 -->

- `references/<topic>.md` —— <何时读它>
"""

REFERENCES_INDEX_TEMPLATE = """# references 索引

本目录下每个文件都是 SKILL.md 正文的溢出内容，按需读取。

- `<topic>.md` —— <何时读它>
"""

SCRIPTS_README_TEMPLATE = """# scripts

本目录存放固化的可执行程序：把「每次都要重写一遍」的代码固定下来。

要求：
- 只依赖 Python 标准库（除非确实无法替代）
- 提供 `--help`，错误信息写清怎么修
- stdout 输出结果，stderr 输出过程日志
"""


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="生成技能骨架")
    parser.add_argument("root", help="技能父目录，如 skills 或 .agents/skills")
    parser.add_argument("name", help="技能名（kebab-case）")
    parser.add_argument("--description", default="", help="技能描述")
    parser.add_argument("--title", default="", help="技能中文标题（默认用 name）")
    parser.add_argument("--force", action="store_true", help="目录已存在时覆盖 SKILL.md")
    args = parser.parse_args(argv)

    name = slugify(args.name)
    if not name:
        print("错误：技能名非法。", file=sys.stderr)
        return 2

    skill_dir = Path(args.root) / name
    skill_md = skill_dir / "SKILL.md"
    if skill_md.exists() and not args.force:
        print("错误：%s 已存在（加 --force 覆盖）。" % skill_md, file=sys.stderr)
        return 2

    description = args.description or "<一句话说明：做什么 + 什么时候用>"
    title = args.title or name

    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "references").mkdir(exist_ok=True)
    (skill_dir / "scripts").mkdir(exist_ok=True)

    skill_md.write_text(
        SKILL_MD_TEMPLATE.format(name=name, description=description, title=title),
        encoding="utf-8",
    )
    (skill_dir / "references" / "INDEX.md").write_text(REFERENCES_INDEX_TEMPLATE, encoding="utf-8")
    (skill_dir / "scripts" / "README.md").write_text(SCRIPTS_README_TEMPLATE, encoding="utf-8")

    print("已生成技能骨架：%s" % skill_dir)
    print("  SKILL.md（%d 行）" % len(skill_md.read_text(encoding="utf-8").splitlines()))
    print("  references/INDEX.md、scripts/README.md")
    print("下一步：填 §1~§3，把细节写进 references/，把可执行流程写进 scripts/。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
