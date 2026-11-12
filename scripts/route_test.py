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
            "id text, title text, directory text, agent text, idle_outcome text, "
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

    def add_session(self, session_id, title, directory, parent=None, archived=0, updated=1):
        self.connection.execute(
            "insert into session_v2 values (?, ?, ?, 'build', 'succeeded', ?, ?, ?, ?)",
            (session_id, title, str(directory), parent, archived or None, updated, updated),
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


class DispatchTests(RouteTestCase):
    def setUp(self):
        super().setUp()
        self.repo_path = self.repo("project")
        self.prompt_path = self.root / "prompt.txt"
        self.prompt_text = 'fix "quotes"\nand unicode ✅'
        self.prompt_path.write_text(self.prompt_text, encoding="utf-8")
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
        raise AssertionError(f"unexpected API call: {method} {path}")

    def fake_info(self, session_id):
        return {"id": session_id, "location": {"directory": str(self.repo_path)}}

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
