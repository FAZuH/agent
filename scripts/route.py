#!/usr/bin/env python3
"""Route a prompt to the project session that should own it.

Usage:
    route.py init
    route.py index [--refresh]
    route.py brief --prompt-file PATH [--compact]
    route.py sessions --project PATH [--query TEXT] [--detail]
    route.py dispatch [--project PATH] --prompt-file PATH [--session ID]
                      [--agent NAME] [--model PROVIDER/MODEL[#VARIANT]]
                      [--title TITLE] [--dry-run] [--yes]
                      [--watch | --no-watch] [--notify-session ID] [--sentinel PATH]
    route.py watch --spec PATH [--quiet-seconds N] [--max-hours N]
    route.py eval --prompts PATH [--json]
    route.py doctor

`brief` is read-only. It returns a dossier of evidence, not a verdict: the
router reads the evidence and decides. `dispatch` refuses to create or prompt
a session without `--yes`; the agent asks the user first unless the route is
unambiguous and auto mode is enabled. A new session needs `--project`;
a resumed session uses its own directory. `--model` and `--agent` switch those
fields on a resumed session. A live dispatch registers a follow-up watcher that
wakes the calling session when the target and its children go fully idle.

Exit codes: 0 ok, 2 error.
"""

import argparse
import fcntl
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
WATCH_DIR = STATE_BASE / "fazuh-agent" / "route-watch"
WATCH_LOG = Path("/tmp/opencode/route-watch.log")

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


