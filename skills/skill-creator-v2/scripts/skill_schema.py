#!/usr/bin/env python3
"""Skill 定义的固有解析逻辑（schema）。

被 validate_skill.py / split_skill.py / scaffold_skill.py / quick_validate.py 共用。
只依赖标准库：PyYAML 可用则用，缺失则退化到内置的最小 YAML 解析器，
保证在裸 Python 环境下也能解析 SKILL.md frontmatter。

术语
----
frontmatter  SKILL.md 顶部的 `---` YAML 块，承载 name / description 等元数据
body         frontmatter 之后的正文，是 agent 触发后才会读进上下文的部分
reference    references/ 下的文档，按需读取，用于承载 SKILL.md 放不下的细节
script       scripts/ 下的可执行程序，固化确定性流程，避免每次让模型重写代码
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# --------------------------------------------------------------------------
# 常量：skill 定义的固有 schema
# --------------------------------------------------------------------------

FRONTMATTER_DELIM = "---"

# frontmatter 允许出现的顶层键
ALLOWED_FRONTMATTER_KEYS = frozenset(
    {"name", "description", "license", "allowed-tools", "metadata", "compatibility"}
)
REQUIRED_FRONTMATTER_KEYS = ("name", "description")

MAX_NAME_LEN = 64
MAX_DESCRIPTION_LEN = 1024
MAX_COMPATIBILITY_LEN = 500

# 本仓约定：SKILL.md 正文行数上限（不含 frontmatter）
DEFAULT_SKILL_MD_MAX_LINES = 150

# references/ 下的单文件行数上限；超过应继续拆分
MAX_REFERENCE_LINES = 300

# references/ 下免于「必须被正文引用」检查的文件（索引与目录说明）
EXEMPT_REFERENCE_NAMES = frozenset({"INDEX.md", "README.md"})

# scripts/ 下免于「必须被正文引用」检查的文件（包标记）
EXEMPT_SCRIPT_NAMES = frozenset({"__init__.py"})

# 本仓约定：每个 SKILL.md 末尾必须带仓库级反馈入口，随技能分发到任何机器
FEEDBACK_URL = "https://github.com/monsterbude123/holy-agents-kits/issues/new"
FEEDBACK_FOOTER_PREFIX = "> 反馈："

# SKILL.md 正文里不允许内嵌可执行代码块——代码必须落在 scripts/
CODE_FENCE_LANGUAGES = ("python", "py", "bash", "sh", "shell", "javascript", "ts", "typescript")

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.DOTALL)
FENCED_BLOCK_RE = re.compile(
    r"^```([A-Za-z0-9_+-]*)[ \t]*$.*?^```[ \t]*$", re.MULTILINE | re.DOTALL
)
REFERENCE_LINK_RE = re.compile(r"references/([A-Za-z0-9_./-]+\.md)")
SCRIPT_LINK_RE = re.compile(r"scripts/([A-Za-z0-9_./-]+\.py)")


# --------------------------------------------------------------------------
# YAML 解析：PyYAML 优先，缺失时退化
# --------------------------------------------------------------------------


def _minimal_yaml(text: str) -> Dict[str, str]:
    """最小 YAML 解析：只处理顶层 `key: value` 与 `key: >` / `key: |` 块标量。

    足以覆盖本仓的 frontmatter（name / description 等单行或块文本字段）。
    """
    data: Dict[str, str] = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        i += 1
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw[:1] in (" ", "\t", "-"):
            # 嵌套结构（metadata 等）最小解析器不处理，整体跳过
            continue
        if ":" not in raw:
            continue
        key, _, value = raw.partition(":")
        key = key.strip()
        value = value.strip()
        if value in (">", "|", ">-", "|-"):
            block: List[str] = []
            while i < len(lines) and (not lines[i].strip() or lines[i][:1] in (" ", "\t")):
                block.append(lines[i].strip())
                i += 1
            joined = " ".join(x for x in block if x) if value.startswith(">") else "\n".join(block)
            data[key] = joined.strip()
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        data[key] = value
    return data


def parse_frontmatter(content: str) -> Tuple[Optional[Dict], str, Optional[str]]:
    """切分 SKILL.md 内容。

    返回 (frontmatter_dict | None, body, error | None)。
    frontmatter_dict 为 None 表示没有合法的 frontmatter 块。
    """
    match = FRONTMATTER_RE.match(content)
    if not match:
        # 允许 frontmatter 出现在文件开头之外的情况被明确判错
        return None, content, "缺少 YAML frontmatter（文件应以 `---` 开头）"

    raw_fm = match.group(1)
    body = content[match.end():]

    try:
        import yaml  # type: ignore

        loaded = yaml.safe_load(raw_fm)
        if loaded is None:
            loaded = {}
        if not isinstance(loaded, dict):
            return None, body, "frontmatter 必须是 YAML 字典"
        return loaded, body, None
    except ImportError:
        return _minimal_yaml(raw_fm), body, None
    except Exception as exc:  # yaml.YAMLError 及其他
        return None, body, "frontmatter YAML 解析失败：%s" % exc


# --------------------------------------------------------------------------
# 数据结构
# --------------------------------------------------------------------------


@dataclass
class Issue:
    level: str  # "error" | "warn"
    code: str
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {"level": self.level, "code": self.code, "message": self.message}


@dataclass
class Section:
    """SKILL.md 正文的章节（按标题切分）。"""

    title: str
    level: int
    start: int  # 在 body 中的起始行号（0 基）
    end: int  # 在 body 中的结束行号（不含）
    lines: List[str] = field(default_factory=list)

    @property
    def line_count(self) -> int:
        return len(self.lines)


@dataclass
class SkillInfo:
    path: Path
    frontmatter: Dict[str, object]
    body: str
    body_lines: List[str]
    issues: List[Issue] = field(default_factory=list)
    sections: List[Section] = field(default_factory=list)
    referenced_references: Set[str] = field(default_factory=set)
    referenced_scripts: Set[str] = field(default_factory=set)

    # -- 便捷属性 ---------------------------------------------------------
    @property
    def name(self) -> str:
        value = self.frontmatter.get("name")
        return value.strip() if isinstance(value, str) else ""

    @property
    def description(self) -> str:
        value = self.frontmatter.get("description")
        return value.strip() if isinstance(value, str) else ""

    @property
    def body_line_count(self) -> int:
        return len(self.body_lines)

    @property
    def references_dir(self) -> Path:
        return self.path / "references"

    @property
    def scripts_dir(self) -> Path:
        return self.path / "scripts"

    def reference_files(self) -> List[Path]:
        if not self.references_dir.is_dir():
            return []
        return sorted(p for p in self.references_dir.rglob("*.md") if p.is_file())

    def script_files(self) -> List[Path]:
        if not self.scripts_dir.is_dir():
            return []
        return sorted(p for p in self.scripts_dir.rglob("*.py") if p.is_file())

    def relative(self, target: Path) -> str:
        try:
            return str(target.relative_to(self.path)).replace("\\", "/")
        except ValueError:
            return str(target).replace("\\", "/")


# --------------------------------------------------------------------------
# 章节切分
# --------------------------------------------------------------------------


def split_sections(body_lines: List[str], split_level: int = 2) -> List[Section]:
    """按 Markdown 标题把正文切成章节。

    只在 `split_level` 及以上的标题处切分（H2 为默认），更深的小节（H3/H4）
    跟随所属章节一起搬走——拆分的单位是「一章」，不是一个子标题。

    标题之前的前言内容作为第一个 level=0 的无名章节保留。
    """
    sections: List[Section] = []
    current = Section(title="", level=0, start=0, end=0)
    in_fence = False
    for idx, line in enumerate(body_lines):
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            current.lines.append(line)
            continue
        heading = None if in_fence else re.match(r"^(#{1,6})\s+(.*\S)\s*$", line)
        if heading and len(heading.group(1)) <= split_level:
            current.end = idx
            if current.lines or current.title:
                sections.append(current)
            current = Section(
                title=heading.group(2).strip(),
                level=len(heading.group(1)),
                start=idx,
                end=len(body_lines),
            )
            current.lines.append(line)
        else:
            current.lines.append(line)
    current.end = len(body_lines)
    sections.append(current)
    return [s for s in sections if s.lines]


IMPLEMENTATION_MARKER_RE = re.compile(
    r"^\s*(def\s|class\s|import\s|from\s|function\s|async\s+def\s|const\s|let\s|var\s|public\s|private\s|package\s)"
    r"|=>|#!/",
    re.MULTILINE,
)


def find_code_blocks(body: str) -> List[Tuple[str, str]]:
    """返回正文内嵌的**实现型**代码块 [(language, code)]。

    只调用脚本的命令块（如 `python scripts/x.py --all`）是允许的——正文要留调用方式。
    判定依据是块内是否出现函数/类/导入等实现特征。
    """
    blocks: List[Tuple[str, str]] = []
    for match in FENCED_BLOCK_RE.finditer(body):
        language = (match.group(1) or "").strip().lower()
        code = match.group(0)
        if language not in CODE_FENCE_LANGUAGES:
            continue
        if IMPLEMENTATION_MARKER_RE.search(code):
            blocks.append((language, code))
    return blocks


# --------------------------------------------------------------------------
# 读取与校验
# --------------------------------------------------------------------------


def load_skill(skill_dir: Path) -> SkillInfo:
    """读取一个技能目录，解析 frontmatter / 正文 / 引用关系。"""
    skill_dir = Path(skill_dir)
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        raise FileNotFoundError("缺少 SKILL.md：%s" % skill_md)

    content = skill_md.read_text(encoding="utf-8")
    frontmatter, body, error = parse_frontmatter(content)

    info = SkillInfo(
        path=skill_dir,
        frontmatter=frontmatter or {},
        body=body,
        body_lines=body.splitlines(),
    )
    if error:
        info.issues.append(Issue("error", "frontmatter", error))
        return info

    info.sections = split_sections(info.body_lines)
    info.referenced_references = set(REFERENCE_LINK_RE.findall(info.body))
    info.referenced_scripts = set(SCRIPT_LINK_RE.findall(info.body))
    return info


def validate_skill(
    skill_dir: Path,
    max_lines: int = DEFAULT_SKILL_MD_MAX_LINES,
    require_feedback: bool = False,
) -> SkillInfo:
    """执行全部校验，返回带 issues 的 SkillInfo。

    require_feedback=True 时额外检查 SKILL.md 末尾的仓库级反馈入口（本仓门禁）。
    """
    skill_dir = Path(skill_dir)
    info = load_skill(skill_dir)

    def add(level: str, code: str, message: str) -> None:
        info.issues.append(Issue(level, code, message))

    # ---- frontmatter 键 ------------------------------------------------
    if info.frontmatter:
        unexpected = sorted(set(info.frontmatter) - ALLOWED_FRONTMATTER_KEYS)
        if unexpected:
            add(
                "error",
                "frontmatter.keys",
                "frontmatter 出现未定义键：%s（允许：%s）"
                % (", ".join(unexpected), ", ".join(sorted(ALLOWED_FRONTMATTER_KEYS))),
            )
        for key in REQUIRED_FRONTMATTER_KEYS:
            if key not in info.frontmatter:
                add("error", "frontmatter.missing", "frontmatter 缺少 `%s`" % key)

    # ---- name ----------------------------------------------------------
    name = info.name
    if not name:
        add("error", "name.empty", "name 为空")
    else:
        if not NAME_RE.match(name):
            add("error", "name.format", "name 必须是 kebab-case（小写字母、数字、单个连字符）：%r" % name)
        if len(name) > MAX_NAME_LEN:
            add("error", "name.length", "name 超过 %d 字符（实际 %d）" % (MAX_NAME_LEN, len(name)))
        if name != skill_dir.name:
            add(
                "error",
                "name.mismatch",
                "name (%s) 与目录名 (%s) 不一致" % (name, skill_dir.name),
            )

    # ---- description ---------------------------------------------------
    description = info.description
    if not description:
        add("error", "description.empty", "description 为空")
    else:
        if len(description) > MAX_DESCRIPTION_LEN:
            add(
                "error",
                "description.length",
                "description 超过 %d 字符（实际 %d）" % (MAX_DESCRIPTION_LEN, len(description)),
            )
        if "<" in description or ">" in description:
            add("error", "description.brackets", "description 不能包含尖括号 < >")
        if len(description) < 40:
            add(
                "warn",
                "description.short",
                "description 偏短（%d 字符），触发描述通常需要写清「做什么 + 何时用」" % len(description),
            )

    # ---- 正文行数 ------------------------------------------------------
    if info.body_line_count > max_lines:
        add(
            "error",
            "body.length",
            "SKILL.md 正文 %d 行，超过上限 %d 行；把溢出内容抽到 references/ 并在原处留引用"
            % (info.body_line_count, max_lines),
        )

    # ---- 引用完整性 ----------------------------------------------------
    for rel in sorted(info.referenced_references):
        if not (skill_dir / "references" / rel).is_file():
            add("error", "reference.missing", "SKILL.md 引用了不存在的 references/%s" % rel)

    for rel in sorted(info.referenced_scripts):
        if not (skill_dir / "scripts" / rel).is_file():
            add("error", "script.missing", "SKILL.md 引用了不存在的 scripts/%s" % rel)

    # ---- 孤儿文件 ------------------------------------------------------
    for path in info.reference_files():
        rel = info.relative(path)
        if path.name in EXEMPT_REFERENCE_NAMES:
            continue  # INDEX.md / README.md 是索引与说明，天然无需在正文点名
        ref_key = rel[len("references/"):] if rel.startswith("references/") else rel
        if ref_key not in info.referenced_references and path.name not in info.referenced_references:
            add("warn", "reference.orphan", "%s 未被 SKILL.md 引用（孤立文档不会被读到）" % rel)
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        if line_count > MAX_REFERENCE_LINES:
            add(
                "warn",
                "reference.length",
                "%s 有 %d 行，超过 %d 行，应继续按主题拆分" % (rel, line_count, MAX_REFERENCE_LINES),
            )

    for path in info.script_files():
        rel = info.relative(path)
        if path.name in EXEMPT_SCRIPT_NAMES:
            continue
        if rel.split("/")[-1] not in info.referenced_scripts:
            add("warn", "script.orphan", "%s 未被 SKILL.md 引用（脚本不会被执行）" % rel)

    # ---- 代码外泄到正文 ------------------------------------------------
    blocks = find_code_blocks(info.body)
    if blocks:
        langs = ", ".join(sorted({lang for lang, _ in blocks}))
        add(
            "error",
            "body.code",
            "SKILL.md 正文内嵌了 %d 段实现型代码（%s）；实现必须固化到 scripts/，正文只留调用方式"
            % (len(blocks), langs),
        )

    # ---- 反馈入口（本仓门禁） ------------------------------------------
    # 放在正文最后一行，技能被复制到任何机器的技能目录时都带着它。
    if require_feedback:
        tail = next((line for line in reversed(info.body_lines) if line.strip()), "")
        if not tail.lstrip().startswith(FEEDBACK_FOOTER_PREFIX) or FEEDBACK_URL not in tail:
            add(
                "error",
                "feedback.footer",
                "SKILL.md 末尾缺少仓库级反馈入口：最后一行应为「%s本技能来自 ...，发现错误、缺步骤或命令跑不通，"
                "直接开 issue：%s」" % (FEEDBACK_FOOTER_PREFIX, FEEDBACK_URL),
            )

    return info


# --------------------------------------------------------------------------
# 仓库扫描
# --------------------------------------------------------------------------


def discover_skill_dirs(root: Path) -> List[Path]:
    """在仓库中找出所有技能目录：`skills/*` 与 `.agents/skills/*`。"""
    root = Path(root)
    found: List[Path] = []
    for container in (root / "skills", root / ".agents" / "skills"):
        if not container.is_dir():
            continue
        for child in sorted(container.iterdir()):
            if child.is_dir() and (child / "SKILL.md").is_file():
                found.append(child)
    return found
