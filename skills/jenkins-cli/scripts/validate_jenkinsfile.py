#!/usr/bin/env python3
"""Jenkinsfile lint：结构骨架 + 硬编码凭据 + 最佳实践分级检查。

只依赖标准库，可在任何装了 Python 3.8+ 的机器上跑。

用法:
    python validate_jenkinsfile.py Jenkinsfile
    python validate_jenkinsfile.py --strict Jenkinsfile
    python validate_jenkinsfile.py --syntax-only Jenkinsfile

退出码:
    0  通过（无 ERROR；--strict 下也不允许 WARNING）
    1  发现 ERROR（--strict 下 WARNING 也算失败）
    2  用法或环境错（文件不存在、参数非法）

stdout 是结果报告，stderr 是过程日志。本脚本只做启发式检查，
不做完整 Groovy 解析——完整校验交给 Jenkins 自己的 Declarative Linter。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ERROR = "ERROR"
WARNING = "WARNING"
INFO = "INFO"

# 硬编码凭据特征：键名 + 引号字面量
SECRET_ASSIGN_RE = re.compile(
    r"""(?ix)
    \b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|pat)\b
    \s*[:=]\s*
    ['"]([^'"]{4,})['"]
    """
)
# 明显的占位符不算硬编码
PLACEHOLDER_RE = re.compile(r"""^(<[^>]*>|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|x{3,}|\*{3,}|changeme|todo|xxx+|null|none)$""", re.I)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN (RSA |OPENSSH |EC |PGP )?PRIVATE KEY-----")

# Groovy 双引号插值把密钥带进 sh
SH_INTERP_RE = re.compile(
    r"""sh\s+"[^"]*\$\{?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}?"""
)
SECRET_NAMES_RE = re.compile(r"(?i)(token|password|passwd|secret|credential|creds|pat|key|pwd)")

DOCKER_LATEST_RE = re.compile(r"docker\s+(?:build|tag)[^\n]*:latest")


def find_block(text: str, keyword: str) -> tuple[int, int]:
    """返回 keyword 后的第一个 {...} 块的范围（start, end），找不到返回 (-1, -1)。"""
    m = re.search(re.escape(keyword) + r"\s*\{", text)
    if not m:
        return (-1, -1)
    start = m.end() - 1
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return (start, i + 1)
    return (start, len(text))


class Report:
    def __init__(self) -> None:
        self.items: list[tuple[str, int, str, str]] = []

    def add(self, level: str, line: int, rule: str, advice: str) -> None:
        self.items.append((level, line, rule, advice))

    def count(self, level: str) -> int:
        return sum(1 for item in self.items if item[0] == level)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, max(index, 0)) + 1


def check_structure(text: str, rep: Report) -> None:
    """结构骨架检查：类型识别 + 声明式必备块 + 块内错放。"""
    if re.search(r"\bpipeline\s*\{", text):
        kind = "declarative"
    elif re.search(r"\bnode\s*[({]", text):
        kind = "scripted"
    else:
        kind = "unknown"
        rep.add(WARNING, 1, "type.unknown",
                "识别不出 pipeline{} / node{}，按 Scripted 保守处理；确认写法后改用声明式")
        return

    if kind == "declarative":
        if not re.search(r"\bstages\s*\{", text):
            rep.add(ERROR, 1, "structure.stages", "声明式缺 stages 块")
        if not re.search(r"\bsteps\s*\{", text):
            rep.add(ERROR, 1, "structure.steps", "声明式缺 steps 块")

        stages_start, stages_end = find_block(text, "stages")
        post_pos = text.find("post")
        if stages_start >= 0 and stages_start < post_pos < stages_end:
            rep.add(ERROR, line_of(text, post_pos), "structure.post_in_stages",
                    "post 写在了 stages 内，应移到 pipeline 层")

        steps_start, steps_end = find_block(text, "steps")
        if steps_start >= 0:
            inner = text[steps_start:steps_end]
            if re.search(r"\binput\s*\{", inner):
                rep.add(ERROR, line_of(text, steps_start), "structure.input_in_steps",
                        "input 放在 steps 里会一直占着 agent，应移到 stage 层")


def check_credentials(text: str, rep: Report) -> None:
    """硬编码凭据扫描。"""
    for m in SECRET_ASSIGN_RE.finditer(text):
        value = m.group(2).strip()
        if PLACEHOLDER_RE.match(value):
            continue
        rep.add(ERROR, line_of(text, m.start()), "credential.hardcoded",
                "疑似硬编码 %s：改走 credentials() / withCredentials" % m.group(1))
    for m in PRIVATE_KEY_RE.finditer(text):
        rep.add(ERROR, line_of(text, m.start()), "credential.private_key",
                "Jenkinsfile 里出现私钥正文，改用 credentials 里的 SSH 私钥")


def check_sh_interpolation(text: str, rep: Report) -> None:
    """Groovy 双引号插值把密钥带进 sh。"""
    for m in SH_INTERP_RE.finditer(text):
        if SECRET_NAMES_RE.search(m.group(1)):
            rep.add(ERROR, line_of(text, m.start()), "credential.sh_interpolation",
                    "双引号 sh 里插值了 %s：密钥会进进程列表/日志，改单引号块让 shell 展开" % m.group(1))


def check_practices(text: str, rep: Report) -> None:
    """最佳实践：WARNING / INFO 级。"""
    if not re.search(r"timeout\s*\(", text):
        rep.add(WARNING, 1, "options.timeout", "缺 timeout，挂死时只能手动掐")
    if "disableConcurrentBuilds" not in text:
        rep.add(WARNING, 1, "options.concurrent", "缺 disableConcurrentBuilds，同一分支并发会互相踩")
    if "archiveArtifacts" in text and "fingerprint" not in text:
        rep.add(WARNING, 1, "post.fingerprint", "archiveArtifacts 缺 fingerprint: true，制品不可追溯")
    if re.search(r"\bparallel\b", text) and "failFast" not in text and "parallelsAlwaysFailFast" not in text:
        rep.add(WARNING, 1, "parallel.failfast", "并行块没有 fail-fast")
    if DOCKER_LATEST_RE.search(text):
        rep.add(WARNING, line_of(text, DOCKER_LATEST_RE.search(text).start()), "docker.latest",
                "裸用 :latest 标签，部署结果不可追溯；用 commit+build 号")
    if "docker image prune" not in text and "docker rm" not in text:
        rep.add(WARNING, 1, "docker.cleanup", "没有清理镜像/容器的动作，DooD 产物会堆在宿主")
    if "catchError" in text and "buildResult" not in text:
        rep.add(WARNING, 1, "error.swallowed", "catchError 没设 buildResult，错误被吞掉不记结果")
    if "buildDiscarder" not in text:
        rep.add(INFO, 1, "options.discarder", "缺 buildDiscarder，工作区会越积越多")
    if "timestamps" not in text:
        rep.add(INFO, 1, "options.timestamps", "缺 timestamps，日志时间戳对不上排障")
    if "cleanWs" not in text:
        rep.add(INFO, 1, "post.cleanws", "缺 cleanWs()，工作区残留")
    if "junit" not in text:
        rep.add(INFO, 1, "post.junit", "没有归档测试报告")
    if not re.search(r"\binput\s*\{", text):
        rep.add(INFO, 1, "deploy.gate", "没有 input 人工审批门")


def validate(path: Path, syntax_only: bool) -> Report:
    rep = Report()
    text = path.read_text(encoding="utf-8", errors="replace")
    check_structure(text, rep)
    if not syntax_only:
        check_credentials(text, rep)
        check_sh_interpolation(text, rep)
        check_practices(text, rep)
    return rep


def render(path: Path, rep: Report, strict: bool) -> None:
    order = {ERROR: 0, WARNING: 1, INFO: 2}
    print("Jenkinsfile lint: %s" % path)
    if not rep.items:
        print("  通过：没有发现问题")
    for level, line, rule, advice in sorted(rep.items, key=lambda i: (order[i[0]], i[1])):
        print("  %-7s L%-4d %-28s %s" % (level, line, rule, advice))
    print("  合计: ERROR=%d WARNING=%d INFO=%d"
          % (rep.count(ERROR), rep.count(WARNING), rep.count(INFO)))
    if strict and rep.count(WARNING):
        print("  --strict：WARNING 也算失败")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="校验 Jenkinsfile：结构骨架 + 硬编码凭据 + 最佳实践（只依赖标准库）")
    parser.add_argument("jenkinsfile", help="Jenkinsfile 路径")
    parser.add_argument("--strict", action="store_true", help="WARNING 也算失败")
    parser.add_argument("--syntax-only", action="store_true", help="只做结构骨架检查")
    args = parser.parse_args(argv)

    path = Path(args.jenkinsfile)
    if not path.is_file():
        print("错误：文件不存在：%s" % path, file=sys.stderr)
        return 2

    print("[lint] 读取 %s" % path, file=sys.stderr)
    rep = validate(path, args.syntax_only)
    render(path, rep, args.strict)

    if rep.count(ERROR):
        return 1
    if args.strict and rep.count(WARNING):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
