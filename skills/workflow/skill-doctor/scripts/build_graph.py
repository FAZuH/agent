#!/usr/bin/env python3
"""skill-doctor graph builder: deterministic scanner of skill/agent relations.

Scans skill roots + agent definitions, extracts references from each SKILL.md
body: @-mentions (canonical skill/agent invocation form) and backticked
agent-id spans (subagent delegation). @-mentions must resolve to a skill id or
agent definition — anything else is a broken-ref finding (no suppression
list). Also checks collisions across active roots and repo-vs-installed
drift, regenerates graph.json, and prints JSONL findings to stdout (first line
= run summary).

Nodes are keyed by logical id, not by root copy: one skill present in three
roots is one node carrying a `roots` list. `scripts/skill-graph` renders this
file; read it instead of parsing a diagram.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()

# Scan roots. A skill id present in several roots is ONE logical node with a
# `roots` list — the per-root copies are attributes, not separate nodes.
ROOTS = [
    ("agents", HOME / ".agents" / "skills"),
    ("config", HOME / ".config" / "opencode" / "skills"),
    ("repo", HOME / "Projects" / "agent" / "skills"),
]
# Collisions are judged on the roots opencode actually loads (built-ins <
# .claude < .agents < config < project .opencode < skills-config per the v2
# docs); the repo root is source-only and never loaded.
ACTIVE_ROOTS = ("agents", "config")
ACTIVE_PRECEDENCE = ("config", "agents")

AGENT_DEFS_DIR = HOME / ".config" / "opencode" / "agents"
AGENTS_MD = HOME / ".config" / "opencode" / "AGENTS.md"
DATA_HOME = Path(os.environ.get("XDG_DATA_HOME") or HOME / ".local" / "share")
OUT_DIR = DATA_HOME / "skill-doctor"
GRAPH_PATH = OUT_DIR / "graph.json"
SCHEMA_VERSION = 1

BACKTICK_RE = re.compile(r"`([^`\n]+)`")
# Canonical reference form. Lookbehind rejects word chars and @ (emails,
# @@); lookahead rejects a following '/' (npm scopes like @scope/pkg) — a
# skill id never continues with those.
AT_MENTION_RE = re.compile(r"(?<![\w@])@([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?![\w/-])")
# Code spans are literal text, not references: @-mentions inside fenced blocks
# (JSDoc tags, bash examples) or backticks (npm specs like @scope/name@version)
# are never invocation mentions.
FENCE_RE = re.compile(r"(?:```|~~~).*?(?:```|~~~)", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\n.*?\n---[ \t]*\n?", re.DOTALL)

SEVERITY = {"broken-ref": "high", "collision": "medium", "drift": "medium"}


def strip_frontmatter(text: str) -> str:
    match = FRONTMATTER_RE.match(text)
    return text[match.end():] if match else text


def extract_mentions(body: str) -> set[str]:
    """@-mention ids (canonical skill/agent references), outside code spans."""
    text = FENCE_RE.sub("", body)
    text = INLINE_CODE_RE.sub("", text)
    return set(AT_MENTION_RE.findall(text))


def extract_agent_refs(body: str, agent_ids: set[str]) -> set[str]:
    """Backticked spans that are exactly an agent id (delegation references)."""
    return {span.strip() for span in BACKTICK_RE.findall(body)} & agent_ids


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_root_skills(root_path: Path) -> dict[str, Path]:
    skills: dict[str, Path] = {}
    if not root_path.is_dir():
        return skills
    for entry in sorted(root_path.iterdir()):
        skill_md = entry / "SKILL.md"
        if entry.is_dir() and skill_md.is_file():
            skills[entry.name] = skill_md
        elif entry.is_dir():
            # category subdirs (repo root only): skills/<cat>/<name>/SKILL.md
            for sub in sorted(entry.iterdir()):
                sm = sub / "SKILL.md"
                if sub.is_dir() and sm.is_file():
                    skills[sub.name] = sm
    return skills


def utc_ts_ms() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.strftime('%Y-%m-%dT%H:%M:%S')}.{now.microsecond // 1000:03d}Z"


def rel_home(path: Path) -> str:
    """Short display path: ~/.config/opencode/... rather than the absolute one."""
    try:
        return "~/" + path.relative_to(HOME).as_posix()
    except ValueError:
        return path.as_posix()


def skill_node(sid: str) -> str:
    return f"skill:{sid}"


def agent_node(aid: str) -> str:
    return f"agent:{aid}"


def missing_node(token: str) -> str:
    return f"missing:{token}"


DOC_NODE = "AGENTS.md"


def main() -> int:
    roots = {name: load_root_skills(path) for name, path in ROOTS}
    agent_ids = sorted(p.stem for p in AGENT_DEFS_DIR.glob("*.md")) if AGENT_DEFS_DIR.is_dir() else []
    agent_id_set = set(agent_ids)

    occurrences = sorted(
        (root_name, sid, path)
        for root_name, skills in roots.items()
        for sid, path in skills.items()
    )
    all_skill_ids = {sid for _, sid, _ in occurrences}

    def resolve_skill_node(sid: str) -> str | None:
        return skill_node(sid) if sid in all_skill_ids else None

    edges: set[tuple[str, str, str]] = set()
    findings: list[dict[str, str]] = []
    missing_tokens: set[str] = set()

    def add_finding(check: str, item: str, detail: str) -> None:
        findings.append(
            {
                "ts": utc_ts_ms(),
                "check": check,
                "severity": SEVERITY[check],
                "item": item,
                "detail": detail,
            }
        )

    for root_name, sid, skill_md in occurrences:
        body = strip_frontmatter(skill_md.read_text(encoding="utf-8", errors="replace"))
        src_node = skill_node(sid)
        # @-mentions are the canonical reference form: every one must resolve
        # to a skill id or an agent definition, else it is a broken-ref finding.
        for token in sorted(extract_mentions(body)):
            if token == sid:
                continue
            if token in all_skill_ids:
                edges.add((src_node, skill_node(token), "loads"))
            elif token in agent_id_set:
                edges.add((src_node, agent_node(token), "routes"))
            else:
                missing_tokens.add(token)
                edges.add((src_node, missing_node(token), "missing"))
                add_finding(
                    "broken-ref",
                    f"{sid} -> {token}",
                    f"'@{token}' in {root_name}/{sid}/SKILL.md matches no skill id or agent "
                    "definition; stale name or reference to something that does not exist",
                )
        # Backticked agent ids express subagent delegation: routes edges only,
        # never findings (prose tokens are ambiguous by design).
        for token in sorted(extract_agent_refs(body, agent_id_set)):
            if token != sid:
                edges.add((src_node, agent_node(token), "routes"))

    documents_edges: set[tuple[str, str, str]] = set()
    if AGENTS_MD.is_file():
        agents_md_text = AGENTS_MD.read_text(encoding="utf-8", errors="replace")
        known_targets = all_skill_ids | agent_id_set
        md_refs = extract_mentions(agents_md_text) | extract_agent_refs(agents_md_text, agent_id_set)
        for token in sorted(md_refs & known_targets):
            dst_node = resolve_skill_node(token) or agent_node(token)
            documents_edges.add((DOC_NODE, dst_node, "documents"))
        for token in sorted(md_refs - known_targets):
            add_finding(
                "broken-ref",
                f"AGENTS.md -> {token}",
                f"'@{token}' in ~/.config/opencode/AGENTS.md matches no skill id or agent "
                "definition; stale name or reference to something that does not exist",
            )

    collision_roots: dict[str, list[str]] = {}
    for sid in sorted(all_skill_ids):
        active_hits = [r for r in ACTIVE_ROOTS if sid in roots[r]]
        if len(active_hits) > 1:
            winner = "config" if "config" in active_hits else active_hits[-1]
            collision_roots[sid] = active_hits
            add_finding(
                "collision",
                sid,
                f"id present in multiple active roots ({', '.join(active_hits)}); per opencode v2 "
                f"precedence (~/.config/opencode/skills wins over ~/.agents/skills) the loaded "
                f"definition is {winner}; repo copy in ~/Projects/agent/skills is source-only",
            )

    for sid in sorted(all_skill_ids):
        if sid not in roots["repo"]:
            continue
        installed_root = next((r for r in ("config", "agents") if sid in roots[r]), None)
        if installed_root is None:
            continue
        repo_hash = sha256_file(roots["repo"][sid])
        installed_hash = sha256_file(roots[installed_root][sid])
        if repo_hash != installed_hash:
            add_finding(
                "drift",
                sid,
                f"SKILL.md differs between repo source and installed copy "
                f"(repo {repo_hash[:12]} != {installed_root} {installed_hash[:12]}); "
                f"sync.sh push -g instead of hand-syncing",
            )

    drift_ids = {f["item"] for f in findings if f["check"] == "drift"}
    all_edges = edges | documents_edges

    def root_path(sid: str) -> tuple[str, str]:
        """(active root, display path of the copy to open) — repo is source-only."""
        active = next((r for r in ACTIVE_PRECEDENCE if sid in roots[r]), "")
        return active, rel_home(roots[active or "repo"][sid])

    nodes: list[dict[str, object]] = []
    for sid in sorted(all_skill_ids):
        active, path = root_path(sid)
        nodes.append(
            {
                "id": skill_node(sid),
                "kind": "skill",
                "label": sid,
                "roots": [r for r, _ in ROOTS if sid in roots[r]],
                "active": active,
                "path": path,
                "collision": sid in collision_roots,
                "drift": sid in drift_ids,
            }
        )
    for aid in agent_ids:
        nodes.append(
            {
                "id": agent_node(aid),
                "kind": "agent",
                "label": aid,
                "roots": [],
                "active": "",
                "path": rel_home(AGENT_DEFS_DIR / f"{aid}.md"),
                "collision": False,
                "drift": False,
            }
        )
    for token in sorted(missing_tokens):
        nodes.append(
            {
                "id": missing_node(token),
                "kind": "missing",
                "label": token,
                "roots": [],
                "active": "",
                "path": "",
                "collision": False,
                "drift": False,
            }
        )
    if AGENTS_MD.is_file():
        nodes.append(
            {
                "id": DOC_NODE,
                "kind": "doc",
                "label": "AGENTS.md",
                "roots": [],
                "active": "",
                "path": rel_home(AGENTS_MD),
                "collision": False,
                "drift": False,
            }
        )

    degree: dict[str, int] = {}
    for src, dst, _ in all_edges:
        degree[src] = degree.get(src, 0) + 1
        degree[dst] = degree.get(dst, 0) + 1
    for node in nodes:
        node["degree"] = degree.get(str(node["id"]), 0)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    graph = {
        "schema": SCHEMA_VERSION,
        "generated": utc_ts_ms(),
        "roots": [{"id": name, "path": str(path)} for name, path in ROOTS],
        "nodes": nodes,
        "edges": [{"from": s, "to": d, "kind": k} for s, d, k in sorted(all_edges)],
        "findings": findings,
    }
    GRAPH_PATH.write_text(
        json.dumps(graph, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )

    summary = {
        "skills": len(all_skill_ids),
        "agents": len(agent_ids),
        "edges": len(all_edges),
        "broken": sum(1 for f in findings if f["check"] == "broken-ref"),
        "collisions": len(collision_roots),
        "drift": len(drift_ids),
    }
    print(json.dumps({"run-summary": summary}, separators=(",", ":")))
    for finding in findings:
        print(json.dumps(finding, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
