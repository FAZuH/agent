#!/usr/bin/env python3
"""skill-doctor graph builder: deterministic scanner of skill/agent relations.

Scans skill roots + agent definitions, extracts kebab-case tokens from each
SKILL.md body (backticked spans and /slash-command forms), classifies them as
loads / routes / ignored / broken refs, checks collisions across active roots
and repo-vs-installed drift, regenerates graph.mmd, and prints JSONL findings
to stdout (first line = run summary).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()

# Precedence later-wins for source-of-truth resolution; opencode itself only
# loads ACTIVE_ROOTS (built-ins < .claude < .agents < config < project
# .opencode < explicit skills-config per opencode v2 docs), so collisions are
# judged on agents+config only.
ROOTS = [
    ("agents", HOME / ".agents" / "skills"),
    ("config", HOME / ".config" / "opencode" / "skills"),
    ("repo", HOME / "Projects" / "agent" / "skills"),
]
ACTIVE_ROOTS = ("agents", "config")
EDGE_TARGET_ORDER = ("config", "agents", "repo")

AGENT_DEFS_DIR = HOME / ".config" / "opencode" / "agents"
AGENTS_MD = HOME / ".config" / "opencode" / "AGENTS.md"
DATA_HOME = Path(os.environ.get("XDG_DATA_HOME") or HOME / ".local" / "share")
OUT_DIR = DATA_HOME / "skill-doctor"
GRAPH_PATH = OUT_DIR / "graph.mmd"
IGNORE_TOML = Path(__file__).resolve().parent.parent / "ignore.toml"

KEBAB_RE = re.compile(r"[a-z][a-z0-9]*(-[a-z0-9]+)+")
BACKTICK_RE = re.compile(r"`([^`\n]+)`")
SLASH_COMMAND_RE = re.compile(r"(?<![\w/-])/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)")
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\n.*?\n---[ \t]*\n?", re.DOTALL)

SEVERITY = {"broken-ref": "high", "collision": "medium", "drift": "medium"}


def strip_frontmatter(text: str) -> str:
    match = FRONTMATTER_RE.match(text)
    return text[match.end():] if match else text


def extract_tokens(body: str) -> set[str]:
    """Backticked spans that are exactly one kebab token + /slash-command names."""
    tokens = {span.strip() for span in BACKTICK_RE.findall(body)}
    tokens.update(SLASH_COMMAND_RE.findall(body))
    return {t for t in tokens if KEBAB_RE.fullmatch(t)}


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


def load_ignore_tokens() -> set[str]:
    try:
        data = tomllib.loads(IGNORE_TOML.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError, KeyError):
        return set()
    noise = data.get("noise", {}).get("tokens", [])
    return {str(t) for t in noise}


def utc_ts_ms() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.strftime('%Y-%m-%dT%H:%M:%S')}.{now.microsecond // 1000:03d}Z"


def mermaid_escape(label: str) -> str:
    return label.replace('"', "#quot;").replace("`", "")


def main() -> int:
    roots = {name: load_root_skills(path) for name, path in ROOTS}
    agent_ids = sorted(p.stem for p in AGENT_DEFS_DIR.glob("*.md")) if AGENT_DEFS_DIR.is_dir() else []
    ignore_tokens = load_ignore_tokens()

    occurrences = sorted(
        (root_name, sid, path)
        for root_name, skills in roots.items()
        for sid, path in skills.items()
    )
    all_skill_ids = {sid for _, sid, _ in occurrences}

    def resolve_skill_node(sid: str) -> str | None:
        for root_name in EDGE_TARGET_ORDER:
            if sid in roots[root_name]:
                return f"{root_name}_{sid}"
        return None

    edges: set[tuple[str, str, str]] = set()
    findings: list[dict[str, str]] = []
    missing_nodes: dict[str, str] = {}

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
        for token in sorted(extract_tokens(body)):
            if token == sid:
                continue
            src_node = f"{root_name}_{sid}"
            if token in all_skill_ids:
                dst_node = resolve_skill_node(token)
                if dst_node:
                    edges.add((src_node, dst_node, "loads"))
            elif token in agent_ids:
                edges.add((src_node, f"agent_{token}", "routes"))
            elif token in ignore_tokens:
                continue
            else:
                missing_node = missing_nodes.setdefault(token, f"missing_{len(missing_nodes)}")
                edges.add((src_node, missing_node, "missing"))
                add_finding(
                    "broken-ref",
                    f"{sid} -> {token}",
                    f"'{token}' quoted in {root_name}/{sid}/SKILL.md matches no skill id or agent "
                    "definition; stale name or reference to something that does not exist",
                )

    documents_edges: set[tuple[str, str, str]] = set()
    if AGENTS_MD.is_file():
        agents_md_tokens = extract_tokens(AGENTS_MD.read_text(encoding="utf-8", errors="replace"))
        known_targets = all_skill_ids | set(agent_ids)
        for token in sorted(agents_md_tokens & known_targets):
            dst_node = resolve_skill_node(token) if token in all_skill_ids else f"agent_{token}"
            if dst_node:
                documents_edges.add(("agents_md", dst_node, "documents"))

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

    lines: list[str] = [
        "%% skill-doctor relation graph - regenerated by scripts/build_graph.py; manual edits will be overwritten",
        "%% Legend: node(\"x\") rounded = skill dir with SKILL.md; node{{\"x\"}} hexagon = agent definition (~/.config/opencode/agents/*.md)",
        "%% Edges: A -->|loads| B (body names another skill); A -->|routes| B (body names an agent); agents_md -.->|documents| (referenced in ~/.config/opencode/AGENTS.md)",
        "%% Broken refs: dotted red edge to a virtual \"missing: X\" node (classDef missing)",
        "%% Subgraphs = scan roots; duplicate ids live per root; loads/routes targets point at the opencode-active copy (config > agents > repo)",
        "",
        "flowchart LR",
    ]

    subgraph_titles = {
        "agents": "~/.agents/skills",
        "config": "~/.config/opencode/skills",
        "repo": "~/Projects/agent/skills",
    }
    for root_name, _ in ROOTS:
        lines.append(f'  subgraph root_{root_name}["{mermaid_escape(subgraph_titles[root_name])}"]')
        for sid in sorted(roots[root_name]):
            lines.append(f'    {root_name}_{sid}("{mermaid_escape(sid)}")')
        lines.append("  end")

    lines.append('  subgraph agent_defs["agent definitions"]')
    lines.append('    agents_md["AGENTS.md"]')
    for aid in agent_ids:
        lines.append(f'    agent_{aid}{{"{mermaid_escape(aid)}"}}')
    lines.append("  end")

    if missing_nodes:
        lines.append('  subgraph missing_refs["unresolved references"]')
        for token, node in sorted(missing_nodes.items(), key=lambda kv: kv[1]):
            lines.append(f'    {node}("missing: {mermaid_escape(token)}")')
        lines.append("  end")

    for src, dst, label in sorted(edges | documents_edges):
        arrow = "-.->" if label == "missing" else "-->"
        lines.append(f"  {src} {arrow}|{label}| {dst}")

    lines.append("  classDef missing stroke:#cc3333,color:#cc3333,stroke-dasharray:4 4;")
    for _, node in sorted(missing_nodes.items(), key=lambda kv: kv[1]):
        lines.append(f"  class {node} missing;")
    lines.append("")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    GRAPH_PATH.write_text("\n".join(lines), encoding="utf-8")

    summary = {
        "skills": len(occurrences),
        "agents": len(agent_ids),
        "edges": len(edges) + len(documents_edges),
        "broken": sum(1 for f in findings if f["check"] == "broken-ref"),
        "collisions": len(collision_roots),
        "drift": sum(1 for f in findings if f["check"] == "drift"),
    }
    print(json.dumps({"run-summary": summary}, separators=(",", ":")))
    for finding in findings:
        print(json.dumps(finding, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