def normalize_model(value):
    """Return `{providerID,id,variant}` from an API or database value."""
    if not value:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, dict):
        return None
    model = {key: value[key] for key in ("providerID", "id", "variant") if value.get(key)}
    return model or None


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
            "max_sessions_per_project": 5,
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
            "select id, title, directory, agent, model, idle_outcome, parent_id, time_created, time_updated "
            "from session_v2 where time_archived is null"
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return []
    out = []
    for session_id, title, directory, agent, model, outcome, parent_id, created, updated in rows:
        if not directory or not title:
            continue
        out.append({
            "id": session_id,
            "title": title,
            "agent": agent,
            "model": normalize_model(model),
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
    user_text = " ".join([first_user] + recent_users)
    assistant_text = " ".join(recent_assistants)
    ignored = generic | SESSION_STOPWORDS
    user_hits = (set(tokens(user_text)) & prompt_tokens) - ignored
    assistant_hits = (set(tokens(assistant_text)) & prompt_tokens) - ignored
    hits = user_hits | assistant_hits
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
        "model": normalize_model(row.get("model")),
        "directory": location,
        "outcome": row.get("outcome"),
        "child": bool(row.get("parentID") or row.get("parent_id")),
        "updated": updated,
        "first_user_prompt": first_user,
        "last_user_prompts": recent_users,
        "last_assistant_excerpts": recent_assistants,
        "title_match": sorted(title_hits),
        "user_match": sorted(user_hits),
        "assistant_match": sorted(assistant_hits),
        "recent_match": sorted(hits),
        "title_only": bool(title_hits and not hits),
        "drift": bool(drift),
        "drift_evidence": drift,
    }


def is_routing_turn(dossier, prompt):
    """True for the session that is asking the question, not a destination.

    The router quotes the prompt verbatim, so its own session always wins a
    lexical match against the session that actually holds the work. The agent
    name alone is not enough: a router session can switch agents mid-turn.
    """
    if (dossier.get("agent") or "") == "router":
        return True
    return (dossier.get("first_user_prompt") or "").strip() == prompt.strip()


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
    generic_terms = generic or set()
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
            # One weak title word ("installing") matches half of ~/Projects.
            # Require two non-generic terms unless the prompt is a continuation.
            if not wants_context and len(title_hits - generic_terms) < 2:
                continue
            seen.add(sid)
            matched = ', '.join(sorted(title_hits)) or 'context prompt'
            out.append((row, f"session in {display_path(directory)}; {matched}"))
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
    for row, why in out[:8]:
        dossier = session_dossier(row, prompt, registry, snippet_chars, generic)
        dossier["why"] = why
        dossiers.append(dossier)
    return dossiers


def session_candidates(project_path, candidates, related, max_items=8, text_matches=None):
    """Resumable sessions in the project and its parent directories.

    The router reads this first. The full dossier stays below it for detail.
    A parent-directory session is a valid resume target even when its directory
    is outside the git repo. `text_matches` are whole-transcript hits, tried
    only when the tail window scored nothing.
    """
    project = expand(project_path) if project_path else None
    parent_directories = (project.parent, project.parent.parent) if project else ()
    entries = []
    seen = set()
    top = candidates[0] if candidates else None
    if top:
        for item in top.get("sessions") or []:
            session_id = item.get("sessionID")
            if not session_id or session_id in seen or item.get("agent") == "router":
                continue
            seen.add(session_id)
            entry = dict(item)
            entry["relation"] = "repo"
            entry["resumable"] = not bool(entry.get("child"))
            entry["session_matches_project"] = True
            entries.append(entry)
    for item in list(text_matches or []) + list(related or []):
        session_id = item.get("sessionID")
        if not session_id or session_id in seen or item.get("agent") == "router":
            continue
        seen.add(session_id)
        entry = dict(item)
        directory = entry.get("directory")
        relation = "title"
        if project and directory:
            session_path = expand(directory)
            if session_path == project:
                relation = "repo"
            elif session_path in parent_directories:
                relation = "parent"
        entry["relation"] = relation
        entry["resumable"] = not bool(entry.get("child"))
        entry["session_matches_project"] = bool(
            project and directory and str(expand(directory)) == str(project)
        )
        entries.append(entry)
    entries.sort(key=lambda item: (
        -len(item.get("user_match") or []),
        -len(item.get("recent_match") or []),
        -len(item.get("title_match") or []),
        -(item.get("updated") or 0),
    ))
    return entries[:max_items]


def text_matched_sessions(project_path, prompt, registry, snippet_chars, generic=None):
    """Sessions whose whole transcript matches, not just the tail.

    `session_dossier` scores the last few messages. In a long session the
    relevant turn scrolls out of that window, so the session cannot be found
    through it even though the text is still there.
    """
    terms = set(tokens(prompt)) - (generic or set()) - SESSION_STOPWORDS
    if len(terms) < 2:
        return []
    scored = []
    for row in session_rows(project_path, limit=200):
        if (row.get("agent") or "") == "router":
            continue
        hits = session_query_hits(row, terms, snippet_chars)
        matched = hits["title"] + hits["text"]
        if len(matched) < 2:
            continue
        dossier = session_dossier(row, prompt, registry, snippet_chars, generic)
        if is_routing_turn(dossier, prompt):
            continue
        dossier["why"] = f"full transcript matches: {', '.join(matched[:5])}"
        scored.append((len(matched), dossier))
    scored.sort(key=lambda item: (-item[0], -(item[1].get("updated") or 0)))
    return [dossier for _, dossier in scored[:3]]


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
        hits = [hit for hit in hits if (hit["row"].get("agent") or "") != "router"]
        if hits:
            top_row = hits[0]["row"]
            users, _ = session_messages(top_row.get("id"), len(prompt) + 100)
            if users and users[0].strip() == prompt.strip():
                hits = hits[1:]
        if not hits:
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
            if is_routing_turn(dossier, clean):
                continue
            if session_id in global_ids:
                dossier["why"] = "global session title matched the prompt"
            sessions.append(dossier)
        sessions.sort(key=lambda item: (
            -len(item["user_match"]),
            -len(item["recent_match"]),
            -len(item["title_match"]),
            -(item.get("updated") or 0),
        ))
        candidate["sessions"] = sessions[:max_sessions]
        # Signals keep the older ordering: a session located by its title speaks
        # for the project first. Only the list the router reads is re-ranked.
        signal_sessions = sorted(sessions, key=lambda item: 0 if item.get("why") else 1)
        user_hits = [item for item in signal_sessions if item["user_match"]]
        if user_hits:
            best_session = user_hits[0]
            matched = best_session["user_match"]
            specificity = "unique" if len(matched) >= 2 else "shared"
            evidence_prefix = "user prompts match"
        else:
            assistant_hits = [item for item in signal_sessions if item["assistant_match"]]
            best_session = assistant_hits[0] if assistant_hits else None
            matched = best_session["assistant_match"] if best_session else []
            specificity = "shared"
            evidence_prefix = "assistant text matches"
        if best_session:
            candidate["signals"].append({
                "kind": "session_text",
                "evidence": f"{best_session['sessionID']} {evidence_prefix}: {', '.join(matched[:5])}",
                "specificity": specificity,
            })
            if specificity == "unique":
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
    text_matches = []
    if candidates:
        seen_text = set()
        for candidate in candidates[:2]:
            if any(item.get("user_match") for item in (candidate.get("sessions") or [])):
                continue
            for item in text_matched_sessions(
                candidate["path"], clean, registry, snippet_chars, generic
            ):
                if item["sessionID"] in seen_text:
                    continue
                seen_text.add(item["sessionID"])
                text_matches.append(item)
    session_list = session_candidates(
        candidates[0]["path"] if candidates else None, candidates, related,
        text_matches=text_matches,
    )

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
        "session_candidates": session_list,
        "project_candidates": candidates,
        "references": references,
        "related_sessions": related,
        "warnings": warnings,
        "judgment": "The router decides. Read the evidence, check specificity, and ask when the candidates do not actually fit.",
    }


