"""Offline checks that demo evidence cannot pass on nominal HTTP success."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import scifact
import demo_scifact as demo
sys.path.pop(0)


class DemoSciFactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / "scifact"
        (self.data / "qrels").mkdir(parents=True)
        corpus = [{"_id": "10", "title": "Paper A", "text": "Original evidence A."},
                  {"_id": "20", "title": "Paper B", "text": "Original evidence B."}]
        queries = [{"_id": "1", "text": "Cancer claim one."}, {"_id": "2", "text": "Cancer claim two."}]
        for name, rows in (("corpus.jsonl", corpus), ("queries.jsonl", queries)):
            (self.data / name).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
        (self.data / "qrels/test.tsv").write_text("query-id\tcorpus-id\tscore\n1\t10\t1\n2\t20\t1\n", encoding="utf-8")
        self.output = self.root / "demo"
        self.manifest = scifact.prepare(self.data, self.output, count=2)
        self.args = argparse.Namespace(
            manifest=self.output / "manifest.json", data_dir=self.data, base_url="http://127.0.0.1:3000",
            model="test-qwen", limit=2, questions=1, timeout=1, output=self.root / "evidence/report.json",
        )
        self.report = {"status": "running", "ingests": [], "queries": []}
        self.settings = {"wikiPath": "/demo/wiki", "settings": {"defaultModels": {
            slot: {"provider": "ollama", "model": "test-qwen"} for slot in ("ingest", "query")
        }, "requireApprovalForIngest": False}}
        self.sources = {}
        self.pages = {}
        for number, document in enumerate(self.manifest["documents"], 1):
            text = (self.output / document["file"]).read_text()
            title = f"SciFact {document['corpus_id']} — {document['title']}"
            self.sources[f"source-{number}"] = {
                "source": {"id": f"source-{number}", "title": document["title"], "ingestedAt": "2026-10-17T00:00:00Z"},
                "rawText": f"# {title}\n\n{text.strip()}\n", "truncated": False, "rawError": None,
            }
            self.pages[f"page-{number}"] = {
                "slug": f"page-{number}", "content": f"Persisted summary {number}.",
                "frontmatter": {"sources": [f"source-{number}"]},
            }
        self.query_result = {"ok": True, "response": {"answer": "Evidence in [[page-1]].", "pagesUsed": ["page-1"]}}
        self.ingest_transform = lambda result: result
        self.on_query = lambda: None
        self.ingest_count = 0
        self.calls = []

    def mock_request(self, base, path, body=None, timeout=900):
        self.calls.append((path, body))
        if path == "/api/settings":
            return copy.deepcopy(self.settings)
        if path == "/api/ingest":
            self.ingest_count += 1
            number = self.ingest_count
            return self.ingest_transform({"ok": True, "kind": "applied", "sourceId": f"source-{number}",
                                          "response": {"newPages": [{"slug": f"page-{number}"}], "pageUpdates": []}})
        if path == "/api/query":
            self.on_query()
            return copy.deepcopy(self.query_result)
        if path.startswith("/api/pages/"):
            return copy.deepcopy(self.pages[path.rsplit("/", 1)[1]])
        if path.startswith("/api/sources/"):
            return copy.deepcopy(self.sources[path.rsplit("/", 1)[1]])
        raise AssertionError(f"Unexpected request {path}")

    def run_demo(self):
        with patch.object(demo, "request", side_effect=self.mock_request), patch("builtins.print"):
            demo.run(self.args, self.report)

    def update_manifest(self):
        self.args.manifest.write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_valid_chain_records_persisted_pages_and_matching_raw_hashes(self):
        self.run_demo()
        self.assertEqual(len(self.report["ingests"]), 2)
        self.assertEqual(len(self.report["queries"]), 1)
        for document, ingest in zip(self.manifest["documents"], self.report["ingests"]):
            self.assertEqual(ingest["input_sha256"], document["sha256"])
            raw_text = self.sources[ingest["result"]["sourceId"]]["rawText"]
            self.assertEqual(ingest["raw_sha256"], hashlib.sha256(raw_text.encode()).hexdigest())
            self.assertTrue(ingest["persisted_pages"][0]["content_sha256"])
        evidence = self.report["queries"][0]["evidence"][0]
        self.assertEqual(evidence["corpus_id"], "10")
        self.assertEqual(evidence["source_id"], "source-1")
        self.assertEqual(evidence["raw_sha256"], self.report["ingests"][0]["raw_sha256"])
        self.assertEqual(json.loads(self.args.output.read_text())["queries"], self.report["queries"])

    def test_http_200_query_error_is_not_success_even_with_plausible_response(self):
        self.query_result["ok"] = False
        with self.assertRaisesRegex(ValueError, "Query was not successful"):
            self.run_demo()
        self.assertEqual(self.report["queries"], [])

    def test_empty_answer_does_not_pass_with_pages_used(self):
        self.query_result["response"]["answer"] = "  "
        with self.assertRaisesRegex(ValueError, "empty answer"):
            self.run_demo()

    def test_answer_without_citations_does_not_pass(self):
        self.query_result["response"] = {"answer": "An unsupported statement.", "pagesUsed": []}
        with self.assertRaisesRegex(ValueError, "no checkable Wiki citations"):
            self.run_demo()

    def test_ingest_error_preview_or_empty_change_list_does_not_pass(self):
        variations = ({"ok": False}, {"kind": "preview"}, {"response": {"newPages": [], "pageUpdates": []}})
        for variation in variations:
            with self.subTest(variation=variation):
                self.ingest_count = 0
                self.ingest_transform = lambda result: {**result, **variation}
                with self.assertRaises(ValueError):
                    self.run_demo()
                self.assertEqual(self.report["ingests"], [])
                self.assertEqual(self.report["queries"], [])

    def test_reported_page_must_exist_with_content_and_source_lineage(self):
        original = copy.deepcopy(self.pages["page-1"])
        for variation in ({"content": " "}, {"slug": "wrong"}, {"frontmatter": {"sources": []}}, {"frontmatter": {"sources": ["unrelated"]}}):
            with self.subTest(variation=variation):
                self.ingest_count = 0
                self.pages["page-1"] = {**original, **variation}
                with self.assertRaises(ValueError):
                    self.run_demo()
                self.assertEqual(self.report["ingests"], [])

    def test_source_roundtrip_must_match_id_full_content_and_ingested_state(self):
        original = copy.deepcopy(self.sources["source-1"])
        variations = (
            {"rawText": "changed"}, {"truncated": True}, {"rawError": "read failed"},
            {"source": {**original["source"], "id": "different"}},
            {"source": {**original["source"], "ingestedAt": None}},
        )
        for variation in variations:
            with self.subTest(variation=variation):
                self.ingest_count = 0
                self.sources["source-1"] = {**original, **variation}
                with self.assertRaises(ValueError):
                    self.run_demo()
                self.assertEqual(self.report["ingests"], [])

    def test_raw_source_changed_after_ingest_is_detected_during_citation_check(self):
        self.on_query = lambda: self.sources["source-1"].update(rawText="tampered after ingest")
        with self.assertRaisesRegex(ValueError, "Raw source checksum mismatch"):
            self.run_demo()
        self.assertEqual(len(self.report["ingests"]), 2)
        self.assertEqual(self.report["queries"], [])

    def test_citing_an_unrelated_imported_document_does_not_pass(self):
        self.query_result["response"] = {"answer": "See [[page-2]].", "pagesUsed": ["page-2"]}
        with self.assertRaisesRegex(ValueError, "positive qrel for this question"):
            self.run_demo()
        self.assertEqual(self.report["queries"], [])

    def test_changed_original_dataset_fails_before_any_http_call(self):
        with (self.data / "corpus.jsonl").open("a") as handle:
            handle.write("\n")
        with self.assertRaisesRegex(ValueError, "Original dataset checksum mismatch"):
            self.run_demo()
        self.assertEqual(self.calls, [])

    def test_corrupt_second_document_fails_before_ingesting_the_first(self):
        (self.output / self.manifest["documents"][1]["file"]).write_text("corrupt")
        with self.assertRaisesRegex(ValueError, "Demo document checksum mismatch"):
            self.run_demo()
        self.assertEqual(self.calls, [])

    def test_forged_document_with_matching_hash_is_rejected_against_original(self):
        document = self.manifest["documents"][0]
        forged = b"Forged scientific abstract"
        (self.output / document["file"]).write_bytes(forged)
        document["sha256"] = hashlib.sha256(forged).hexdigest()
        self.update_manifest()
        with self.assertRaisesRegex(ValueError, "does not match original corpus"):
            self.run_demo()
        self.assertEqual(self.calls, [])

    def test_document_path_cannot_escape_manifest_directory(self):
        self.manifest["documents"][0]["file"] = "../outside.txt"
        self.update_manifest()
        with self.assertRaisesRegex(ValueError, "escapes manifest directory"):
            self.run_demo()
        self.assertEqual(self.calls, [])

    def test_forged_query_or_qrels_cannot_supply_false_provenance(self):
        original = copy.deepcopy(self.manifest["queries"][0])
        variations = ({"text": "different claim"}, {"demo_question": "Invented question"},
                      {"qrels": [{"corpus_id": "20", "score": 1, "included": True}]})
        for variation in variations:
            with self.subTest(variation=variation):
                self.manifest["queries"][0] = {**original, **variation}
                self.update_manifest()
                with self.assertRaisesRegex(ValueError, "does not match original queries/qrels"):
                    self.run_demo()
                self.assertEqual(self.calls, [])

    def test_main_records_failure_and_returns_nonzero_for_http_200_error(self):
        self.query_result["ok"] = False
        argv = ["demo_scifact.py", "--manifest", str(self.args.manifest), "--data-dir", str(self.data),
                "--output", str(self.args.output), "--model", self.args.model]
        with patch.object(sys, "argv", argv), patch.object(demo, "request", side_effect=self.mock_request), patch("builtins.print"):
            self.assertEqual(demo.main(), 1)
        report = json.loads(self.args.output.read_text())
        self.assertEqual(report["status"], "failed")
        self.assertIn("Query was not successful", report["error"])
        self.assertIn("finished_at", report)
        self.assertEqual(report["queries"], [])


class LoopbackTransportTests(unittest.TestCase):
    def test_local_api_bypasses_inherited_proxy(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"local":true}')

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with patch.dict(os.environ, {"http_proxy": "http://127.0.0.1:1", "https_proxy": "http://127.0.0.1:1", "no_proxy": "", "NO_PROXY": ""}):
                    base = f"http://127.0.0.1:{server.server_port}"
                    self.assertEqual(demo.request(base, "/", timeout=2), {"local": True})
            finally:
                server.shutdown()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
