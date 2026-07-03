#!/usr/bin/env python3
"""公共日期解析：ISO + 中文（YYYY年M月D日[H时M分][（北京时间）]）+ 无法识别返回 None。

本文件在 bid-auditor 与 qualification-binder 两个 skill 各存一份字节相同的副本
（skill 独立部署、无跨 skill import 先例），由 tests/test_dates.py 的一致性断言防漂移。
改其中一份时务必同步另一份。"""
import re
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))

_CN_RE = re.compile(
    r"(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})[时点](\d{1,2})分?)?"
)


def parse_dt(s):
    """解析为带时区的 datetime；无法识别返回 None（不抛异常，不阻断管线）。"""
    if not s:
        return None
    m = _CN_RE.search(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        hh = int(m.group(4)) if m.group(4) else 0
        mm = int(m.group(5)) if m.group(5) else 0
        try:
            return datetime(y, mo, d, hh, mm, tzinfo=CST)
        except ValueError:
            return None
    s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.fromisoformat(s + "T00:00:00")
        except ValueError:
            return None
    return dt.replace(tzinfo=CST) if dt.tzinfo is None else dt
