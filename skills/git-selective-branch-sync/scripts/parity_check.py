#!/usr/bin/env python3
"""逐路径完整性核对：目标分支是否把源分支该迁的内容都迁了。

这是选择性搬运里唯一能发现「静默缺口」的机械检查 —— 编译与测试都发现不了
「少迁了一个文件」。典型缺口：报告文档迁了、配套的执行脚本没迁。

比对逻辑:
  - 源分支有、目标分支也有 → 内容是否逐字节相同
      相同   → 已完整迁移
      不同   → 差异（可能是有意取舍，需人工判定）
  - 源分支有、目标分支没有 → 缺失（该迁却漏迁）
  - 源分支没有、目标分支有 → 目标侧独有（正常，不报）

用法:
  python parity_check.py --target main --source feature/old
  python parity_check.py --target main --source feature/old --prefix src api
  python parity_check.py --target main --source feature/old --prefix docs --show-diff
  python parity_check.py --target main --source feature/old --exclude config/local.json

stdout 是核对结果（结果）；stderr 是过程日志。
退出码：0 = 缺失清单为空；1 = 有缺失；2 = 用法错误。
"""
import argparse
import fnmatch
import hashlib
import os
import subprocess
import sys


def run(args, cwd):
    return subprocess.run(args, capture_output=True, cwd=cwd, text=True, errors="replace")


def run_bytes(args, cwd):
    return subprocess.run(args, capture_output=True, cwd=cwd)


def out(args, cwd):
    r = run(args, cwd)
    if r.returncode != 0:
        raise SystemExit(f"命令失败: {' '.join(args)}\n{r.stderr.strip()}")
    return r.stdout


def list_paths(rev, prefix, cwd):
    """某 revision 下、给定前缀下的文件路径集合。"""
    args = ["git", "ls-tree", "-r", "--name-only", rev]
    if prefix:
        args += ["--"] + list(prefix)
    return {p for p in out(args, cwd).splitlines() if p.strip()}


def blob(rev, path, cwd):
    """某 revision 下某路径的原始字节；路径不存在返回 None。"""
    r = run_bytes(["git", "show", f"{rev}:{path}"], cwd)
    if r.returncode != 0:
        return None
    return r.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()[:12]


def matches(path, patterns):
    if not patterns:
        return False
    for pat in patterns:
        if pat.endswith("/"):
            if path.startswith(pat):
                return True
        elif path == pat or fnmatch.fnmatch(path, pat):
            return True
    return False


def main():
    ap = argparse.ArgumentParser(description="逐路径完整性核对：目标分支 vs 源分支")
    ap.add_argument("--target", required=True, help="目标分支（迁入的一边）")
    ap.add_argument("--source", required=True, help="源分支（迁过去的一边）")
    ap.add_argument("--repo", default=None,
                    help="仓库根目录（默认取当前目录所属 git 仓库的根）")
    ap.add_argument("--prefix", nargs="*", default=None,
                    help="只核对这些路径前缀（不给则核对全部）")
    ap.add_argument("--exclude", nargs="*", default=[],
                    help="跳过这些路径（已知刻意不迁的）")
    ap.add_argument("--show-diff", action="store_true",
                    help="对内容不同的路径，打印差异统计")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo) if args.repo else os.getcwd()
    if run(["git", "rev-parse", "--git-dir"], repo).returncode != 0:
        raise SystemExit(f"不是 git 仓库: {repo}")
    repo = out(["git", "rev-parse", "--show-toplevel"], repo).strip()

    for rev in (args.target, args.source):
        if run(["git", "rev-parse", "--verify", rev], repo).returncode != 0:
            raise SystemExit(f"分支不存在: {rev}")

    src_paths = list_paths(args.source, args.prefix, repo)
    tgt_paths = list_paths(args.target, args.prefix, repo)
    print(f"源分支 {args.source}: {len(src_paths)} 个路径", file=sys.stderr)
    print(f"目标分支 {args.target}: {len(tgt_paths)} 个路径", file=sys.stderr)

    excluded, missing, identical, differing = [], [], [], []

    for p in sorted(src_paths):
        if matches(p, args.exclude):
            excluded.append(p)
            continue
        if p not in tgt_paths:
            missing.append(p)
            continue
        a = blob(args.source, p, repo)
        b = blob(args.target, p, repo)
        if a is None:
            continue  # 目标分支上是目录或已删除
        if a == b:
            identical.append(p)
        else:
            differing.append(p)

    print()
    print(f"逐字节相同: {len(identical)}")
    print(f"内容不同  : {len(differing)}  （可能是有意取舍，需人工判定）")
    print(f"目标分支缺失: {len(missing)}  （该迁却漏迁）")
    if excluded:
        print(f"按排除规则跳过: {len(excluded)}")

    if differing:
        print("\n--- 内容不同的路径 ---")
        for p in differing:
            a = blob(args.source, p, repo)
            b = blob(args.target, p, repo)
            print(f"  {p}  (source {digest(a)} / target {digest(b)}, "
                  f"{len(a.splitlines())} vs {len(b.splitlines())} 行)")
            if args.show_diff:
                d = run(["git", "diff", "--stat", args.target, args.source, "--", p], repo)
                if d.returncode == 0 and d.stdout.strip():
                    print("      " + d.stdout.strip().replace("\n", "\n      "))

    if missing:
        print("\n--- 目标分支缺失（该迁却漏迁）---")
        for p in missing:
            print(f"  {p}")
        print("\n补迁命令示例:")
        print(f"  git checkout {args.source} -- " + " ".join(missing[:3]) +
              (" ..." if len(missing) > 3 else ""))

    if excluded:
        print("\n--- 按排除规则跳过（刻意不迁）---")
        for p in excluded:
            print(f"  {p}")

    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