def compact_brief(data):
    """Trim the dossier to the part the router reads first."""
    candidates = []
    for candidate in (data.get("project_candidates") or [])[:3]:
        candidates.append({
            "path": candidate.get("path"),
            "display": candidate.get("display"),
            "name": candidate.get("name"),
            "remote": candidate.get("remote"),
            "direct_signals": candidate.get("direct_signals", 0),
            "unique_signals": candidate.get("unique_signals", 0),
            "shared_signals": candidate.get("shared_signals", 0),
            "rank_hint": candidate.get("rank_hint"),
            "session_hint": candidate.get("session_hint"),
            "signals": (candidate.get("signals") or [])[:6],
            "counter_signals": candidate.get("counter_signals") or [],
        })
    return {
        "prompt": {
            "raw": (data.get("prompt") or {}).get("raw", ""),
            "clean": (data.get("prompt") or {}).get("clean", ""),
            "shape": (data.get("prompt") or {}).get("shape", ""),
        },
        "index": data.get("index") or {},
        "session_candidates": data.get("session_candidates") or [],
        "project_candidates": candidates,
        "references": data.get("references") or [],
        "warnings": data.get("warnings") or [],
        "judgment": data.get("judgment", ""),
    }


# ── dispatch ─────────────────────────────────────────────────────────────────

def session_info(session_id):
    payload = api("get", f"/api/session/{session_id}")
    data = api_data(payload)
    if not isinstance(data, dict):
        raise RouteError(f"session {session_id} not found")
    return data


def parse_model(reference):
    """Split `provider/model[#variant]`, keeping slashes inside the model id."""
    if not reference:
        return None
    provider, separator, rest = reference.partition("/")
    if not separator or not provider or not rest:
        raise RouteError(f"model must be provider/model[#variant], got: {reference}")
    model, variant_separator, variant = rest.rpartition("#")
    if not variant_separator:
        model = rest
        variant = ""
    if not model:
        raise RouteError(f"model must be provider/model[#variant], got: {reference}")
    parsed = {"providerID": provider, "id": model}
    if variant:
        parsed["variant"] = variant
    return parsed


