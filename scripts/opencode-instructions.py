#!/usr/bin/env python3
"""Keep an OpenCode config loading every instruction file in a directory.

Usage:
    opencode-instructions.py check|ensure|remove <config.json> <glob>

`ensure` adds the glob to the top-level `instructions` array, `check` reports
whether it is there, and `remove` takes it out. Edits are textual: the config
is hand-formatted, and json.dump would reflow every model entry. The result is
parsed again before it is written, so a broken edit never lands.

Exit codes: 0 ok or present, 1 absent (check only), 2 error.
"""

import json
import os
import stat
import sys
import tempfile


def skip_string(text: str, start: int) -> int:
    """Return the index just past the closing quote of the string at start."""
    i = start + 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == '"':
            return i + 1
        i += 1
    raise ValueError("unterminated string")


def array_end(text: str, start: int) -> int:
    """Return the index of the ] that closes the array at start."""
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == '"':
            i = skip_string(text, i)
            continue
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("unterminated array")


def top_level_array(text: str, key: str):
    """Return (key_start, array_start, array_end) for a top-level key, or None."""
    depth = 0
    i = 0
    while i < len(text):
        c = text[i]
        if c == '"':
            start = i
            end = skip_string(text, i)
            if depth == 1:
                j = end
                while j < len(text) and text[j] in " \t\r\n":
                    j += 1
                if j < len(text) and text[j] == ":":
                    try:
                        name = json.loads(text[start:end])
                    except json.JSONDecodeError:
                        name = None
                    if name == key:
                        value = j + 1
                        while value < len(text) and text[value] in " \t\r\n":
                            value += 1
                        if value < len(text) and text[value] == "[":
                            return start, value, array_end(text, value)
                        return None
            i = end
            continue
        if c in "{[":
            depth += 1
        elif c in "}]":
            depth -= 1
        i += 1
    return None


def ensure(text: str, entry: str) -> str:
    span = top_level_array(text, "instructions")
    data = json.loads(text)
    current = data.get("instructions")
    if current is not None and not isinstance(current, list):
        raise ValueError('"instructions" is not an array')

    if span is None:
        # No key yet: put it first, after the opening brace. An empty object
        # must not get a trailing comma.
        open_at = text.index("{")
        j = open_at + 1
        while j < len(text) and text[j].isspace():
            j += 1
        comma = "" if j < len(text) and text[j] == "}" else ","
        insert = '\n  "instructions": [%s]%s' % (json.dumps(entry), comma)
        return text[: open_at + 1] + insert + text[open_at + 1 :]

    if entry in (current or []):
        return text
    _, start, end = span
    inside = text[start + 1 : end]
    insert = (", " if inside.strip() else "") + json.dumps(entry)
    return text[:end] + insert + text[end:]


def remove(text: str, entry: str) -> str:
    span = top_level_array(text, "instructions")
    data = json.loads(text)
    current = data.get("instructions")
    if not isinstance(current, list) or span is None:
        return text

    remaining = [item for item in current if item != entry]
    if len(remaining) == len(current):
        return text
    key_start, start, end = span
    if remaining:
        return text[:start] + json.dumps(remaining) + text[end + 1 :]

    # Drop the whole key. Take its line with it, plus the following comma and
    # newline, or the preceding comma when it was the last member.
    line_start = text.rfind("\n", 0, key_start) + 1
    if text[line_start:key_start].strip():
        line_start = key_start
    after = end + 1
    j = after
    while j < len(text) and text[j] in " \t":
        j += 1
    if j < len(text) and text[j] == ",":
        j += 1
        while j < len(text) and text[j] in " \t":
            j += 1
        if j < len(text) and text[j] == "\n":
            j += 1
    else:
        k = line_start - 1
        while k >= 0 and text[k] in " \t\r\n":
            k -= 1
        if k >= 0 and text[k] == ",":
            line_start = k
    return text[:line_start] + text[j:]


def write_atomic(path: str, text: str) -> None:
    mode = stat.S_IMODE(os.stat(path).st_mode)
    directory = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".opencode-instructions-", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def main(argv) -> int:
    if len(argv) != 4 or argv[1] not in ("check", "ensure", "remove"):
        print("usage: opencode-instructions.py check|ensure|remove <config.json> <glob>", file=sys.stderr)
        return 2
    action, path, entry = argv[1], argv[2], argv[3]

    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        data = json.loads(text)
    except FileNotFoundError:
        print(f"missing config: {path}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as error:
        print(f"{path}: invalid JSON: {error}", file=sys.stderr)
        return 2

    if action == "check":
        current = data.get("instructions")
        return 0 if isinstance(current, list) and entry in current else 1

    try:
        updated = ensure(text, entry) if action == "ensure" else remove(text, entry)
    except ValueError as error:
        print(f"{path}: {error}", file=sys.stderr)
        return 2

    if updated != text:
        try:
            json.loads(updated)
        except json.JSONDecodeError as error:
            print(f"{path}: refusing to write invalid JSON: {error}", file=sys.stderr)
            return 2
        write_atomic(path, updated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
