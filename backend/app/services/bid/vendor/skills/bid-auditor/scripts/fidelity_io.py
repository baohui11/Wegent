#!/usr/bin/env python3
"""保真核验黑板文件读写：tasks（确定性脚本产出，核稿官只读）与 verdicts（核稿官产出）。"""
import json
from pathlib import Path


def write_tasks(path, stage, tasks):
    """写 _fidelity_tasks.json。tasks 为 dict 列表，每条至少含 id/type/claim/candidate_sources。"""
    Path(path).write_text(
        json.dumps(
            {"stage": stage, "tasks": list(tasks)}, ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )


def load_verdicts(paths):
    """读一个或多个 verdict 分片，合并成 {task_id: verdict_dict}；缺失分片跳过。"""
    merged = {}
    for p in paths:
        p = Path(p)
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        # 兼容两种核稿官输出：{"verdicts":[...]} 包装 或 裸 [...]
        verdicts = (
            data.get("verdicts", [])
            if isinstance(data, dict)
            else (data if isinstance(data, list) else [])
        )
        for v in verdicts:
            if isinstance(v, dict) and v.get("id"):
                merged[v["id"]] = v
    return merged