def dispatch(
    project=None,
    prompt_path=None,
    session=None,
    agent=None,
    title=None,
    model=None,
    dry_run=False,
    yes=False,
    watch=None,
    notify_session=None,
    sentinels=None,
):
    prompt = read_text(expand(prompt_path)).strip()
    if not prompt:
        raise RouteError("prompt file is empty")
    clean = clean_prompt(prompt)
    requested_project = expand(project) if project else None
    requested_model = parse_model(model)
    action = "new"
    resolved_session = None
    session_directory = None
    session_agent = None
    session_model = None
    session_title = None
    if session:
        info = session_info(session)
        if info.get("parentID") or info.get("parent_id"):
            raise RouteError(f"refusing to resume child session {session}")
        if (info.get("time") or {}).get("archived"):
            raise RouteError(f"refusing to resume archived session {session}")
        action = "resume"
        resolved_session = session
        session_directory = (info.get("location") or {}).get("directory")
        if not session_directory:
            raise RouteError(f"session {session} has no directory")
        project_path = expand(session_directory)
        if not project_path.is_dir():
            raise RouteError(f"session directory does not exist: {project_path}")
        session_agent = info.get("agent")
        session_model = normalize_model(info.get("model"))
        session_title = info.get("title")
    else:
        if not requested_project:
            raise RouteError("--project is required for a new session")
        project_path = requested_project
        if not project_path.is_dir():
            raise RouteError(f"project directory does not exist: {project_path}")
        root = git_root(project_path)
        if not root:
            raise RouteError(f"project is not inside a git repository: {project_path}")
        project_path = root
    actual_agent = session_agent if action == "resume" else (agent or "orchestrator")
    actual_title = session_title if action == "resume" else (title or f"{project_path.name}: {clean[:60]}")
    actual_model = session_model if action == "resume" else requested_model
    plan = {
        "action": action,
        "project": str(project_path),
        "project_display": display_path(project_path),
        "sessionID": resolved_session,
        "agent": actual_agent,
        "model": actual_model,
        "title": actual_title,
        "prompt_chars": len(prompt),
        "prompt_preview": prompt[:280],
        "dry_run": dry_run or not yes,
    }
    if requested_project and str(requested_project) != str(project_path):
        plan["requested_project"] = str(requested_project)
        plan["requested_project_display"] = display_path(requested_project)
    if action == "resume":
        plan["session_directory"] = session_directory
        if requested_project:
            plan["session_matches_project"] = str(expand(session_directory)) == str(requested_project)
        plan["open"] = f"opencode {project_path} -s {resolved_session}"
        if agent and agent != session_agent:
            plan["requested_agent"] = agent
        if requested_model and requested_model != session_model:
            plan["requested_model"] = requested_model
        if title and title != session_title:
            plan["requested_title"] = title
    if dry_run or not yes:
        return plan
    if action == "new":
        body = {
            "title": actual_title,
            "location": {"directory": str(project_path)},
            "agent": actual_agent,
        }
        if requested_model:
            body["model"] = requested_model
        payload = api("post", "/api/session", body)
        data = api_data(payload)
        resolved_session = (data or {}).get("id") or (data or {}).get("sessionID")
        if not resolved_session:
            raise RouteError("session create returned no id")
        plan["open"] = f"opencode {project_path} -s {resolved_session}"
    else:
        if requested_model and requested_model != session_model:
            api("post", f"/api/session/{resolved_session}/model", {"model": requested_model})
            plan["model"] = requested_model
        if agent and agent != session_agent:
            api("post", f"/api/session/{resolved_session}/agent", {"agent": agent})
            plan["agent"] = agent
        if title and title != session_title:
            api("patch", f"/api/session/{resolved_session}", {"title": title})
            plan["title"] = title
    api("post", f"/api/session/{resolved_session}/prompt", {"text": prompt})
    plan.update({
        "sessionID": resolved_session,
        "dry_run": False,
    })
    prompt_sha = hashlib.sha256(prompt.encode()).hexdigest()
    notify = watch_notify(watch, notify_session)
    spec = None
    if notify:
        try:
            spec = register_watch(
                plan,
                prompt_sha=prompt_sha,
                notify_session=notify,
                sentinels=sentinels or [],
            )
            plan["watch"] = {
                "dispatch_id": spec["dispatch_id"],
                "notify_session": notify,
                "spec": str(watch_spec_path(spec["dispatch_id"])),
            }
        except OSError as error:
            plan["watch_error"] = str(error)
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "at": int(time.time()),
            "action": action,
            "project": str(project_path),
            "sessionID": resolved_session,
            "agent": plan["agent"],
            "model": plan["model"],
            "title": plan["title"],
            "prompt_sha256": prompt_sha,
            "dispatch_id": spec["dispatch_id"] if spec else None,
            "notify_session": notify if spec else None,
        }) + "\n")
    return plan


