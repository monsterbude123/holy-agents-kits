#!/usr/bin/env python3
"""情绪中性化的机械校验与温度值计算（纯标准库）。

规范见 references/emotional-neutralizer.md；产出模板与调用示例见
templates/emotional-neutralize.md。本文件是那些伪代码的**唯一实现**，
规则改动只改这里，文档只引用不复制。

用法：
  python emotional-neutralize.py verify --original "..." --neutral "..." --annotations a.json
  python emotional-neutralize.py temperature --emotion-score 0.75 --history-count 3 --days-ago 2
  python emotional-neutralize.py self-check --T 3.5
  python emotional-neutralize.py --self-test
stdout 只输出一行 JSON；日志走 stderr；成功退出 0，校验失败退出 1。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Optional, Tuple

EMOTION_WORDS = {
    "zh-CN": {"抱歉", "对不起", "我搞错了", "!", "!", "?", "求求", "到底", "从来", "总是", "再", "又"},
    "en-US": {"sorry", "!", "?", "again", "always", "never", "why"},
    "ja-JP": {"また", "いつも", "なぜ", "!"},
}

PROTECTED_PLACEHOLDERS = {"X", "Y", "Z"}

# 事实实体：只认「机器可断言」的记号 —— 路径 / 含下划线或数字的标识符 / 数字 / 引号内原文。
# 普通英文单词不算（翻译会合法改写它们），情绪词因此不会与「实体必保留」冲突。
_ENTITY_PATTERNS = (
    re.compile(r"[A-Za-z]:[\\/][^\s，。；,;）)]+"),
    re.compile(r"(?:[\w.-]+/)+[\w.-]+"),
    re.compile(r"[A-Za-z_][A-Za-z0-9_]*[0-9_][A-Za-z0-9_]*"),
    re.compile(r"\d+(?:\.\d+)?"),
    re.compile(r"[「“\"']([^」”\"']{1,60})[」”\"']"),
)


def extract_entities(text: str) -> list[str]:
    """抽出必须原样保留的事实记号（路径 / 标识符 / 数字 / 引文）。"""
    found: list[str] = []
    for pattern in _ENTITY_PATTERNS:
        for match in pattern.finditer(text or ""):
            token = match.group(1) if match.groups() else match.group(0)
            if token not in found:
                found.append(token)
    return found


def compute_temperature(
    emotion_score: float, history_count: int, last_incident_days_ago: int
) -> Tuple[float, str, float, float]:
    """返回 (T, attention_level, accumulation_factor, history_weight)。"""
    if history_count <= 0:
        acc = 1.0
    elif history_count <= 2:
        acc = 1.5
    elif history_count <= 5:
        acc = 2.5
    else:
        # ≥6 次之后继续线性累积。原公式封顶 3.5 时，T 的上限是
        # emotion_score(≤1) × 3.5 × history_weight(≤1) = 3.5，
        # 🔥 红区(6~10) 与 🚨 危机(>10) 两级永远触发不了，安全升级等于失灵。
        acc = 3.5 + 0.5 * (history_count - 5)

    if last_incident_days_ago <= 7:
        hw = 1.0
    elif last_incident_days_ago <= 30:
        hw = 0.8
    elif last_incident_days_ago <= 90:
        hw = 0.5
    else:
        hw = 0.3

    t = emotion_score * acc * hw
    if t < 0.3:
        level = "🟢 冷区"
    elif t < 1.0:
        level = "🟡 微温"
    elif t < 3.0:
        level = "🟠 热区"
    elif t < 6.0:
        level = "🔴 灼热"
    elif t < 10.0:
        level = "🔥 红区"
    else:
        level = "🚨 危机"
    return t, level, acc, hw


def check_temperature_consistency(
    emotion_score: float,
    t: float,
    attention_level: str,
    history_count: int,
    last_incident_days_ago: int,
) -> Tuple[bool, str]:
    """标注里的 T 与推导值是否一致（±5% 容差）。"""
    expected_t, expected_level, _, _ = compute_temperature(
        emotion_score, history_count, last_incident_days_ago
    )
    if abs(t - expected_t) / max(expected_t, 0.001) > 0.05:
        return False, f"T={t}, 推导值={expected_t:.3f}, 偏差 > 5%"
    if attention_level != expected_level:
        return False, f"level={attention_level}, 推导={expected_level}"
    return True, "consistent"


def get_agent_self_check_actions(t: float) -> list[str]:
    """按温度值给出 agent 必须执行的自检动作。"""
    actions: list[str] = []
    if t >= 0.3:
        actions.append("写入 LEARNINGS（标注 emotion_score + T）")
    if t >= 1.0:
        actions.append("回查三大铁律，检查本次诉求域是否违反")
    if t >= 3.0:
        actions.append("输出'本次诉求域相关规则冲突清单'")
        actions.append("追加 history_count + last_incident_days_ago 到标注")
    if t >= 6.0:
        actions.append("触发'协议变更建议'（输出 protocol_change_suggestion）")
        actions.append("🛑 停止直接修复，先汇报用户")
    if t > 10.0:
        actions.append("升级到顶层决策，与用户对齐规则冲突黑盒")
    return actions


def verify_neutralization(
    original: str,
    neutral: str,
    annotations: dict[str, Any],
    language: str = "zh-CN",
) -> Tuple[bool, str]:
    """校验中性化产物：通过返回 (True, 'OK')，否则 (False, 原因)。"""
    # 1 事实实体保留
    for placeholder in PROTECTED_PLACEHOLDERS:
        if placeholder in original and placeholder not in neutral:
            return False, f"占位符 {placeholder} 丢失(漏翻)"
    missing = [e for e in extract_entities(original) if e not in neutral]
    if missing:
        return False, f"事实实体丢失: {missing}"

    # 2 情绪词剥干净
    leaked = [w for w in EMOTION_WORDS.get(language, EMOTION_WORDS["zh-CN"]) if w in neutral]
    if leaked:
        return False, f"情绪词残留: {leaked}"

    # 3 透明化标注
    if not annotations.get("stripped"):
        return False, "标注缺 stripped 字段(透明化失败)"

    # 4 温度值必在
    if "temperature" not in annotations:
        return False, "缺 temperature 字段(严重程度信号丢失)"
    block = annotations["temperature"]
    if "value" not in block:
        return False, "温度值缺 value 字段"
    t = block["value"]
    level = block.get("attention_level")
    if not level:
        return False, "温度值缺 attention_level 字段"

    # 5 ~ 7 按温度档位要求附带证据
    if t >= 1.0 and not block.get("agent_self_check_required"):
        return False, "T ≥ 1.0 但 agent_self_check_required 缺失或为 false"
    if t >= 3.0 and block.get("history_count") is None:
        return False, "T ≥ 3.0 但缺 history_count 字段"
    if t >= 6.0 and not block.get("protocol_change_suggestion"):
        return False, "T ≥ 6.0 但缺 protocol_change_suggestion"

    # 8 与推导值一致性（仅在给了 emotion_score 时）
    score = annotations.get("emotion_score")
    if score is not None:
        ok, msg = check_temperature_consistency(
            score,
            t,
            level,
            block.get("history_count", 0),
            block.get("last_incident_days_ago", 999),
        )
        if not ok:
            return False, f"温度值一致性失败: {msg}"
    return True, "OK"


def _run_self_test() -> int:
    """文档里的样例就是这里的断言；改了算法这条必须同步改。"""
    t, level, acc, hw = compute_temperature(0.75, 3, 2)
    assert abs(t - 1.875) < 1e-9 and level == "🟠 热区" and acc == 2.5 and hw == 1.0, (t, level)

    for score, count, days, expected in [
        (0.1, 0, 999, "🟢 冷区"),
        (0.5, 0, 5, "🟡 微温"),
        (0.9, 3, 2, "🟠 热区"),
        (0.9, 6, 7, "🔴 灼热"),
        (1.0, 14, 1, "🔥 红区"),
        (1.0, 20, 1, "🚨 危机"),
    ]:
        _, lvl, _, _ = compute_temperature(score, count, days)
        assert lvl == expected, (score, count, days, lvl, expected)

    raw = "为什么又错了?!你到底会不会?!"
    neutral = "上一步结果与预期不符。请定位根因并修复。"
    good = {
        "emotion_score": 0.75,
        "stripped": ["3 个叹号"],
        "temperature": {
            "value": 1.875,
            "attention_level": "🟠 热区",
            "history_count": 3,
            "last_incident_days_ago": 2,
            "agent_self_check_required": True,
        },
    }
    ok, msg = verify_neutralization(raw, neutral, good)
    assert ok, msg

    bad_cases = [
        ({k: v for k, v in good.items() if k != "temperature"}, "严重程度信号丢失"),
        ({**good, "temperature": {"value": 1.875, "attention_level": "🟠 热区"}}, "agent_self_check_required"),
        (
            {**good, "temperature": {"value": 6.65, "attention_level": "🔥 红区",
                                    "history_count": 7, "agent_self_check_required": True}},
            "protocol_change_suggestion",
        ),
        ({**good, "stripped": []}, "stripped"),
        ({**good, "temperature": {**good["temperature"], "history_count": None, "value": 3.5,
                                 "attention_level": "🔴 灼热"}}, "history_count"),
    ]
    for annotations, needle in bad_cases:
        ok, msg = verify_neutralization(raw, neutral, annotations)
        assert not ok and needle in msg, (needle, msg)

    # 实体保留 / 情绪词残留
    ok, msg = verify_neutralization("改 publish/cli.py 的 deploy 函数", "改 cli.py 里的函数", good)
    assert not ok and "事实实体丢失" in msg, msg
    ok, msg = verify_neutralization(raw, "到底为什么又错了", good)
    assert not ok and "情绪词残留" in msg, msg

    assert get_agent_self_check_actions(1.9)[:2] == [
        "写入 LEARNINGS（标注 emotion_score + T）",
        "回查三大铁律，检查本次诉求域是否违反",
    ]
    assert get_agent_self_check_actions(6.5)[-1] == "🛑 停止直接修复，先汇报用户"
    assert get_agent_self_check_actions(0.1) == []

    print(json.dumps({"ok": True, "data": {"cases": "16 断言通过"}}, ensure_ascii=False))
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="情绪中性化校验与温度值计算")
    parser.add_argument("--self-test", action="store_true", help="跑内置断言后退出")
    sub = parser.add_subparsers(dest="cmd")

    p_verify = sub.add_parser("verify", help="校验中性化产物")
    p_verify.add_argument("--original", required=True)
    p_verify.add_argument("--neutral", required=True)
    p_verify.add_argument("--annotations", required=True, help="标注 JSON 文件路径")
    p_verify.add_argument("--language", default="zh-CN")

    p_temp = sub.add_parser("temperature", help="计算温度值")
    p_temp.add_argument("--emotion-score", type=float, required=True)
    p_temp.add_argument("--history-count", type=int, default=0)
    p_temp.add_argument("--days-ago", type=int, default=999)

    p_check = sub.add_parser("self-check", help="按温度值给自检动作")
    p_check.add_argument("--T", dest="t", type=float, required=True)

    args = parser.parse_args(argv)
    if args.self_test:
        return _run_self_test()
    if args.cmd == "temperature":
        t, level, acc, hw = compute_temperature(args.emotion_score, args.history_count, args.days_ago)
        print(json.dumps({"ok": True, "data": {"T": round(t, 4), "attention_level": level,
                                               "accumulation_factor": acc, "history_weight": hw}},
                         ensure_ascii=False))
        return 0
    if args.cmd == "self-check":
        print(json.dumps({"ok": True, "data": get_agent_self_check_actions(args.t)}, ensure_ascii=False))
        return 0
    if args.cmd == "verify":
        try:
            with open(args.annotations, "r", encoding="utf-8-sig") as f:
                annotations = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(json.dumps({"ok": False, "error": f"读不到标注 JSON: {e}"}, ensure_ascii=False))
            return 1
        ok, msg = verify_neutralization(args.original, args.neutral, annotations, args.language)
        print(json.dumps({"ok": ok, "data": msg} if ok else {"ok": False, "error": msg},
                         ensure_ascii=False))
        return 0 if ok else 1

    parser.print_help(sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
