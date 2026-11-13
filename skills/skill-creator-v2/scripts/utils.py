"""Shared utilities for skill-creator scripts.

解析逻辑统一收敛到 skill_schema.py（skill 定义的固有 schema），
本模块只保留对外的薄封装，避免出现多份互相漂移的 frontmatter 解析器。
"""

from pathlib import Path

try:  # 作为包导入：python -m scripts.improve_description
    from .skill_schema import parse_frontmatter
except ImportError:  # 直接当脚本跑：python scripts/improve_description.py
    from skill_schema import parse_frontmatter


def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    """Parse a SKILL.md file, returning (name, description, full_content)."""
    content = (Path(skill_path) / "SKILL.md").read_text(encoding="utf-8")
    frontmatter, _, error = parse_frontmatter(content)
    if error:
        raise ValueError("SKILL.md missing frontmatter (%s)" % error)
    fm = frontmatter or {}
    name = fm.get("name", "")
    description = fm.get("description", "")
    return str(name).strip(), str(description).strip(), content
