# SPDX-License-Identifier: Apache-2.0
"""Coerce LLM-produced tender.json fields into the shapes the frozen vendor
scripts hard-index. qwen emits partial/variant shapes (scoring as a dict or
with missing id/weight/category; required_outline items as bare strings) that
would KeyError/AttributeError the deterministic build/audit. These helpers fill
safe defaults so the vendored scripts cannot crash on partial LLM output. Used
by both outline_pipeline (build_outline) and audit_service (run_audit)."""

from app.services.bid.workspace import BidWorkspace

# Category values that mean "price" and must be excluded from scoring coverage.
_PRICE_CATEGORIES = {"price", "价格", "报价"}


def normalize_scoring(tender: dict) -> list:
    """Coerce scoring into a list where each item carries id/item/weight/category.

    ``check_coverage.py`` / ``build_outline.py`` iterate ``tender["scoring"]`` as
    a list and index ``id``/``item``/``weight``/``category``; qwen variously emits
    scoring as a dict (``{"weights", "items"}``), omits ``id``/``weight`` (using
    ``code``/``score``), or drops ``category``. Also flattens the bucketed shape
    ``{tech_items, biz_items, price_items}`` qwen emits, mapping each item's
    title/max_score to item/weight and tagging price_items as 价格.
    """
    raw = tender.get("scoring")
    items = []
    price_ids: set[int] = set()
    if isinstance(raw, dict):
        if any(k in raw for k in ("tech_items", "biz_items", "price_items")):
            for bucket in ("tech_items", "biz_items"):
                items += [x for x in (raw.get(bucket) or []) if isinstance(x, dict)]
            for x in raw.get("price_items") or []:
                if isinstance(x, dict):
                    items.append(x)
                    price_ids.add(id(x))  # mark this object as price bucket
        else:
            items = raw.get("items", [])
    elif isinstance(raw, list):
        items = raw
    normalized = []
    for i, s in enumerate(items):
        if not isinstance(s, dict):
            continue
        sid = s.get("id") or s.get("code") or f"S{i + 1}"
        category = s.get("category")
        if id(s) in price_ids:
            category = "价格"
        elif category in (None, ""):
            category = "技术"
        elif category in _PRICE_CATEGORIES:
            category = "价格"
        weight = s.get("weight")
        if weight in (None, "", 0):
            weight = s.get("max_score") or s.get("score") or 0
        item = (
            s.get("item")
            or s.get("title")
            or s.get("name")
            or s.get("target_section")
            or sid
        )
        # Coerce must_keep to a list: the frozen vendor check_coverage.py iterates
        # scoring[].must_keep as keywords, but qwen/mimo sometimes emit it as a
        # bool flag (or omit it), which would `TypeError: 'bool' object is not
        # iterable` the audit. A non-list becomes [] (no keywords).
        must_keep = s.get("must_keep")
        if not isinstance(must_keep, list):
            must_keep = []
        normalized.append(
            {
                **s,
                "id": sid,
                "category": category,
                "weight": weight,
                "item": item,
                "must_keep": must_keep,
            }
        )
    return normalized


def normalize_clauses(clauses) -> list:
    """Align qwen's ``is_veto`` onto the ``veto`` key coverage/audit expect.

    Missing/None becomes False so a clause is never accidentally a veto.
    """

    if not isinstance(clauses, list):
        return []
    out = []
    for c in clauses:
        if not isinstance(c, dict):
            continue
        veto = c.get("veto")
        if veto is None:
            veto = bool(c.get("is_veto"))
        # Converge clause text onto a canonical ``text`` key. qwen/mimo emit it
        # under varying keys (clause / clause_text / 原文 / requirement); without
        # this, scoring-context ships no ``text`` and the materials panel falls
        # back to the raw id (e.g. "MC-002"), leaking an internal identifier.
        text = (
            c.get("clause")
            or c.get("clause_text")
            or c.get("text")
            or c.get("requirement")
            or c.get("原文")
            or ""
        )
        out.append({**c, "veto": bool(veto), "text": str(text).strip()})
    return out


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


def normalized_tender(tender: dict) -> dict:
    """One canonical normalized projection of the raw tender for ALL consumers
    (coverage/frontend/build/audit): scoring flattened, clauses veto-aligned,
    qualifications/required_outline coerced. Raw tender.json is never mutated."""
    out = dict(tender)
    out["scoring"] = normalize_scoring(tender)
    if "mandatory_clauses" in tender:
        out["mandatory_clauses"] = normalize_clauses(tender.get("mandatory_clauses"))
    if "qualifications" in tender:
        out["qualifications"] = normalize_qualifications(tender.get("qualifications"))
    if "required_outline" in tender:
        out["required_outline"] = normalize_required_outline(
            tender.get("required_outline")
        )
    return out


_NORMALIZED_REL = "workspace/tender_normalized.json"


def ensure_normalized_tender(ws: BidWorkspace) -> str:
    """Return the workspace-relative path to the single canonical normalized
    tender, generating it from the raw ``workspace/tender.json`` when absent
    (older projects parsed before the canonical write). Idempotent; the raw
    tender is never mutated. This is the ONE normalized projection every
    downstream consumer reads (coverage / scoring-context / build_outline /
    audit / sandbox drafting seed)."""
    if not ws.path(_NORMALIZED_REL).exists():
        ws.write_json(
            _NORMALIZED_REL, normalized_tender(ws.read_json("workspace/tender.json"))
        )
    return _NORMALIZED_REL
