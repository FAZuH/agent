#!/usr/bin/env python3
"""Tests for route.py, the project/session router.

Run with:
    python3 scripts/route_test.py

The tests import route.py directly and patch its module globals, so no
configuration or live OpenCode database is touched.
"""

import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROUTE_PATH = Path(__file__).with_name("route.py")
SPEC = importlib.util.spec_from_file_location("route", ROUTE_PATH)
route = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(route)


class RouteTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.old_home = route.HOME
        self.old_ledger = route.LEDGER_PATH
        route.HOME = self.root
        route.LEDGER_PATH = self.root / "state" / "routes.jsonl"

    def tearDown(self):
        route.HOME = self.old_home
        route.LEDGER_PATH = self.old_ledger
        self.tmp.cleanup()

    def repo(self, name, files=()):
        path = self.root / name
        (path / ".git").mkdir(parents=True, exist_ok=True)
        for relative in files:
            target = path / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("", encoding="utf-8")
        return path

    def project(self, path, name=None, remote=""):
        return {
            "path": str(path),
            "display": route.display_path(path),
            "name": name or path.name,
            "remote": remote,
            "remote_norm": route.normalize_remote(remote),
            "readme": "",
            "agents": "",
            "summary": "",
            "files": [],
            "last_commit": 0,
            "scratch": [],
        }

    def registry(self):
        data = route.default_registry()
        data["projects"] = {}
        return data


class TokenTests(unittest.TestCase):
    def test_camel_case_and_punctuation_split(self):
        self.assertEqual(
            route.tokens("Fix getConfigurations in pr-creator/route.py"),
            ["fix", "get", "configurations", "creator", "route"],
        )

    def test_stopwords_and_short_words_drop(self):
        self.assertEqual(route.tokens("add a router to the agent"), ["add", "router", "agent"])

    def test_identifier_phrases(self):
        phrases = route.identifier_phrases(
            "fix pr-creator and space+l+T on getConfigurations in answer-key"
        )
        self.assertIn("pr-creator", phrases)
        self.assertIn("getconfigurations", phrases)
        self.assertIn("answer-key", phrases)

    def test_match_token_prefix_ratio(self):
        self.assertEqual(route.match_token("postfix", {"postfixctl"}), ("postfixctl", "prefix"))
        self.assertEqual(route.match_token("beta", {"betamax"}), (None, None))
        self.assertEqual(route.match_token("graf", {"grafana"}), (None, None))
        self.assertEqual(route.match_token("agent", {"agent"}), ("agent", "exact"))


class CandidateTests(RouteTestCase):
    def test_content_path_beats_generic_name(self):
        target = self.repo("agent", ["skills/workflow/pr-creator/SKILL.md"])
        project = self.project(target)
        project["files"] = ["skills/workflow/pr-creator/SKILL.md"]
        candidates, references, _ = route.project_candidates(
            "fix the pr-creator skill", [project], self.registry()
        )
        self.assertEqual(len(candidates), 1)
        self.assertTrue(any(signal["kind"] == "content" for signal in candidates[0]["signals"]))
        self.assertFalse(references)

    def test_url_match_is_direct_and_unmatched_url_is_reference(self):
        local = self.repo("local")
        project = self.project(local, remote="https://github.com/example/answer-key")
        candidates, references, _ = route.project_candidates(
            "align with https://github.com/example/answer-key", [project], self.registry()
        )
        self.assertEqual(candidates[0]["direct_signals"], 1)
        self.assertFalse(references)

        candidates, references, _ = route.project_candidates(
            "align with https://github.com/other/thing", [project], self.registry()
        )
        self.assertFalse(candidates)
        self.assertEqual(references[0]["github"], "github.com/other/thing")

    def test_generic_only_candidate_is_dropped(self):
        project = self.project(self.repo("anything"))
        registry = self.registry()
        registry["signals"]["generic_terms"] = ["project"]
        candidates, _, _ = route.project_candidates("the project", [project], registry)
        self.assertEqual(candidates, [])

    def test_direct_signal_outranks_more_unique_signals(self):
        direct = {"direct_signals": 1, "unique_signals": 0, "shared_signals": 0, "path": "b"}
        indirect = {"direct_signals": 0, "unique_signals": 3, "shared_signals": 2, "path": "a"}
        self.assertLess(route.candidate_rank(direct), route.candidate_rank(indirect))


