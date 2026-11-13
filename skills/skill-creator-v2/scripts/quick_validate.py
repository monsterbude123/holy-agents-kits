#!/usr/bin/env python3
"""快速校验技能目录。

薄封装：全部判定规则集中在 scripts/skill_schema.py，这里只负责命令行交互。
用法：
    python quick_validate.py <skill_directory>
退出码：0 通过；1 不通过。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from skill_schema import validate_skill  # noqa: E402


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        print("Usage: python quick_validate.py <skill_directory>")
        return 2

    try:
        info = validate_skill(Path(argv[0]), require_feedback=True)
    except FileNotFoundError as exc:
        print(str(exc))
        return 1

    errors = [i for i in info.issues if i.level == "error"]
    warns = [i for i in info.issues if i.level == "warn"]

    if not errors and not warns:
        print("Skill is valid! (%s, %d lines)" % (info.name, info.body_line_count))
        return 0

    for issue in errors:
        print("[ERROR] %s: %s" % (issue.code, issue.message))
    for issue in warns:
        print("[WARN ] %s: %s" % (issue.code, issue.message))
    print("Skill is invalid: %d error(s), %d warning(s)" % (len(errors), len(warns)))
    return 1


if __name__ == "__main__":
    sys.exit(main())
