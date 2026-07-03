# SPDX-License-Identifier: Apache-2.0
"""Coerce LLM-produced tender.json fields into the shapes the frozen vendor
scripts hard-index. qwen emits partial/variant shapes (scoring as a dict or
with missing id/weight/category; required_outline items as bare strings) that
would KeyError/AttributeError the deterministic build/audit. These helpers fill
safe defaults so the vendored scripts cannot crash on partial LLM output. Used
by both outline_pipeline (build_outline) and audit_service (run_audit)."""

# Category values that mean "price" and must be excluded from scoring coverage.
_PRICE_CATEGORIES = {"price", "价格", "报价"}


def normalize_scoring(tender: dict) -> list:
    """Coerce scoring into a list where each item carries id/item/weight/category.

    ``check_coverage.py`` / ``build_outline.py`` iterate ``tender["scoring"]`` as
    a list and index ``id``/``item``/``weight``/``category``; qwen variously emits
    scoring as a dict (``{"weights", "items"}``), omits ``id``/``weight`` (using
    ``code``/``score``), or drops ``category``.
    """
    raw = tender.get("scoring")
    if isinstance(raw, dict):
        items = raw.get("items", [])
    elif isinstance(raw, list):
        items = raw
    else:
        items = []
    normalized = []
    for i, s in enumerate(items):
        if not isinstance(s, dict):
            continue
        sid = s.get("id") or s.get("code") or f"S{i + 1}"
        category = s.get("category")
        if category in (None, ""):
            category = "技术"
        elif category in _PRICE_CATEGORIES:
            category = "价格"
        weight = s.get("weight")
        if weight in (None, "", 0):
            weight = s.get("score", 0)
        item = s.get("item") or s.get("name") or s.get("target_section") or sid
        normalized.append(
            {**s, "id": sid, "category": category, "weight": weight, "item": item}
        )
    return normalized


def normalize_qualifications(quals):
    """Coerce tender.qualifications into a flat list of dicts.

    ``qualification_ids_matching`` iterates ``tender["qualifications"]`` and calls
    ``qual.get("type"/"desc"/"evidence")`` on each entry. qwen variously emits it
    as a list of bare strings, or a dict-of-lists
    (``{"basic_qualifications": [...], ...}``) whose iteration yields the string
    keys. Flatten the dict form and wrap string items as ``{"desc": str}``.
    """

    def coerce(items):
        return [
            {"desc": q} if isinstance(q, str) else q
            for q in items
            if isinstance(q, (str, dict))
        ]

    if isinstance(quals, dict):
        out = []
        for v in quals.values():
            if isinstance(v, list):
                out += coerce(v)
        return out
    if isinstance(quals, list):
        return coerce(quals)
    return quals


def normalize_required_outline(ro):
    """Coerce required_outline list items into dicts.

    ``build_front_sections`` indexes ``item.get("title")`` on each entry, but qwen
    sometimes emits the list items (e.g. front_matter) as bare strings.
    """

    def coerce_list(items):
        return [{"title": x} if isinstance(x, str) else x for x in items]

    if isinstance(ro, dict):
        return {k: coerce_list(v) if isinstance(v, list) else v for k, v in ro.items()}
    if isinstance(ro, list):
        return coerce_list(ro)
    return ro
