"""The set of declared types that survive the JSON round-trip every value makes.

Test-case inputs travel browser -> /api/verify -> the harness's stdin as JSON, and
results travel back the same way. JSON has no integer-keyed objects, no tuples, no sets
and no classes, so a signature declaring one of those promises the solver something the
pipeline physically cannot deliver — `Dict[int, List[int]]` arrives with string keys and
a solver indexing it by int gets a KeyError.

Before this module the declared type was decorative (rendered in the editor stub, never
checked), and the only guard was a prose instruction to the model. This makes
representability a machine-checked property of the contract instead.

Grammar:
    T := int | float | str | bool | None | Any
       | List[T] | Dict[str, T] | Optional[T] | T | None
"""

_SCALARS = {"int", "float", "str", "bool", "none", "any"}
_BARE_CONTAINERS = {"list", "dict"}


def _split_top_level(text: str) -> list[str]:
    """Split on commas that aren't inside brackets, so Dict[str, List[int]] splits into
    ["str", "List[int]"] rather than on the inner comma."""
    parts, depth, current = [], 0, ""
    for ch in text:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p.strip() for p in parts]


def is_wire_type(declared: str) -> bool:
    t = (declared or "").strip()
    if not t:
        return False
    low = t.lower()

    if low in _SCALARS or low in _BARE_CONTAINERS:
        return True

    # `int | None` style unions — every member must itself be representable.
    if "|" in t and "[" not in t.split("|")[0]:
        return all(is_wire_type(part) for part in _split_union(t))

    if not t.endswith("]"):
        return False
    head, _, inner = t.partition("[")
    inner = inner[:-1]
    head = head.strip().lower()

    if head in ("list", "optional"):
        return is_wire_type(inner)
    if head == "dict":
        parts = _split_top_level(inner)
        # The whole point: JSON object keys are strings, so only str keys round-trip.
        return len(parts) == 2 and parts[0].lower() == "str" and is_wire_type(parts[1])
    return False


def _split_union(text: str) -> list[str]:
    parts, depth, current = [], 0, ""
    for ch in text:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        if ch == "|" and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p.strip() for p in parts]


def explain(declared: str) -> str:
    """Why a type was rejected, phrased so the model can correct itself — this text is
    fed back into the client's retry loop."""
    t = (declared or "").strip()
    low = t.lower()
    if low.startswith("dict[") and not _split_top_level(t.partition("[")[2][:-1])[0].lower() == "str":
        return (
            f"{t!r} is not usable across the boundary: JSON object keys are always strings, so a "
            "dict must be keyed by str (use Dict[str, ...], or an index-based List[...] instead)"
        )
    if low.startswith("tuple") or low.startswith("set") or low.startswith("frozenset"):
        return f"{t!r} has no JSON equivalent — use List[...] at the boundary and convert inside your code"
    return (
        f"{t!r} is not a supported wire type. Use int, float, str, bool, None, Any, "
        "List[T], Dict[str, T] or Optional[T]"
    )
