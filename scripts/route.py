#!/usr/bin/env python3
"""Route a prompt to the project session that should own it.

Usage:
    route.py init
    route.py index [--refresh]
    route.py brief --prompt-file PATH
    route.py sessions --project PATH [--query TEXT]
    route.py dispatch --project PATH --prompt-file PATH [--session ID]
                      [--agent NAME] [--model PROVIDER/MODEL] [--title TITLE]
                      [--dry-run] [--yes]
    route.py eval --prompts PATH [--json]
    route.py doctor

`brief` is read-only. It returns a dossier of evidence, not a verdict: the
router reads the evidence and decides. `dispatch` refuses to create or prompt
a session without `--yes`; the agent asks the user first unless the route is
unambiguous and the user asked for auto mode.

Exit codes: 0 ok, 2 error.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

HOME = Path.home()
CONFIG_DIR = HOME / ".config" / "fazuh-agent"
REGISTRY_PATH = CONFIG_DIR / "route-projects.json"
CACHE_BASE = Path(os.environ.get("XDG_CACHE_HOME", HOME / ".cache"))
INDEX_PATH = CACHE_BASE / "fazuh-agent" / "projects.json"
STATE_BASE = Path(os.environ.get("XDG_STATE_HOME", HOME / ".local" / "state"))
LEDGER_PATH = STATE_BASE / "fazuh-agent" / "routes.jsonl"

EXCLUDES = {
    ".git", ".hg", ".svn", "node_modules", "target", "build", "dist",
    "vendor", ".venv", "venv", "__pycache__", ".cache", ".idea", ".vscode",
    "site-packages", ".gradle", ".m2",
}

STOPWORDS = set("""
a an the and or but if then than so to of in on at by for from with without
is are was were be been being am do does did doing have has had having
i me my we our us you your he she it its they them their this that these those
not no yes just now only also very can could should would will may might must
here there what which who whom when where why how all any both each few more
most other some such own same too s t don don't doesn t
""".split())

CONTINUATION = {
    "continue", "resume", "again", "same", "previous", "last", "before",
    "earlier", "yesterday", "today", "still", "remaining", "finish",
    "migrate", "migrating", "migration", "align", "sync", "module",
}

# Words that locate nothing on their own. Session text is full of them, so a
# title hit on one is noise rather than evidence.
SESSION_STOPWORDS = {
    "again", "still", "failing", "fails", "failure", "needs", "need", "check",
    "stops", "stopped", "referencing", "deleted", "remove", "removed",
    "before", "after", "yesterday", "today", "tomorrow", "investigate",
    "investigating", "please", "help", "want", "wants", "trying", "tried",
    "should", "could", "would", "doesn", "didn", "wasn", "weren", "isn",
    "general", "prompt", "prompts", "right", "left", "also", "even", "much",
    "many", "some", "only", "same", "next", "first", "well", "good", "bad",
    "already", "actually", "really", "maybe", "probably", "sent", "sends",
    "answer", "answers", "key", "keys",
}
SESSION_STOPWORDS |= CONTINUATION

MAX_TRACKED_FILES = 800

# Signals that name the destination itself, rather than describe it.
DIRECT_SIGNAL_KINDS = {"path", "repo_url", "name_phrase", "alias"}


class RouteError(Exception):
    pass


# ── small helpers ────────────────────────────────────────────────────────────

def run(cmd, timeout=120):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as error:
        raise RouteError(f"command not found: {cmd[0]}") from error
    except subprocess.TimeoutExpired as error:
        raise RouteError(f"command timed out after {timeout}s: {' '.join(cmd[:3])}") from error


def api(method, path, body=None):
    cmd = ["opencode2", "api", method, path]
    if body is not None:
        cmd += ["--data", json.dumps(body)]
    result = run(cmd)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RouteError(f"opencode2 api {method} {path} failed: {detail}")
    text = result.stdout.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise RouteError(f"opencode2 api {method} {path} returned invalid JSON: {error}") from error


def api_data(value):
    if isinstance(value, dict):
        return value.get("data", value)
    return value


def expand(path):
    return Path(os.path.expanduser(str(path))).resolve()


def display_path(path):
    path = expand(path)
    try:
        return "~/" + str(path.relative_to(HOME))
    except ValueError:
        return str(path)


def git_root(path):
    path = expand(path)
    if path.is_file():
        path = path.parent
    for candidate in [path, *path.parents]:
        if (candidate / ".git").exists():
            return candidate
    return None


def normalize_remote(url):
    if not url:
        return None
    url = url.strip().rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]
    if url.startswith("git@") and ":" in url:
        host, repo = url[4:].split(":", 1)
        url = f"{host}/{repo}"
    url = re.sub(r"^[a-z]+://", "", url, flags=re.I)
    url = re.sub(r"^[^@/]+@", "", url)
    return url.lower()


def tokens(text):
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text or "")
    text = re.sub(r"[^A-Za-z0-9]+", " ", text)
    out = []
    for word in text.lower().split():
        if len(word) < 3 or word in STOPWORDS:
            continue
        if word not in out:
            out.append(word)
    return out


def phrase_in(phrase, text):
    return re.search(r"(?<![A-Za-z0-9])" + re.escape(phrase.lower()) + r"(?![A-Za-z0-9])", text.lower()) is not None


def first_heading(path):
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    in_front = False
    for index, line in enumerate(lines[:80]):
        stripped = line.strip()
        if index == 0 and stripped == "---":
            in_front = True
            continue
        if in_front:
            if stripped == "---":
                in_front = False
            continue
        match = re.match(r"^#\s+(.+)$", stripped)
        if match:
            return match.group(1).strip()[:160]
        if stripped and not stripped.startswith(("<!--", "|")):
            return stripped[:160]
    return ""


def read_text(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def git_value(repo, *args):
    result = run(["git", "-C", str(repo), *args], timeout=10)
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


# ── registry and index ───────────────────────────────────────────────────────

def default_registry():
    return {
        "version": 1,
        "roots": ["~/Projects", "~/Work", "~/Apps", "~/Sandbox"],
        "exclude": [],
        "max_depth": 4,
        "projects": {},
        "signals": {
            "recent_user_prompts": 3,
            "recent_assistant_excerpts": 2,
            "max_candidates": 5,
            "max_sessions_per_project": 3,
            "generic_term_projects": 3,
            "title_term_df_limit": 12,
            "index_max_age_hours": 24,
            "snippet_chars": 400,
            "generic_terms": [
                "agent", "skill", "skills", "config", "sync", "fix", "check",
                "script", "memory", "session", "module", "repo", "project",
                "update", "test", "build", "deploy", "review", "read", "find",
                "create", "file", "files", "code", "line", "lines", "page",
                "site", "web", "work", "used", "use", "new", "old", "add",
                "run", "get", "set", "make", "change", "issue", "problem",
                "thing", "stuff", "need", "want", "like", "look", "match",
            ],
        },
    }


def load_registry():
    if not REGISTRY_PATH.exists():
        write_registry(default_registry())
    try:
        data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RouteError(f"cannot read {REGISTRY_PATH}: {error}") from error
    merged = default_registry()
    merged.update(data)
    merged["signals"] = {**default_registry()["signals"], **(data.get("signals") or {})}
    return merged


def write_registry(data):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def project_entry(registry, project):
    projects = registry.get("projects") or {}
    candidates = [
        display_path(project),
        str(expand(project)),
        project.get("name", "") if isinstance(project, dict) else "",
    ]
    for key in candidates:
        if key and key in projects:
            return projects[key] or {}
    return {}


def find_git_repos(root, max_depth):
    root = expand(root)
    if not root.is_dir():
        return []
    found = []
    stack = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        if (directory / ".git").exists():
            found.append(directory)
            continue
        if depth >= max_depth:
            continue
        for entry in entries:
            if not entry.is_dir(follow_symlinks=False):
                continue
            if entry.name in EXCLUDES or entry.name.startswith("."):
                continue
            stack.append((Path(entry.path), depth + 1))
    return sorted(set(found))


def tracked_files(path):
    """Tracked file paths, relative to the repo root.

    File names are evidence: a prompt that names `pr-creator` points at the
    repo holding `skills/workflow/pr-creator/SKILL.md`.
    """
    result = run(["git", "-C", str(path), "ls-files"], timeout=20)
    if result.returncode != 0:
        return []
    files = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return files[:MAX_TRACKED_FILES]


def project_metadata(path):
    path = expand(path)
    name = path.name
    remote = git_value(path, "remote", "get-url", "origin")
    last_commit = git_value(path, "log", "-1", "--format=%ct")
    readme = read_text(path / "README.md")[:1200]
    agents = read_text(path / "AGENTS.md")[:1200]
    scratch = []
    scratch_dir = path / ".scratch"
    if scratch_dir.is_dir():
        for spec in sorted(scratch_dir.glob("*/spec.md"))[:8]:
            try:
                modified = int(spec.stat().st_mtime)
            except OSError:
                modified = 0
            scratch.append({
                "path": display_path(spec),
                "title": first_heading(spec),
                "modified": modified,
            })
    return {
        "path": str(path),
        "display": display_path(path),
        "name": name,
        "remote": remote,
        "remote_norm": normalize_remote(remote),
        "readme": first_heading(path / "README.md"),
        "agents": first_heading(path / "AGENTS.md"),
        "summary": (readme + "\n" + agents).strip(),
        "files": tracked_files(path),
        "last_commit": int(last_commit) if last_commit.isdigit() else 0,
        "scratch": scratch,
    }


def build_index(registry):
    roots = [expand(root) for root in registry.get("roots", [])]
    max_depth = int(registry.get("max_depth", 4))
    excluded = {str(expand(path)) for path in registry.get("exclude", [])}
    projects = []
    seen = set()
    for root in roots:
        for repo in find_git_repos(root, max_depth):
            real = str(repo.resolve())
            if real in seen or real in excluded:
                continue
            seen.add(real)
            entry = project_entry(registry, repo)
            if entry.get("exclude"):
                continue
            projects.append(project_metadata(repo))
    data = {
        "generated_at": int(time.time()),
        "roots": [display_path(root) for root in roots],
        "projects": sorted(projects, key=lambda item: item["path"].lower()),
    }
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def load_index(registry, refresh=False):
    max_age = int(registry["signals"]["index_max_age_hours"]) * 3600
    if not refresh and INDEX_PATH.exists():
        try:
            data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            if int(time.time()) - int(data.get("generated_at", 0)) < max_age:
                return data
        except (OSError, json.JSONDecodeError, ValueError):
            pass
    return build_index(registry)


# ── prompt parsing ───────────────────────────────────────────────────────────

def clean_prompt(text):
    text = re.sub(r"<@[!&]?\d+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_urls(text):
    return re.findall(r"https?://[^\s<>\"']+", text)


def github_repo(url):
    match = re.search(r"github\.com/([^/\s]+)/([^/\s#?]+)", url, flags=re.I)
    if not match:
        return None
    owner, repo = match.group(1), match.group(2)
    if repo.endswith(".git"):
        repo = repo[:-4]
    return f"github.com/{owner}/{repo}".lower()


def extract_paths(text):
    found = []
    for raw in re.findall(r"(?:^|[\s'\"(])((?:~?/)[^\s'\"()]+)", text):
        candidate = raw.rstrip(".,:;!?")
        if candidate.startswith("//") or "://" in candidate:
            continue
        path = expand(candidate)
        if path.exists():
            found.append(str(path))
    return found


def identifier_phrases(text):
    """Return hyphenated, snake_case, path, and camelCase identifiers.

    These survive tokenization as a unit elsewhere, and are the terms worth
    searching for verbatim in file paths and session history.
    """
    phrases = set()
    for match in re.findall(r"[A-Za-z][A-Za-z0-9]*(?:[-_/][A-Za-z0-9]+)+", text or ""):
        phrases.add(match.lower())
    for match in re.findall(r"\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b", text or ""):
        phrases.add(match.lower())
    return sorted(phrase for phrase in phrases if len(phrase) >= 4)


def prompt_shape(text):
    words = set(tokens(text))
    return "continuation" if words & CONTINUATION else "new"


# ── project evidence ─────────────────────────────────────────────────────────

def project_token_counts(projects, registry):
    counts = {}
    for project in projects:
        entry = project_entry(registry, project["path"])
        corpus = " ".join([
            project["name"], project["readme"], project["agents"],
            project.get("summary", ""),
            entry.get("description", ""),
            " ".join(entry.get("aliases", [])),
            " ".join(entry.get("keywords", [])),
            project["display"],
        ])
        for token in set(tokens(corpus)):
            counts[token] = counts.get(token, 0) + 1
    return counts


def specificity(term, counts, threshold, generic_terms=None):
    if not term:
        return "weak"
    if generic_terms and term in generic_terms:
        return "generic"
    if counts.get(term, 0) > threshold:
        return "generic"
    if counts.get(term, 0) > 1:
        return "shared"
    return "unique"


def candidate_rank(candidate):
    """Sort key: destination evidence first, then breadth, then session depth."""
    sessions = candidate.get("sessions") or []
    session_strength = max((len(item.get("recent_match") or []) for item in sessions), default=0)
    title_strength = max((len(item.get("title_match") or []) for item in sessions), default=0)
    return (
        -candidate.get("direct_signals", 0),
        -candidate.get("unique_signals", 0),
        -candidate.get("shared_signals", 0),
        -session_strength,
        -title_strength,
        candidate["path"],
    )


def match_token(prompt_token, target_tokens):
    for target in target_tokens:
        if target == prompt_token:
            return target, "exact"
        shorter = prompt_token if len(prompt_token) <= len(target) else target
        longer = target if len(prompt_token) <= len(target) else prompt_token
        if (
            len(shorter) >= 4
            and longer.startswith(shorter)
            and len(shorter) / len(longer) >= 0.6
        ):
            return target, "prefix"
    return None, None


def project_candidates(prompt, projects, registry):
    prompt_lower = prompt.lower()
    prompt_tokens = set(tokens(prompt))
    counts = project_token_counts(projects, registry)
    threshold = int(registry["signals"]["generic_term_projects"])
    configured_generic = {term.lower() for term in registry["signals"].get("generic_terms", [])}
    generic = {term for term, count in counts.items() if count > threshold} | configured_generic
    path_hints = extract_paths(prompt)
    content_phrases = identifier_phrases(prompt)
    url_map = {}
    for url in extract_urls(prompt):
        repo = github_repo(url)
        if repo:
            url_map[repo] = url
    candidates = []
    references = []
    matched_urls = set()

    for project in projects:
        entry = project_entry(registry, project["path"])
        signals = []
        counter = []

        if project["path"] in path_hints:
            signals.append({
                "kind": "path",
                "evidence": f"prompt names {project['display']}",
                "specificity": "unique",
            })

        if project.get("remote_norm") and project["remote_norm"] in url_map:
            matched_urls.add(project["remote_norm"])
            signals.append({
                "kind": "repo_url",
                "evidence": f"prompt links {url_map[project['remote_norm']]}",
                "specificity": "unique",
            })

        name_tokens = set(tokens(project["name"]))
        name_phrase = project["name"].lower()
        seen_name = set()
        for token in sorted(prompt_tokens):
            target, how = match_token(token, name_tokens)
            if not target or target in seen_name:
                continue
            seen_name.add(target)
            label = f"prompt says \"{token}\"" if how == "exact" else f"prompt says \"{token}\" (prefix of \"{target}\")"
            level = specificity(token, counts, threshold, generic)
            if how == "exact" and name_phrase == token and level == "generic":
                level = "shared"
                label += " (exact repo name, common term)"
            signals.append({
                "kind": "repo_name",
                "evidence": label,
                "specificity": level,
            })

        name_variants = {name_phrase, name_phrase.replace("-", ""), name_phrase.replace("_", "-")}
        for phrase in content_phrases:
            if phrase in name_variants:
                signals.append({
                    "kind": "name_phrase",
                    "evidence": f"prompt names the repo \"{phrase}\"",
                    "specificity": "unique",
                })
                break

        path_tokens = set(tokens(project["display"]))
        seen_path = set()
        for token in sorted(prompt_tokens):
            target, how = match_token(token, path_tokens)
            if not target or target in seen_path:
                continue
            seen_path.add(target)
            label = f"path contains \"{token}\"" if how == "exact" else f"path contains \"{target}\" (prompt \"{token}\")"
            signals.append({
                "kind": "path_token",
                "evidence": label,
                "specificity": specificity(token, counts, threshold, generic),
            })

        for alias in entry.get("aliases", []) or []:
            if alias and phrase_in(alias, prompt_lower):
                signals.append({
                    "kind": "alias",
                    "evidence": f"alias \"{alias}\"",
                    "specificity": "unique",
                })

        if content_phrases and project.get("files"):
            matches = []
            for relative in project["files"]:
                lowered = relative.lower()
                for phrase in content_phrases:
                    if phrase in lowered:
                        matches.append((phrase, relative))
                        break
                if len(matches) >= 3:
                    break
            if matches:
                shown = "; ".join(f"\"{rel}\" matches \"{phrase}\"" for phrase, rel in matches[:3])
                signals.append({
                    "kind": "content",
                    "evidence": "tracked path " + shown,
                    "specificity": "unique",
                })

        for keyword in entry.get("keywords", []) or []:
            if keyword and phrase_in(keyword, prompt_lower):
                signals.append({
                    "kind": "keyword",
                    "evidence": f"keyword \"{keyword}\"",
                    "specificity": specificity(keyword.lower(), counts, threshold, generic),
                })

        description_tokens = set(tokens(" ".join([
            project.get("readme", ""), project.get("agents", ""),
            project.get("summary", ""), entry.get("description", ""),
        ])))
        description_hits = (description_tokens & prompt_tokens) - generic - SESSION_STOPWORDS
        if description_hits:
            signals.append({
                "kind": "description",
                "evidence": "description matches: " + ", ".join(sorted(description_hits)[:5]),
                "specificity": "shared",
            })

        for spec in project.get("scratch", []):
            spec_tokens = set(tokens(spec.get("title", "")))
            hits = (spec_tokens & prompt_tokens) - generic - SESSION_STOPWORDS
            if hits:
                signals.append({
                    "kind": "scratch",
                    "evidence": f"active workspace \"{spec.get('title')}\" matches: " + ", ".join(sorted(hits)[:4]),
                    "specificity": "shared",
                })

        if signals:
            unique = sum(1 for signal in signals if signal["specificity"] == "unique")
            shared = sum(1 for signal in signals if signal["specificity"] == "shared")
            direct = sum(1 for signal in signals if signal["kind"] in DIRECT_SIGNAL_KINDS)
            if unique == 0 and shared == 0 and direct == 0:
                continue
            if unique == 0:
                counter.append("only generic or shared terms matched")
            candidates.append({
                "path": project["path"],
                "display": project["display"],
                "name": project["name"],
                "remote": project["remote"],
                "readme": project.get("readme", ""),
                "agents": project.get("agents", ""),
                "entry": entry,
                "signals": signals,
                "counter_signals": counter,
                "direct_signals": direct,
                "unique_signals": unique,
                "shared_signals": shared,
                "rank_hint": 0,
            })

    for repo, url in url_map.items():
        if repo not in matched_urls:
            references.append({
                "url": url,
                "github": repo,
                "local_match": None,
                "note": "external reference, not an indexed local project; do not treat it as the destination",
            })

    candidates.sort(key=candidate_rank)
    for rank, candidate in enumerate(candidates, 1):
        candidate["rank_hint"] = rank
    return candidates, references, generic


# ── sessions ─────────────────────────────────────────────────────────────────

def session_rows(directory, limit=50):
    query = urllib.parse.urlencode({"directory": str(expand(directory)), "limit": limit, "order": "desc"})
    try:
        payload = api("get", f"/api/session?{query}")
    except RouteError:
        return []
    rows = api_data(payload) or []
    if not isinstance(rows, list):
        return []
    out = []
    for row in rows:
        if row.get("parentID") or row.get("parent_id"):
            continue
        if (row.get("time") or {}).get("archived"):
            continue
        location = (row.get("location") or {}).get("directory")
        if location and str(expand(location)) != str(expand(directory)):
            continue
        out.append(row)
    return out


def db_session_rows():
    """Top-level sessions, read straight from the local database."""
    db = Path(os.environ.get("OPENCODE_DB", HOME / ".local/share/opencode/opencode.db"))
    if not db.exists():
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        rows = con.execute(
            "select id, title, directory, agent, idle_outcome, parent_id, time_created, time_updated "
            "from session_v2 where time_archived is null"
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return []
    out = []
    for session_id, title, directory, agent, outcome, parent_id, created, updated in rows:
        if not directory or not title:
            continue
        out.append({
            "id": session_id,
            "title": title,
            "agent": agent,
            "outcome": outcome,
            "parentID": parent_id,
            "location": {"directory": directory},
            "time": {"created": created, "updated": updated},
        })
    return out


def map_directory_to_project(directory, projects):
    """Deepest indexed project that contains the session directory."""
    if not directory:
        return None
    target = expand(directory)
    best = None
    for project in projects:
        path = expand(project["path"])
        if target == path or path in target.parents:
            if best is None or len(path.parts) > len(expand(best["path"]).parts):
                best = project
    return best


def session_title_hits(prompt, projects, registry, generic):
    """Sessions anywhere whose titles share distinctive prompt terms.

    Titles drift, so this only locates candidate sessions. The dossier still
    reads their recent prompts and answers before anything is resumed.
    """
    prompt_tokens = {
        term for term in tokens(prompt)
        if len(term) >= 4 and term not in generic and term not in SESSION_STOPWORDS
    }
    if not prompt_tokens:
        return {}
    rows = db_session_rows()
    if not rows:
        return {}
    title_tokens = {row["id"]: set(tokens(row.get("title", ""))) for row in rows}
    document_frequency = {}
    for terms in title_tokens.values():
        for term in terms:
            document_frequency[term] = document_frequency.get(term, 0) + 1
    rare_limit = int(registry["signals"].get("title_term_df_limit", 12))
    usable = {term for term in prompt_tokens if document_frequency.get(term, 0) <= rare_limit}
    if not usable:
        return {}
    hits = {}
    for row in rows:
        title_terms = title_tokens[row["id"]]
        matched = set()
        for term in title_terms:
            for prompt_term in usable:
                if term == prompt_term:
                    matched.add(prompt_term)
                    continue
                shorter = prompt_term if len(prompt_term) <= len(term) else term
                longer = term if len(prompt_term) <= len(term) else prompt_term
                if (
                    len(shorter) >= 4
                    and longer.startswith(shorter)
                    and len(shorter) / len(longer) >= 0.6
                ):
                    matched.add(prompt_term)
        if not matched:
            continue
        project = map_directory_to_project((row.get("location") or {}).get("directory"), projects)
        if not project:
            continue
        name_terms = set(tokens(project["name"]))
        names_project = any(term in name_terms for term in title_terms)
        hits.setdefault(project["path"], []).append({
            "row": row,
            "matched": sorted(matched),
            "names_project": names_project,
            "score": len(matched) + (2 if names_project else 0),
            "rarity": min(document_frequency.get(term, 0) for term in matched),
        })
    for entries in hits.values():
        entries.sort(key=lambda item: (-item["score"], -((item["row"].get("time") or {}).get("updated") or 0)))
    return hits



def message_texts(payload):
    rows = api_data(payload) or []
    if not isinstance(rows, list):
        return []
    rows = sorted(rows, key=lambda item: (item.get("time") or {}).get("created", 0))
    users, assistants = [], []
    for row in rows:
        kind = row.get("type")
        if kind == "user":
            text = (row.get("text") or "").strip()
            if text:
                users.append(text)
        elif kind == "assistant":
            parts = []
            for part in row.get("content") or []:
                if isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                    parts.append(part["text"])
            text = "\n".join(parts).strip()
            if text:
                assistants.append(text)
    return users, assistants


def db_messages(session_id, snippet_chars):
    """Read message text straight from the local database.

    The HTTP message list can exceed the CLI's output limit on long sessions,
    which would truncate the JSON. The database is local and read-only here.
    """
    db = Path(os.environ.get("OPENCODE_DB", HOME / ".local/share/opencode/opencode.db"))
    if not db.exists():
        return [], []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        rows = con.execute(
            "select type, data from session_message where session_id=? order by time_created asc",
            (session_id,),
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return [], []
    users, assistants = [], []
    for kind, data in rows:
        try:
            row = json.loads(data) if data else {}
        except json.JSONDecodeError:
            continue
        if kind == "user":
            text = (row.get("text") or "").strip()
            if text:
                users.append(text)
        elif kind == "assistant":
            parts = []
            for part in row.get("content") or []:
                if isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                    parts.append(part["text"])
            text = "\n".join(parts).strip()
            if text:
                assistants.append(text)
    return (
        [text[:snippet_chars] for text in users],
        [text[:snippet_chars] for text in assistants],
    )


def session_messages(session_id, snippet_chars):
    users, assistants = db_messages(session_id, snippet_chars)
    if users or assistants:
        return users, assistants
    try:
        payload = api("get", f"/api/session/{session_id}/message")
    except RouteError:
        return [], []
    users, assistants = message_texts(payload)
    return (
        [text[:snippet_chars] for text in users],
        [text[:snippet_chars] for text in assistants],
    )


def session_dossier(row, prompt, registry, snippet_chars, generic=None):
    all_users, all_assistants = session_messages(row.get("id"), snippet_chars)
    generic = generic or set()
    prompt_tokens = set(tokens(prompt))
    first_user = all_users[0] if all_users else ""
    recent_users = all_users[-3:]
    recent_assistants = all_assistants[-2:]
    recent_text = " ".join([first_user] + recent_users + recent_assistants)
    recent_tokens = set(tokens(recent_text))
    ignored = generic | SESSION_STOPWORDS
    hits = (recent_tokens & prompt_tokens) - ignored
    title_tokens = set(tokens(row.get("title", "")))
    title_hits = (title_tokens & prompt_tokens) - ignored
    drift = []
    location = (row.get("location") or {}).get("directory")
    for raw_path in extract_paths(recent_text):
        path_root = git_root(raw_path)
        if path_root and location and str(path_root) != str(expand(location)):
            drift.append(f"recent text names {display_path(path_root)}")
    updated = (row.get("time") or {}).get("updated") or (row.get("time") or {}).get("created") or 0
    return {
        "sessionID": row.get("id"),
        "title": row.get("title", ""),
        "agent": row.get("agent"),
        "directory": location,
        "outcome": row.get("outcome"),
        "child": bool(row.get("parentID") or row.get("parent_id")),
        "updated": updated,
        "first_user_prompt": first_user,
        "last_user_prompts": recent_users,
        "last_assistant_excerpts": recent_assistants,
        "title_match": sorted(title_hits),
        "recent_match": sorted(hits),
        "title_only": bool(title_hits and not hits),
        "drift": bool(drift),
        "drift_evidence": drift,
    }


def related_sessions(project_path, prompt, registry, snippet_chars, generic=None):
    """Sessions in the immediate parent or a title search that may hold context.

    A project's best context often lives one directory up (a parent folder
    session) or under a title that drifted from the current work.
    """
    prompt_lower = prompt.lower()
    context_terms = ("migrat", "module", "answer key", "session", "align", "sync")
    wants_context = prompt_shape(prompt) == "continuation" or any(term in prompt_lower for term in context_terms)
    prompt_tokens = set(tokens(prompt))
    seen = set()
    seen_directories = set()
    out = []
    ancestors = [expand(project_path).parent, expand(project_path).parent.parent]
    for directory in ancestors:
        if directory in seen_directories:
            continue
        seen_directories.add(directory)
        if directory == HOME or len(directory.parts) < 3:
            continue
        for row in session_rows(directory, limit=30)[:10]:
            sid = row.get("id")
            if sid in seen:
                continue
            title_hits = set(tokens(row.get("title", ""))) & prompt_tokens - SESSION_STOPWORDS
            if not title_hits and not wants_context:
                continue
            seen.add(sid)
            out.append((row, f"session lives in {display_path(directory)}; title matches: {', '.join(sorted(title_hits)) or 'context prompt'}"))
    if wants_context:
        for term in ("migration", "migrate", "module", "answer key", "repo"):
            if term not in prompt_lower:
                continue
            try:
                payload = api("get", f"/api/session?search={urllib.parse.quote(term)}&limit=20&order=desc")
            except RouteError:
                continue
            for row in api_data(payload) or []:
                sid = row.get("id")
                if sid in seen:
                    continue
                seen.add(sid)
                out.append((row, f"title search matched \"{term}\""))
    dossiers = []
    for row, why in out[:5]:
        dossier = session_dossier(row, prompt, registry, snippet_chars, generic)
        dossier["why"] = why
        dossiers.append(dossier)
    return dossiers


# ── brief ────────────────────────────────────────────────────────────────────

def build_brief(prompt_path, registry=None, refresh=False):
    registry = registry or load_registry()
    prompt = read_text(expand(prompt_path)).strip()
    if not prompt:
        raise RouteError("prompt file is empty")
    clean = clean_prompt(prompt)
    index = load_index(registry, refresh=refresh)
    projects = index.get("projects") or []
    candidates, references, generic = project_candidates(clean, projects, registry)
    snippet_chars = int(registry["signals"]["snippet_chars"])
    max_sessions = int(registry["signals"]["max_sessions_per_project"])

    projects_by_path = {project["path"]: project for project in projects}
    candidates_by_path = {candidate["path"]: candidate for candidate in candidates}
    for path, hits in session_title_hits(clean, projects, registry, generic).items():
        project = projects_by_path.get(path)
        if not project:
            continue
        candidate = candidates_by_path.get(path)
        if candidate is None:
            entry = project_entry(registry, path)
            candidate = {
                "path": project["path"],
                "display": project["display"],
                "name": project["name"],
                "remote": project["remote"],
                "readme": project.get("readme", ""),
                "agents": project.get("agents", ""),
                "entry": entry,
                "signals": [],
                "counter_signals": [],
                "direct_signals": 0,
                "unique_signals": 0,
                "shared_signals": 0,
                "rank_hint": 0,
            }
            candidates.append(candidate)
            candidates_by_path[path] = candidate
        best = hits[0]
        strong = best["score"] >= 3 or len(best["matched"]) >= 2 or best["rarity"] <= 3
        evidence = (
            f"session \"{best['row'].get('title')}\" ({best['row'].get('id')}) "
            f"matches: {', '.join(best['matched'][:5])}"
        )
        if best["names_project"]:
            evidence += "; title names the project"
        candidate["signals"].append({
            "kind": "session_title",
            "evidence": evidence,
            "specificity": "unique" if strong else "shared",
        })
        if strong:
            candidate["unique_signals"] += 1
        else:
            candidate["shared_signals"] += 1
        candidate["global_sessions"] = [hit["row"] for hit in hits[:3]]
        candidate["global_session_ids"] = {hit["row"]["id"] for hit in hits[:3]}

    for candidate in candidates:
        rows = session_rows(candidate["path"], limit=50)
        global_rows = candidate.pop("global_sessions", [])
        global_ids = candidate.pop("global_session_ids", set())
        merged = global_rows + rows
        seen = set()
        sessions = []
        for row in merged:
            session_id = row.get("id")
            if not session_id or session_id in seen:
                continue
            seen.add(session_id)
            dossier = session_dossier(row, clean, registry, snippet_chars, generic)
            if session_id in global_ids:
                dossier["why"] = "global session title matched the prompt"
            sessions.append(dossier)
        local_sessions = [item for item in sessions if item.get("why") is None]
        global_sessions = [item for item in sessions if item.get("why")]
        local_sessions.sort(key=lambda item: (
            -len(item["recent_match"]),
            -len(item["title_match"]),
            -(item.get("updated") or 0),
        ))
        candidate["sessions"] = (global_sessions + local_sessions)[:max_sessions]
        session_hits = [
            item for item in candidate["sessions"]
            if item["recent_match"]
        ]
        if session_hits:
            best_session = session_hits[0]
            strength = len(best_session["recent_match"])
            candidate["signals"].append({
                "kind": "session_text",
                "evidence": f"{best_session['sessionID']} recent text matches: {', '.join(best_session['recent_match'][:5])}",
                "specificity": "unique" if strength >= 2 else "shared",
            })
            if strength >= 2:
                candidate["unique_signals"] += 1
            else:
                candidate["shared_signals"] += 1
        if candidate["sessions"]:
            resumable = [item for item in candidate["sessions"] if not item.get("child")]
            if resumable:
                candidate["session_hint"] = resumable[0]["sessionID"]

    candidates.sort(key=candidate_rank)
    candidates = candidates[: int(registry["signals"]["max_candidates"])]
    for rank, candidate in enumerate(candidates, 1):
        candidate["rank_hint"] = rank

    warnings = []
    age = int(time.time()) - int(index.get("generated_at", 0))
    if age > int(registry["signals"]["index_max_age_hours"]) * 3600:
        warnings.append(f"project index is {age // 3600}h old; run `route.py index --refresh`")
    if not candidates:
        warnings.append("no project candidate matched; ask the user or create a project")
    if len(candidates) > 1 and candidate_rank(candidates[0])[:3] == candidate_rank(candidates[1])[:3]:
        warnings.append("the top two candidates have equally strong evidence; do not auto-route")
    if references:
        warnings.append("prompt contains external references; a reference URL is not the destination")
    generic_hits = sorted(set(tokens(clean)) & generic)
    if generic_hits:
        warnings.append("generic terms in prompt: " + ", ".join(generic_hits[:8]))

    related = related_sessions(candidates[0]["path"], clean, registry, snippet_chars, generic) if candidates else []

    return {
        "prompt": {
            "raw": prompt,
            "clean": clean,
            "tokens": tokens(clean),
            "shape": prompt_shape(clean),
        },
        "index": {
            "generated_at": index.get("generated_at", 0),
            "age_seconds": age,
            "projects": len(projects),
        },
        "project_candidates": candidates,
        "references": references,
        "related_sessions": related,
        "warnings": warnings,
        "judgment": "The router decides. Read the evidence, check specificity, and ask when the candidates do not actually fit.",
    }


# ── dispatch ─────────────────────────────────────────────────────────────────

def session_info(session_id):
    payload = api("get", f"/api/session/{session_id}")
    data = api_data(payload)
    if not isinstance(data, dict):
        raise RouteError(f"session {session_id} not found")
    return data


def parse_model(reference):
    """Split `provider/model` while keeping slashes inside the model id."""
    if not reference:
        return None
    provider, separator, model = reference.partition("/")
    if not separator or not provider or not model:
        raise RouteError(f"model must be provider/model, got: {reference}")
    return {"providerID": provider, "id": model}


def dispatch(
    project,
    prompt_path,
    session=None,
    agent="orchestrator",
    title=None,
    model=None,
    dry_run=False,
    yes=False,
):
    project_path = expand(project)
    if not project_path.is_dir():
        raise RouteError(f"project directory does not exist: {project_path}")
    root = git_root(project_path)
    if not root:
        raise RouteError(f"project is not inside a git repository: {project_path}")
    project_path = root
    prompt = read_text(expand(prompt_path)).strip()
    if not prompt:
        raise RouteError("prompt file is empty")
    clean = clean_prompt(prompt)
    action = "new"
    resolved_session = None
    if session:
        info = session_info(session)
        if info.get("parentID") or info.get("parent_id"):
            raise RouteError(f"refusing to resume child session {session}")
        if (info.get("time") or {}).get("archived"):
            raise RouteError(f"refusing to resume archived session {session}")
        action = "resume"
        resolved_session = session
    if not title:
        title = f"{project_path.name}: {clean[:60]}"
    plan = {
        "action": action,
        "project": str(project_path),
        "project_display": display_path(project_path),
        "sessionID": resolved_session,
        "agent": agent,
        "model": model if action == "new" else None,
        "title": title,
        "prompt_chars": len(prompt),
        "dry_run": dry_run or not yes,
    }
    if resolved_session:
        info = session_info(resolved_session)
        session_directory = (info.get("location") or {}).get("directory")
        plan["session_directory"] = session_directory
        plan["session_matches_project"] = bool(session_directory) and str(expand(session_directory)) == str(project_path)
    if dry_run or not yes:
        return plan
    if action == "new":
        body = {
            "title": title,
            "location": {"directory": str(project_path)},
            "agent": agent,
        }
        parsed = parse_model(model)
        if parsed:
            body["model"] = parsed
        payload = api("post", "/api/session", body)
        data = api_data(payload)
        resolved_session = (data or {}).get("id") or (data or {}).get("sessionID")
        if not resolved_session:
            raise RouteError("session create returned no id")
    api("post", f"/api/session/{resolved_session}/prompt", {"text": prompt})
    plan.update({
        "sessionID": resolved_session,
        "dry_run": False,
        "open": f"opencode {project_path} -s {resolved_session}",
    })
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "at": int(time.time()),
            "action": action,
            "project": str(project_path),
            "sessionID": resolved_session,
            "agent": agent,
            "model": plan["model"],
            "title": title,
            "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        }) + "\n")
    return plan


# ── eval ─────────────────────────────────────────────────────────────────────

def eval_prompts(path, as_json=False):
    registry = load_registry()
    rows = []
    for line in read_text(expand(path)).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rows.append(json.loads(line))
    results = []
    for row in rows:
        prompt = row["prompt"]
        tmp = CACHE_BASE / "fazuh-agent" / "eval-prompt.txt"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(prompt, encoding="utf-8")
        brief = build_brief(tmp, registry=registry)
        top = brief["project_candidates"][0] if brief["project_candidates"] else None
        top_session = top["sessions"][0] if top and top.get("sessions") else None
        expected = row.get("expected_project")
        expected_norm = str(expand(expected)) if expected else None
        actual = top["path"] if top else None
        status = "no-match"
        if expected_norm and actual:
            status = "match" if str(expand(actual)) == expected_norm else "miss"
        elif expected_norm and not actual:
            status = "miss"
        elif not expected_norm:
            status = "ask"
        related_ids = [item["sessionID"] for item in brief.get("related_sessions", [])]
        actual_session = top_session["sessionID"] if top_session else None
        expected_session = row.get("expected_session")
        session_status = "n/a"
        if expected_session:
            session_status = "match" if expected_session in ({actual_session} | set(related_ids)) else "miss"
        results.append({
            "id": row.get("id"),
            "prompt": prompt,
            "expected_project": expected,
            "actual_project": actual,
            "expected_session": expected_session,
            "actual_session": actual_session,
            "related_sessions": related_ids,
            "session_status": session_status,
            "status": status,
            "warnings": brief["warnings"],
        })
    if as_json:
        print(json.dumps(results, indent=2))
        return results
    for result in results:
        print(
            f"{result['status']:9} {result['session_status']:7} "
            f"{result['id'] or '-':20} "
            f"{display_path(result['actual_project']) if result['actual_project'] else '-'}"
        )
    return results


# ── commands ─────────────────────────────────────────────────────────────────

def command_init(args):
    if REGISTRY_PATH.exists():
        print(json.dumps({"registry": str(REGISTRY_PATH), "created": False}, indent=2))
        return 0
    write_registry(default_registry())
    print(json.dumps({"registry": str(REGISTRY_PATH), "created": True}, indent=2))
    return 0


def command_index(args):
    registry = load_registry()
    data = load_index(registry, refresh=args.refresh)
    print(json.dumps({
        "index": str(INDEX_PATH),
        "generated_at": data["generated_at"],
        "projects": len(data["projects"]),
        "roots": data["roots"],
    }, indent=2))
    return 0


def command_brief(args):
    print(json.dumps(build_brief(args.prompt_file), indent=2))
    return 0


def command_sessions(args):
    registry = load_registry()
    rows = session_rows(args.project, limit=args.limit)
    query = set(tokens(args.query)) if args.query else set()
    output = []
    for row in rows:
        if query and not (query & set(tokens(row.get("title", "")))):
            continue
        output.append({
            "sessionID": row.get("id"),
            "title": row.get("title"),
            "agent": row.get("agent"),
            "directory": (row.get("location") or {}).get("directory"),
            "updated": (row.get("time") or {}).get("updated"),
            "outcome": row.get("outcome"),
        })
    print(json.dumps(output, indent=2))
    return 0


def command_dispatch(args):
    print(json.dumps(dispatch(
        args.project, args.prompt_file, session=args.session, agent=args.agent,
        title=args.title, model=args.model, dry_run=args.dry_run, yes=args.yes,
    ), indent=2))
    return 0


def command_eval(args):
    eval_prompts(args.prompts, as_json=args.json)
    return 0


def command_doctor(args):
    registry = load_registry()
    report = {
        "registry": str(REGISTRY_PATH),
        "registry_exists": REGISTRY_PATH.exists(),
        "index": str(INDEX_PATH),
        "index_exists": INDEX_PATH.exists(),
        "roots": [],
        "opencode2": shutil.which("opencode2") is not None,
        "api": False,
        "api_error": None,
    }
    for root in registry.get("roots", []):
        path = expand(root)
        report["roots"].append({"path": display_path(path), "exists": path.is_dir()})
    try:
        api("get", "/api/session?limit=1")
        report["api"] = True
    except RouteError as error:
        report["api_error"] = str(error)
    print(json.dumps(report, indent=2))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="route.py", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init")
    init.set_defaults(func=command_init)

    index = sub.add_parser("index")
    index.add_argument("--refresh", action="store_true")
    index.set_defaults(func=command_index)

    brief = sub.add_parser("brief")
    brief.add_argument("--prompt-file", required=True)
    brief.set_defaults(func=command_brief)

    sessions = sub.add_parser("sessions")
    sessions.add_argument("--project", required=True)
    sessions.add_argument("--query", default="")
    sessions.add_argument("--limit", type=int, default=50)
    sessions.set_defaults(func=command_sessions)

    dispatch_parser = sub.add_parser("dispatch")
    dispatch_parser.add_argument("--project", required=True)
    dispatch_parser.add_argument("--prompt-file", required=True)
    dispatch_parser.add_argument("--session")
    dispatch_parser.add_argument("--agent", default="orchestrator")
    dispatch_parser.add_argument("--model")
    dispatch_parser.add_argument("--title")
    dispatch_parser.add_argument("--dry-run", action="store_true")
    dispatch_parser.add_argument("--yes", action="store_true")
    dispatch_parser.set_defaults(func=command_dispatch)

    evaluate = sub.add_parser("eval")
    evaluate.add_argument("--prompts", required=True)
    evaluate.add_argument("--json", action="store_true")
    evaluate.set_defaults(func=command_eval)

    doctor = sub.add_parser("doctor")
    doctor.set_defaults(func=command_doctor)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except RouteError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