class SessionTests(RouteTestCase):
    def setUp(self):
        super().setUp()
        self.old_db = os.environ.get("OPENCODE_DB")
        self.db = self.root / "opencode.db"
        os.environ["OPENCODE_DB"] = str(self.db)
        connection = sqlite3.connect(self.db)
        connection.execute(
            "create table session_v2 ("
            "id text, title text, directory text, agent text, model text, idle_outcome text, "
            "parent_id text, time_archived integer, time_created integer, time_updated integer)"
        )
        self.connection = connection

    def tearDown(self):
        self.connection.close()
        if self.old_db is None:
            os.environ.pop("OPENCODE_DB", None)
        else:
            os.environ["OPENCODE_DB"] = self.old_db
        super().tearDown()

    def add_session(self, session_id, title, directory, parent=None, archived=0, updated=1, model=None):
        self.connection.execute(
            "insert into session_v2 values (?, ?, ?, 'build', ?, 'succeeded', ?, ?, ?, ?)",
            (session_id, title, str(directory), model, parent, archived or None, updated, updated),
        )
        self.connection.commit()

    def test_title_hits_map_to_deepest_project(self):
        outer = self.repo("outer")
        inner = self.repo("outer/inner")
        self.add_session("ses_1", "Investigate relay email", inner)
        projects = [self.project(outer), self.project(inner)]
        hits = route.session_title_hits(
            "investigate the relay email again", projects, self.registry(), set()
        )
        self.assertIn(str(inner), hits)
        self.assertNotIn(str(outer), hits)
        self.assertEqual(hits[str(inner)][0]["matched"], ["email", "relay"])

    def test_title_hits_include_child_sessions(self):
        repo = self.repo("workbench")
        self.add_session("ses_child", "Hindsight relay", repo, parent="ses_parent")
        projects = [self.project(repo)]
        hits = route.session_title_hits("hindsight relay", projects, self.registry(), set())
        self.assertIn(str(repo), hits)
        self.assertEqual(hits[str(repo)][0]["row"]["parentID"], "ses_parent")

    def test_title_hits_skip_common_title_terms(self):
        repo = self.repo("repo")
        for index in range(20):
            self.add_session(f"ses_noise_{index}", "Planning notes", self.root / "elsewhere")
        self.add_session("ses_target", "Hindsight planning", repo)
        projects = [self.project(repo)]
        hits = route.session_title_hits("planning hindsight", projects, self.registry(), set())
        self.assertIn(str(repo), hits)
        self.assertEqual(hits[str(repo)][0]["matched"], ["hindsight"])

    def test_archived_sessions_do_not_match(self):
        repo = self.repo("repo")
        self.add_session("ses_archived", "Hindsight work", repo, archived=1)
        projects = [self.project(repo)]
        self.assertEqual(
            route.session_title_hits("hindsight", projects, self.registry(), set()), {}
        )

    def test_drift_detection_reads_recent_text(self):
        source = self.repo("source")
        other = self.repo("other")
        old_messages = route.session_messages
        route.session_messages = lambda session_id, chars: (
            [f"work moved to {other}"],
            [],
        )
        try:
            dossier = route.session_dossier(
                {"id": "ses_1", "title": "work", "location": {"directory": str(source)}},
                "work",
                self.registry(),
                400,
            )
        finally:
            route.session_messages = old_messages
        self.assertTrue(dossier["drift"])
        self.assertIn("other", dossier["drift_evidence"][0])

    def test_db_rows_include_model(self):
        repo = self.repo("repo")
        self.add_session(
            "ses_model",
            "OOP-Module6 repository migration",
            repo,
            model='{"providerID": "commandcode", "id": "deepseek/deepseek-v4.1-flash", "variant": "max"}',
        )
        rows = route.db_session_rows()
        self.assertEqual(rows[0]["model"], {
            "providerID": "commandcode",
            "id": "deepseek/deepseek-v4.1-flash",
            "variant": "max",
        })

    def test_session_dossier_splits_user_and_assistant_matches(self):
        repo = self.repo("repo")
        old_messages = route.session_messages
        route.session_messages = lambda session_id, chars: (
            ["migrate the PA8 assignment repository"],
            ["the observer pattern is unrelated"],
        )
        try:
            dossier = route.session_dossier(
                {"id": "ses_1", "title": "notes", "location": {"directory": str(repo)}},
                "migrate PA8 assignment observer",
                self.registry(),
                400,
            )
        finally:
            route.session_messages = old_messages
        self.assertEqual(dossier["user_match"], ["assignment", "pa8"])
        self.assertEqual(dossier["assistant_match"], ["observer"])
        self.assertEqual(dossier["recent_match"], ["assignment", "observer", "pa8"])

    def test_session_candidates_merge_parent_sessions_first(self):
        repo = self.repo("practicum/FarisAhmadZubairBauw_OOP")
        parent = repo.parent
        candidates = [{
            "path": str(repo),
            "sessions": [{
                "sessionID": "ses_repo",
                "child": False,
                "directory": str(repo),
                "user_match": ["module"],
                "recent_match": ["module"],
                "title_match": [],
                "updated": 5,
            }],
        }]
        related = [{
            "sessionID": "ses_parent",
            "child": False,
            "directory": str(parent),
            "user_match": ["assignment", "pa8", "repository"],
            "recent_match": ["assignment", "pa8", "repository"],
            "title_match": ["migration"],
            "updated": 1,
        }]
        entries = route.session_candidates(str(repo), candidates, related)
        self.assertEqual([entry["sessionID"] for entry in entries], ["ses_parent", "ses_repo"])
        self.assertEqual([entry["relation"] for entry in entries], ["parent", "repo"])
        self.assertTrue(all(entry["resumable"] for entry in entries))

    def test_session_candidates_mark_child_sessions_unresumable(self):
        repo = self.repo("repo")
        candidates = [{"path": str(repo), "sessions": [{
            "sessionID": "ses_child",
            "child": True,
            "directory": str(repo),
            "user_match": [],
            "recent_match": [],
            "title_match": [],
            "updated": 1,
        }]}]
        entries = route.session_candidates(str(repo), candidates, [])
        self.assertFalse(entries[0]["resumable"])

    def test_session_candidates_skip_router_sessions(self):
        repo = self.repo("repo")
        candidates = [{"path": str(repo), "sessions": [
            {
                "sessionID": "ses_router",
                "agent": "router",
                "directory": str(repo),
                "user_match": ["a", "b", "c"],
                "recent_match": ["a", "b", "c"],
                "title_match": [],
                "updated": 9,
            },
            {
                "sessionID": "ses_work",
                "agent": "build",
                "directory": str(repo),
                "user_match": ["a"],
                "recent_match": ["a"],
                "title_match": [],
                "updated": 1,
            },
        ]}]
        entries = route.session_candidates(str(repo), candidates, [])
        self.assertEqual([entry["sessionID"] for entry in entries], ["ses_work"])

    def test_session_candidates_label_distant_ancestors_as_title(self):
        repo = self.repo("college/semester/project")
        distant = repo.parent.parent.parent
        related = [{
            "sessionID": "ses_distant",
            "agent": "build",
            "directory": str(distant),
            "user_match": [],
            "recent_match": [],
            "title_match": ["project"],
            "updated": 1,
        }]
        entries = route.session_candidates(str(repo), [], related)
        self.assertEqual(entries[0]["relation"], "title")

    def test_compact_brief_keeps_sessions_and_limits_projects(self):
        data = {
            "prompt": {"raw": "x", "clean": "x", "shape": "task", "tokens": ["x"]},
            "index": {"projects": 2},
            "session_candidates": [{"sessionID": "ses_1"}],
            "project_candidates": [{"path": f"/p{index}"} for index in range(4)],
            "related_sessions": [{"sessionID": "ses_1"}],
            "references": [],
            "warnings": ["w"],
            "judgment": "j",
        }
        compact = route.compact_brief(data)
        self.assertEqual(len(compact["project_candidates"]), 3)
        self.assertNotIn("tokens", compact["prompt"])
        self.assertNotIn("related_sessions", compact)
        self.assertEqual(compact["session_candidates"], [{"sessionID": "ses_1"}])

    def test_session_query_searches_message_text(self):
        old_messages = route.session_messages
        route.session_messages = lambda session_id, chars: (
            ["migrate the PA8 assignment module"],
            [],
        )
        try:
            hits = route.session_query_hits(
                {"id": "ses_1", "title": "OOP-Module6"}, {"assignment"}, 400
            )
        finally:
            route.session_messages = old_messages
        self.assertEqual(hits, {"title": [], "text": ["assignment"]})

    def test_session_query_reads_text_when_the_title_matches(self):
        old_messages = route.session_messages
        route.session_messages = lambda session_id, chars: (["the jev plugin"], [])
        try:
            hits = route.session_query_hits(
                {"id": "ses_1", "title": "supervisor notes"},
                {"supervisor", "jev"},
                400,
            )
        finally:
            route.session_messages = old_messages
        self.assertEqual(hits["title"], ["supervisor"])
        self.assertEqual(hits["text"], ["jev"])

    def test_session_query_can_require_every_term(self):
        old_messages = route.session_messages
        route.session_messages = lambda session_id, chars: (["the jev plugin"], [])
        row = {"id": "ses_1", "title": "supervisor notes"}
        try:
            partial = route.session_query_hits(row, {"supervisor", "missing"}, 400, match_all=True)
            full = route.session_query_hits(row, {"supervisor", "jev"}, 400, match_all=True)
        finally:
            route.session_messages = old_messages
        self.assertEqual(partial, {"title": [], "text": []})
        self.assertEqual(full["title"], ["supervisor"])
        self.assertEqual(full["text"], ["jev"])

    def test_routing_turn_is_the_session_that_asks(self):
        prompt = "search my sessions for the supervisor discussion"
        self.assertTrue(route.is_routing_turn(
            {"agent": "build", "first_user_prompt": prompt}, prompt
        ))
        self.assertTrue(route.is_routing_turn(
            {"agent": "router", "first_user_prompt": "something else"}, prompt
        ))
        self.assertFalse(route.is_routing_turn(
            {"agent": "build", "first_user_prompt": "an older task"}, prompt
        ))


