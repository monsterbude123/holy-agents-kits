#!/usr/bin/env python3
"""三方合并驱动：把源分支的改动叠加到目标分支，保住目标分支的既有改动。

用 git merge-file 做三方合并（base=共同祖先、ours=目标分支、theirs=源分支），
只有双方改同一行才产生冲突标记；其余改动自动合上。

用法:
  python merge3way.py --target main --source feature/old
  python merge3way.py --target main --source feature/old --dry-run
  python merge3way.py --target main --source feature/old --only src api
  python merge3way.py --target main --source feature/old --exclude docs/ vendor/

stdout 是分类结果与冲突清单（结果）；stderr 是过程日志。
"""
import argparse
import os
import subprocess
import sys
import tempfile


def run(args, cwd):
    return subprocess.run(args, capture_output=True, cwd=cwd, text=True, errors="replace")


def run_bytes(args, cwd):
    return subprocess.run(args, capture_output=True, cwd=cwd)


def out(args, cwd):
    r = run(args, cwd)
    if r.returncode != 0:
        raise SystemExit(f"命令失败: {' '.join(args)}\n{r.stderr}")
    return r.stdout


def show(rev, path, cwd):
    """某个 revision 下某路径的原始字节。保留二进制内容，不做文本解码。"""
    r = run_bytes(["git", "show", f"{rev}:{path}"], cwd)
    if r.returncode != 0:
        raise SystemExit(f"读取失败: {rev}:{path}\n{r.stderr.decode('utf-8', 'replace')}")
    return r.stdout


def write_path(repo, rel, data):
    dest = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(data)


def main():
    ap = argparse.ArgumentParser(description="三方合并：源分支 → 目标分支")
    ap.add_argument("--target", required=True, help="目标分支（保留它自己的改动）")
    ap.add_argument("--source", required=True, help="源分支（要并过去的一边）")
    ap.add_argument("--repo", default=".", help="仓库根目录")
    ap.add_argument("--only", nargs="*", default=None, help="只处理这些路径前缀")
    ap.add_argument("--exclude", nargs="*", default=[], help="跳过这些路径前缀")
    ap.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    ap.add_argument("--both-added", choices=["skip", "take-source"], default="skip",
                    help="双方各自新增同名文件时的处理：skip=跳过待人工判定（默认），"
                         "take-source=直接取源分支版本")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    if run(["git", "rev-parse", "--git-dir"], repo).returncode != 0:
        raise SystemExit(f"不是 git 仓库: {repo}")

    base = out(["git", "merge-base", args.target, args.source], repo).strip()
    print(f"merge-base: {base}", file=sys.stderr)

    # 源分支相对共同祖先改过的文件集合。
    # 用集合差（diff base..source），不要用提交区间：fork 历史非线性时
    # 区间外的提交内容不在区间末态里，用区间会漏掉整块改动。
    touched = {p for p in out(["git", "diff", "--name-only", base, args.source], repo).splitlines()
               if p.strip()}

    def wanted(p):
        if args.only and not any(p.startswith(x) for x in args.only):
            return False
        if any(p.startswith(x) for x in args.exclude):
            return False
        return True

    todo = sorted(p for p in touched if wanted(p))
    print(f"源分支改动文件 {len(touched)}，本轮处理 {len(todo)}", file=sys.stderr)

    tmp = tempfile.mkdtemp(prefix="merge3way-")
    merged, added, conflicts, skipped = [], [], [], []

    for p in todo:
        has_theirs = run(["git", "cat-file", "-e", f"{args.source}:{p}"], repo).returncode == 0
        if not has_theirs:
            skipped.append((p, "源分支已删除"))
            continue
        has_ours = run(["git", "cat-file", "-e", f"{args.target}:{p}"], repo).returncode == 0
        has_base = run(["git", "cat-file", "-e", f"{base}:{p}"], repo).returncode == 0

        if not has_ours:
            # 源分支独有：目标分支没有 → 直接取源分支版本，零冲突。
            added.append(p)
            if not args.dry_run:
                write_path(repo, p, show(args.source, p, repo))
            continue

        src_bytes = show(args.source, p, repo)
        tgt_bytes = show(args.target, p, repo)

        if not has_base:
            # 两边各自新增同名文件（共同祖先没有它）。
            # 先比内容：内容相同说明目标分支已迁过这个文件，不是冲突。
            if src_bytes == tgt_bytes:
                merged.append(p)
                continue
            if args.both_added == "take-source":
                added.append(p)
                if not args.dry_run:
                    write_path(repo, p, src_bytes)
            else:
                skipped.append((p, "双方各自新增且内容不同，需人工判定"))
            continue

        base_bytes = show(base, p, repo)

        # 二进制文件不能用文本三方合并，否则会写坏内容。
        if b"\0" in src_bytes or b"\0" in tgt_bytes or b"\0" in base_bytes:
            if src_bytes == base_bytes:
                merged.append(p)          # 目标分支已改过，天然保留
            elif tgt_bytes == base_bytes:
                merged.append(p)          # 源分支单边改动，直接取
                if not args.dry_run:
                    write_path(repo, p, src_bytes)
            else:
                skipped.append((p, "二进制文件双方都改过，需人工取一边"))
            continue

        b_path = os.path.join(tmp, "b")
        o_path = os.path.join(tmp, "o")
        t_path = os.path.join(tmp, "t")
        for path, data in ((b_path, base_bytes), (o_path, tgt_bytes), (t_path, src_bytes)):
            with open(path, "wb") as fh:
                fh.write(data)

        r = subprocess.run(["git", "merge-file", "-p", "--diff3",
                            "-L", args.target, "-L", "base", "-L", args.source,
                            o_path, b_path, t_path],
                           capture_output=True, cwd=repo)
        if r.returncode == 0:
            merged.append(p)
            if not args.dry_run:
                write_path(repo, p, r.stdout)
        elif r.returncode == 1:
            # 带 <<<<<<< / ======= / >>>>>>> 标记落盘，交给人工解冲突。
            conflicts.append(p)
            if not args.dry_run:
                write_path(repo, p, r.stdout)
        else:
            skipped.append((p, f"merge-file 失败（退出码 {r.returncode}），需人工处理"))

    print(f"\n干净三方合并: {len(merged)}")
    print(f"源分支独有(直接取): {len(added)}")
    print(f"冲突待人工解: {len(conflicts)}")
    print(f"跳过: {len(skipped)}")
    if conflicts:
        print("\n冲突清单:")
        for p in conflicts:
            print(f"  {p}")
    if skipped:
        print("\n跳过明细:")
        for p, why in skipped:
            print(f"  {p}  ({why})")
    if conflicts and not args.dry_run:
        print("\n冲突文件已带 <<<<<<< 标记写入工作区，逐个解完后复查零残留。", file=sys.stderr)

    try:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