# ── idle watch ───────────────────────────────────────────────────────────────

def watch_notify(watch, notify_session):
    """Resolve the session to wake when the dispatch finishes."""
    if watch is False:
        return None
    if notify_session:
        return notify_session
    if watch is True:
        session_id = os.environ.get("OPENCODE_SESSION_ID")
        if not session_id:
            raise RouteError("--notify-session is required when OPENCODE_SESSION_ID is unset")
        return session_id
    return os.environ.get("OPENCODE_SESSION_ID")


def watch_spec_path(dispatch_id):
    return WATCH_DIR / f"{dispatch_id}.json"


def load_watch_spec(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RouteError(f"cannot read watch spec {path}: {error}") from error


def write_watch_spec(spec):
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    path = watch_spec_path(spec["dispatch_id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    return path


def start_watcher(spec_path):
    """Detach the watcher: in-session background jobs get reaped."""
    WATCH_LOG.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, str(Path(__file__).resolve()), "watch", "--spec", str(spec_path)]
    with WATCH_LOG.open("a", encoding="utf-8") as log:
        return subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )


def register_watch(plan, prompt_sha, notify_session, sentinels=(), start=True):
    at = int(time.time())
    dispatch_id = hashlib.sha256(
        f"{plan['sessionID']}:{prompt_sha}:{at}".encode()
    ).hexdigest()[:16]
    spec = {
        "version": 1,
        "dispatch_id": dispatch_id,
        "target": plan["sessionID"],
        "notify": notify_session,
        "project": plan["project"],
        "agent": plan["agent"],
        "model": plan["model"],
        "title": plan["title"],
        "prompt_sha256": prompt_sha,
        "sentinels": [str(expand(path)) for path in sentinels],
        "created_at": at,
        "status": "pending",
    }
    path = write_watch_spec(spec)
    if start:
        start_watcher(path)
    return spec


def claim_watch(path):
    """Return an open lock handle, or None when another watcher owns the spec."""
    lock_path = Path(path).with_suffix(".lock")
    handle = lock_path.open("a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def active_session_ids():
    try:
        payload = api("get", "/api/session/active")
    except RouteError:
        return set()
    return set((api_data(payload) or {}).keys())


def descendant_ids(target):
    db = Path(os.environ.get("OPENCODE_DB", HOME / ".local/share/opencode/opencode.db"))
    if not db.exists():
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        rows = con.execute(
            "select id, parent_id from session_v2 where time_archived is null"
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return []
    children = {}
    for session_id, parent in rows:
        children.setdefault(parent, []).append(session_id)
    found = []
    seen = {target}
    stack = [target]
    while stack:
        for child in children.get(stack.pop(), []):
            if child in seen:
                continue
            seen.add(child)
            found.append(child)
            stack.append(child)
    return found


def pending_inbox(session_id):
    try:
        payload = api("get", f"/api/session/{session_id}/inbox")
    except RouteError:
        return False
    return bool(api_data(payload))


def session_outcomes(session_ids):
    if not session_ids:
        return {}
    db = Path(os.environ.get("OPENCODE_DB", HOME / ".local/share/opencode/opencode.db"))
    if not db.exists():
        return {}
    placeholders = ",".join("?" for _ in session_ids)
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        rows = con.execute(
            f"select id, idle_outcome from session_v2 where id in ({placeholders})",
            session_ids,
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return {}
    return {session_id: outcome for session_id, outcome in rows}


def tree_idle_state(target, active, descendants, inboxes, outcomes, sentinels=()):
    """True only when no session, queued input, or sentinel blocks completion."""
    reasons = []
    if target in active:
        reasons.append("target active")
    for session_id in descendants:
        if session_id in active:
            reasons.append(f"child {session_id} active")
    for session_id in [target, *descendants]:
        if inboxes.get(session_id):
            reasons.append(f"{session_id} has queued input")
    outcome = outcomes.get(target)
    if outcome not in ("succeeded", "failed", "interrupted"):
        reasons.append(f"target outcome {outcome!r} is not terminal")
    missing = [str(path) for path in sentinels if not Path(path).exists()]
    if missing:
        reasons.append("missing sentinels: " + ", ".join(missing))
    return (not reasons), reasons


def sample_tree(spec):
    target = spec["target"]
    descendants = descendant_ids(target)
    ids = [target, *descendants]
    return tree_idle_state(
        target,
        active_session_ids(),
        descendants,
        {session_id: pending_inbox(session_id) for session_id in ids},
        session_outcomes(ids),
        spec.get("sentinels") or [],
    )


def wait_for_turn(target):
    """The wait endpoint covers one turn only, not the child tree."""
    try:
        api("post", f"/api/experimental/session/{target}/wait")
    except RouteError as error:
        log_watch(f"wait {target}: {error}")


def log_watch(message):
    WATCH_LOG.parent.mkdir(parents=True, exist_ok=True)
    with WATCH_LOG.open("a", encoding="utf-8") as log:
        log.write(f"{int(time.time())} {message}\n")


def watch_summary(target):
    users, assistants = session_messages(target, 700)
    text = assistants[-1] if assistants else (users[-1] if users else "")
    return text.replace("\n", " ")[:700]


def finish_watch(spec, status, outcome, summary=""):
    """Wake the caller once. The fired marker makes retries harmless."""
    if spec.get("status") != "pending":
        return spec
    target = spec["target"]
    notify = spec.get("notify")
    result = {
        "dispatch_id": spec["dispatch_id"],
        "target": target,
        "notify": notify,
        "status": status,
        "outcome": outcome,
        "summary": summary,
        "at": int(time.time()),
    }
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    result_path = WATCH_DIR / f"{spec['dispatch_id']}.result.json"
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if notify and notify != target:
        text = (
            f"[route-watch] dispatch={spec['dispatch_id']} target={target} "
            f"outcome={outcome}\n{summary or 'The watch could not confirm completion.'}\n\n"
            "Verify the target session and report the result to the user. "
            "Do not redispatch without confirmation. End your turn."
        )
        api("post", f"/api/session/{notify}/prompt", {"text": text})
    spec["status"] = status
    spec["finished_at"] = result["at"]
    spec["result"] = str(result_path)
    write_watch_spec(spec)
    return spec


def run_watch(spec, quiet_seconds=5, max_hours=24, poll_seconds=2):
    path = watch_spec_path(spec["dispatch_id"])
    lock = claim_watch(path)
    if lock is None:
        return {"dispatch_id": spec["dispatch_id"], "status": "locked"}
    deadline = time.time() + max_hours * 3600
    try:
        while True:
            current = load_watch_spec(path)
            if current.get("status") != "pending":
                return current
            if (WATCH_DIR / "STOP").exists():
                current["status"] = "cancelled"
                write_watch_spec(current)
                return current
            if time.time() > deadline:
                return finish_watch(
                    current, "timed_out", "watch timeout",
                    f"No fully idle state within {max_hours} hours.",
                )
            wait_for_turn(spec["target"])
            idle, _ = sample_tree(current)
            if idle:
                time.sleep(quiet_seconds)
                current = load_watch_spec(path)
                if current.get("status") != "pending":
                    return current
                idle_again, _ = sample_tree(current)
                if idle_again:
                    outcome = session_outcomes([spec["target"]]).get(spec["target"]) or "unknown"
                    return finish_watch(current, "fired", outcome, watch_summary(spec["target"]))
            time.sleep(poll_seconds)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


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
    data = build_brief(args.prompt_file)
    if args.compact:
        data = compact_brief(data)
    print(json.dumps(data, indent=2))
    return 0


def session_query_hits(row, query, snippet_chars, match_all=False):
    """Title and message-text matches for `sessions --query`.

    A title never hides a text match: a session titled after the topic that
    started it still holds the later discussion. With match_all, every query
    term must appear in the title or the transcript.
    """
    title_hits = set(query) & set(tokens(row.get("title", "")))
    users, assistants = session_messages(row.get("id"), snippet_chars)
    text_hits = set(query) & set(tokens(" ".join(users + assistants)))
    found = title_hits | text_hits
    if match_all and found != set(query):
        return {"title": [], "text": []}
    return {"title": sorted(title_hits), "text": sorted(text_hits - title_hits)}


def command_sessions(args):
    registry = load_registry()
    snippet_chars = int(registry["signals"]["snippet_chars"])
    query = set(tokens(args.query)) if args.query else set()
    if args.project:
        rows = session_rows(args.project, limit=args.limit)
    else:
        # No project named: search the newest sessions across every project.
        rows = sorted(
            db_session_rows(),
            key=lambda row: (row.get("time") or {}).get("updated") or 0,
            reverse=True,
        )
        rows = rows[: max(args.limit, 300) if query else args.limit]
    match_all = bool(query) and not args.any
    output = []
    for row in rows:
        hits = (
            session_query_hits(row, query, snippet_chars, match_all=match_all)
            if query else {"title": [], "text": []}
        )
        if query and not hits["title"] and not hits["text"]:
            continue
        entry = {
            "sessionID": row.get("id"),
            "title": row.get("title"),
            "agent": row.get("agent"),
            "model": normalize_model(row.get("model")),
            "directory": (row.get("location") or {}).get("directory"),
            "updated": (row.get("time") or {}).get("updated"),
            "outcome": row.get("outcome"),
            "child": bool(row.get("parentID") or row.get("parent_id")),
            "parent": row.get("parentID") or row.get("parent_id"),
            "archived": bool((row.get("time") or {}).get("archived")),
        }
        if query:
            entry["matched"] = hits["title"] or hits["text"]
        if args.detail:
            users, assistants = session_messages(row.get("id"), snippet_chars)
            entry["first_user_prompt"] = users[0] if users else ""
            entry["last_user_prompts"] = users[-3:]
            entry["last_assistant_excerpts"] = assistants[-2:]
        output.append(entry)
    print(json.dumps(output, indent=2))
    return 0


def command_dispatch(args):
    watch = None if args.watch == args.no_watch else not args.no_watch
    print(json.dumps(dispatch(
        args.project, args.prompt_file, session=args.session, agent=args.agent,
        title=args.title, model=args.model, dry_run=args.dry_run, yes=args.yes,
        watch=watch, notify_session=args.notify_session, sentinels=args.sentinel,
    ), indent=2))
    return 0


def command_watch(args):
    spec = load_watch_spec(args.spec)
    result = run_watch(spec, quiet_seconds=args.quiet_seconds, max_hours=args.max_hours)
    print(json.dumps({
        "dispatch_id": spec["dispatch_id"],
        "status": result.get("status"),
        "spec": str(watch_spec_path(spec["dispatch_id"])),
    }, indent=2))
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
    brief.add_argument("--compact", action="store_true")
    brief.set_defaults(func=command_brief)

    sessions = sub.add_parser("sessions")
    sessions.add_argument("--project", help="limit to one project; omit to search everywhere")
    sessions.add_argument("--query", default="")
    sessions.add_argument("--any", action="store_true", help="match any term instead of all")
    sessions.add_argument("--detail", action="store_true")
    sessions.add_argument("--limit", type=int, default=50)
    sessions.set_defaults(func=command_sessions)

    dispatch_parser = sub.add_parser("dispatch")
    dispatch_parser.add_argument("--project")
    dispatch_parser.add_argument("--prompt-file", required=True)
    dispatch_parser.add_argument("--session")
    dispatch_parser.add_argument("--agent")
    dispatch_parser.add_argument("--model")
    dispatch_parser.add_argument("--title")
    dispatch_parser.add_argument("--dry-run", action="store_true")
    dispatch_parser.add_argument("--yes", action="store_true")
    dispatch_parser.add_argument("--watch", action="store_true")
    dispatch_parser.add_argument("--no-watch", action="store_true")
    dispatch_parser.add_argument("--notify-session")
    dispatch_parser.add_argument("--sentinel", action="append", default=[])
    dispatch_parser.set_defaults(func=command_dispatch)

    watch_parser = sub.add_parser("watch")
    watch_parser.add_argument("--spec", required=True)
    watch_parser.add_argument("--quiet-seconds", type=int, default=5)
    watch_parser.add_argument("--max-hours", type=int, default=24)
    watch_parser.set_defaults(func=command_watch)

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