class DispatchTests(RouteTestCase):
    def setUp(self):
        super().setUp()
        self.repo_path = self.repo("project")
        self.prompt_path = self.root / "prompt.txt"
        self.prompt_text = 'fix "quotes"\nand unicode ✅'
        self.prompt_path.write_text(self.prompt_text, encoding="utf-8")
        self.session_dir = self.repo_path
        self.session_title = "OOP-Module6 repository migration"
        self.session_agent = "build"
        self.session_model = {
            "providerID": "commandcode",
            "id": "deepseek/deepseek-v4.1-flash",
            "variant": "max",
        }
        self.calls = []
        self.old_api = route.api
        self.old_info = route.session_info
        route.api = self.fake_api
        route.session_info = self.fake_info

    def tearDown(self):
        route.api = self.old_api
        route.session_info = self.old_info
        super().tearDown()

    def fake_api(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "post" and path == "/api/session":
            return {"data": {"id": "ses_new"}}
        if method == "post" and path.endswith("/prompt"):
            return {"data": {"accepted": True}}
        if method == "post" and (path.endswith("/model") or path.endswith("/agent")):
            return {"data": {"accepted": True}}
        if method == "patch" and path.startswith("/api/session/"):
            return {"data": {"accepted": True}}
        raise AssertionError(f"unexpected API call: {method} {path}")

    def fake_info(self, session_id):
        return {
            "id": session_id,
            "title": self.session_title,
            "agent": self.session_agent,
            "model": dict(self.session_model),
            "location": {"directory": str(self.session_dir)},
        }

    def test_dry_run_makes_no_api_calls(self):
        plan = route.dispatch(
            str(self.repo_path), str(self.prompt_path), dry_run=True, yes=False
        )
        self.assertTrue(plan["dry_run"])
        self.assertEqual(self.calls, [])

    def test_without_yes_still_dry_run(self):
        plan = route.dispatch(
            str(self.repo_path), str(self.prompt_path), dry_run=False, yes=False
        )
        self.assertTrue(plan["dry_run"])
        self.assertEqual(self.calls, [])

    def test_yes_creates_and_prompts_with_exact_text(self):
        plan = route.dispatch(
            str(self.repo_path), str(self.prompt_path), dry_run=False, yes=True
        )
        self.assertFalse(plan["dry_run"])
        self.assertEqual(plan["sessionID"], "ses_new")
        create = [call for call in self.calls if call[1] == "/api/session"][0]
        self.assertEqual(create[2]["location"]["directory"], str(self.repo_path))
        self.assertNotIn("model", create[2])
        prompt = [call for call in self.calls if call[1].endswith("/prompt")][0]
        self.assertEqual(prompt[2]["text"], self.prompt_text)

    def test_explicit_model_is_forwarded(self):
        route.dispatch(
            str(self.repo_path),
            str(self.prompt_path),
            model="example/team/model-v2",
            dry_run=False,
            yes=True,
        )
        create = [call for call in self.calls if call[1] == "/api/session"][0]
        self.assertEqual(
            create[2]["model"], {"providerID": "example", "id": "team/model-v2"}
        )

    def test_parse_model_keeps_slashes(self):
        self.assertEqual(
            route.parse_model("example/team/model-v2"),
            {"providerID": "example", "id": "team/model-v2"},
        )
        with self.assertRaises(route.RouteError):
            route.parse_model("no-slash")

    def test_parse_model_supports_variant(self):
        self.assertEqual(
            route.parse_model("commandcode/deepseek/deepseek-v4.1-flash#max"),
            {
                "providerID": "commandcode",
                "id": "deepseek/deepseek-v4.1-flash",
                "variant": "max",
            },
        )

    def test_resume_without_project_uses_session_directory_and_keeps_state(self):
        self.session_dir = self.root / "practicum parent"
        self.session_dir.mkdir(parents=True)
        plan = route.dispatch(
            prompt_path=str(self.prompt_path),
            session="ses_resume",
            dry_run=False,
            yes=True,
        )
        self.assertEqual(plan["action"], "resume")
        self.assertEqual(plan["project"], str(self.session_dir))
        self.assertEqual(plan["agent"], self.session_agent)
        self.assertEqual(plan["model"], self.session_model)
        self.assertEqual(plan["title"], self.session_title)
        self.assertIn("ses_resume", plan["open"])
        self.assertFalse(any(call[1].endswith("/model") for call in self.calls))
        self.assertFalse(any(call[1].endswith("/agent") for call in self.calls))
        prompt = [call for call in self.calls if call[1].endswith("/prompt")][0]
        self.assertEqual(prompt[1], "/api/session/ses_resume/prompt")
        self.assertEqual(prompt[2]["text"], self.prompt_text)

    def test_resume_with_project_reports_where_the_session_lives(self):
        self.session_dir = self.root / "practicum parent"
        self.session_dir.mkdir(parents=True)
        plan = route.dispatch(
            str(self.repo_path),
            str(self.prompt_path),
            session="ses_resume",
            dry_run=True,
        )
        self.assertEqual(plan["project"], str(self.session_dir))
        self.assertEqual(plan["requested_project"], str(self.repo_path))
        self.assertFalse(plan["session_matches_project"])

    def test_resume_switches_model_agent_and_title_when_passed(self):
        plan = route.dispatch(
            prompt_path=str(self.prompt_path),
            session="ses_resume",
            agent="orchestrator",
            model="example/team/model-v2#max",
            title="New title",
            dry_run=False,
            yes=True,
        )
        expected_model = {
            "providerID": "example",
            "id": "team/model-v2",
            "variant": "max",
        }
        self.assertEqual(plan["agent"], "orchestrator")
        self.assertEqual(plan["model"], expected_model)
        self.assertEqual(plan["title"], "New title")
        model_call = [call for call in self.calls if call[1].endswith("/model")][0]
        self.assertEqual(model_call[2], {"model": expected_model})
        agent_call = [call for call in self.calls if call[1].endswith("/agent")][0]
        self.assertEqual(agent_call[2], {"agent": "orchestrator"})
        title_call = [call for call in self.calls if call[0] == "patch"][0]
        self.assertEqual(title_call[1], "/api/session/ses_resume")
        self.assertEqual(title_call[2], {"title": "New title"})

    def test_new_session_requires_project(self):
        with self.assertRaises(route.RouteError):
            route.dispatch(prompt_path=str(self.prompt_path), dry_run=True)

    def test_resume_refuses_child_session(self):
        route.session_info = lambda session_id: {
            "id": session_id,
            "parentID": "ses_parent",
            "location": {"directory": str(self.repo_path)},
        }
        with self.assertRaises(route.RouteError):
            route.dispatch(
                str(self.repo_path),
                str(self.prompt_path),
                session="ses_child",
                dry_run=False,
                yes=True,
            )

    def test_ledger_stores_hashes_not_prompt_text(self):
        route.dispatch(str(self.repo_path), str(self.prompt_path), dry_run=False, yes=True)
        line = route.LEDGER_PATH.read_text(encoding="utf-8").strip()
        record = json.loads(line)
        self.assertEqual(len(record["prompt_sha256"]), 64)
        self.assertNotIn(self.prompt_text, line)


if __name__ == "__main__":
    unittest.main(verbosity=2)
