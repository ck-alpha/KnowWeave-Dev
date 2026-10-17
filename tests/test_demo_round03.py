"""Offline contract checks for safe, evidence-based Round 03 replay."""
import argparse
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import demo_round03 as demo
import demo_scifact
import scifact


class Round03DemoTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        data = root / "scifact"
        (data / "qrels").mkdir(parents=True)
        for name, rows in (("corpus.jsonl", [
                {"_id": "10", "title": "Cancer study A", "text": "Original evidence A."},
                {"_id": "20", "title": "Cancer study B", "text": "Original evidence B."}]),
                ("queries.jsonl", [{"_id": "1", "text": "Cancer claim one."}])):
            (data / name).write_text("".join(json.dumps(row) + "\n" for row in rows))
        (data / "qrels/test.tsv").write_text("query-id\tcorpus-id\tscore\n1\t10\t1\n1\t20\t1\n")
        # prepare selects one doc per query, so give the second study its own claim.
        with (data / "queries.jsonl").open("a") as handle:
            handle.write(json.dumps({"_id": "2", "text": "Cancer claim two."}) + "\n")
        with (data / "qrels/test.tsv").open("a") as handle:
            handle.write("2\t20\t1\n")
        scifact.prepare(data, root / "prepared", count=2)
        self.args = argparse.Namespace(
            base_url="http://127.0.0.1:3000", wiki_path=root / "wiki", model="test-qwen",
            manifest=root / "prepared/manifest.json", data_dir=data, limit=2, questions=1,
            timeout=1, output=root / "evidence.json",
        )
        self.report = {"status": "running", "ingests": [], "queries": []}
        self.pages = {}
        self.sources = {}
        self.pending = set()
        self.calls = []
        self.mutations = []
        self.model_available = True
        self.allow_stale_hybrid = False
        self.lie_about_mode = False
        self.cross_document_update = False
        self.settings = {"wikiPath": str(self.args.wiki_path), "settings": {
            "requireApprovalForIngest": False, "defaultModels": {
                slot: {"provider": "ollama", "model": "test-qwen"} for slot in ("ingest", "query")}}}

    def status(self):
        return {"total": len(self.pages), "indexed": len(self.pages) - len(self.pending),
                "pending": len(self.pending), "ready": not self.pending}

    def api(self, base, path, body=None, timeout=900):
        self.calls.append((path, body))
        if body is not None and path != "/api/query":
            self.mutations.append(path)
        if path == "/api/settings":
            return copy.deepcopy(self.settings)
        if path == "/api/pages":
            return {"pages": list(self.pages.values())}
        if path == "/api/sources":
            return {"sources": list(self.sources.values())}
        if path.startswith("/api/pages/"):
            return copy.deepcopy(self.pages[path.rsplit("/", 1)[1]])
        if path.startswith("/api/sources/"):
            return copy.deepcopy(self.sources[path.rsplit("/", 1)[1]])
        if path == "/api/retrieval":
            if body is None:
                return {"ok": True, "modelAvailable": self.model_available, "status": self.status()}
            count = len(self.pending)
            self.pending.clear()
            return {"ok": True, **self.status(), "embedded": count}
        if path == "/api/ingest":
            number = len(self.sources) + 1
            source_id, slug = f"source-{number}", f"page-{number}"
            self.sources[source_id] = {
                "source": {"id": source_id, "title": body["title"], "ingestedAt": "2026-10-17T00:00:00Z"},
                "rawText": f"# {body['title']}\n\n{body['text'].strip()}\n",
                "truncated": False, "rawError": None,
            }
            self.pages[slug] = {"slug": slug, "content": f"Evidence {number}.\n",
                                "frontmatter": {"sources": [source_id]}}
            self.pending.add(slug)
            updates = []
            if number == 2 and self.cross_document_update:
                self.pages["page-1"]["content"] += "Additional study synthesis.\n"
                self.pages["page-1"]["frontmatter"]["sources"].append(source_id)
                self.pending.add("page-1")
                updates.append({"slug": "page-1"})
            return {"ok": True, "kind": "applied", "sourceId": source_id,
                    "response": {"newPages": [{"slug": slug}], "pageUpdates": updates}}
        if path == "/api/query":
            mode = body["mode"]
            if self.pending and mode == "hybrid" and not self.allow_stale_hybrid:
                raise RuntimeError('/api/query: HTTP 409: {"code":"INDEX_NOT_READY"}')
            if body["question"] == "zzzxqvnonexistenttoken":
                return {"ok": True, "response": {"pagesUsed": [], "confidence": "low",
                                                  "retrieval": {"mode": mode, "suppliedPages": []}}}
            content = self.pages["page-1"]["content"]
            return {"ok": True, "response": {"answer": "Study evidence [[page-1]].", "pagesUsed": ["page-1"],
                "retrieval": {"mode": "fake" if self.lie_about_mode else mode, "hits": [{"slug": "page-1"}],
                              "suppliedPages": [{"slug": "page-1", "contentHash": demo.sha256(content),
                                                 "contentBytes": len(content.encode())}]}}}
        raise AssertionError(path)

    def edit(self, args, slug, content):
        self.pages[slug]["content"] = content
        self.pending.add(slug)
        return {"ok": True}

    def run_demo(self):
        with patch.object(demo, "request", side_effect=self.api), patch.object(
            demo_scifact, "request", side_effect=self.api
        ), patch.object(demo, "edit_page", side_effect=self.edit), patch("builtins.print"):
            demo.run(self.args, self.report)

    def test_full_evidence_chain_records_manual_edit_without_claiming_llm_updates(self):
        self.run_demo()
        self.assertEqual(len(self.report["ingests"]), 2)
        self.assertEqual([row["mode"] for row in self.report["queries"]], ["bm25", "embedding", "hybrid"])
        self.assertEqual(self.report["llm_existing_page_updates"], [])
        self.assertEqual(self.report["incremental_edit"]["kind"], "manual_cross_document_reading_list")
        self.assertEqual(self.report["incremental_edit"]["refresh"]["embedded"], 1)
        self.assertEqual(self.report["unchanged_refresh"]["embedded"], 0)
        self.assertIn("/sources/source-2", self.pages["page-1"]["content"])
        self.assertEqual(self.report["queries"][0]["evidence"][0]["corpus_ids"], ["10"])

    def test_real_ingest_update_is_recorded_with_both_sources_and_changed_hash(self):
        self.cross_document_update = True
        self.run_demo()
        update = self.report["llm_existing_page_updates"][0]
        self.assertEqual(update["source_ids"], ["source-1", "source-2"])
        self.assertNotEqual(update["before_sha256"], update["after_sha256"])
        self.assertTrue(update["content_changed"])

    def test_nonempty_page_or_source_refuses_all_mutations(self):
        for store in (self.pages, self.sources):
            with self.subTest(store="pages" if store is self.pages else "sources"):
                store["private"] = {"private": True}
                with self.assertRaisesRegex(ValueError, "empty Wiki"):
                    self.run_demo()
                store.clear()
                self.assertEqual(self.mutations, [])

    def test_wrong_server_wiki_refuses_all_mutations(self):
        self.settings["wikiPath"] += "-private"
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.run_demo()
        self.assertEqual(self.mutations, [])

    def test_missing_embedding_model_refuses_import(self):
        self.model_available = False
        with self.assertRaisesRegex(ValueError, "Embedding model unavailable"):
            self.run_demo()
        self.assertEqual(self.mutations, [])

    def test_stale_hybrid_success_cannot_pass(self):
        self.allow_stale_hybrid = True
        with self.assertRaisesRegex(ValueError, "Hybrid succeeded"):
            self.run_demo()
        self.assertEqual(self.report["queries"], [])

    def test_silent_mode_fallback_cannot_pass(self):
        self.lie_about_mode = True
        with self.assertRaisesRegex(ValueError, "requested retrieval mode"):
            self.run_demo()
        self.assertNotIn("evidence", self.report["queries"][0])

    def test_tampered_inputs_fail_before_http(self):
        (self.args.manifest.parent / "documents/02.txt").write_text("forged input")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            self.run_demo()
        self.assertEqual(self.calls, [])

    def test_existing_report_is_preserved_before_any_http(self):
        self.args.output.write_text("previous evidence")
        argv = ["demo_round03.py", "--wiki-path", str(self.args.wiki_path), "--output", str(self.args.output)]
        with patch.object(sys, "argv", argv), patch.object(demo, "request") as request, patch("sys.stderr"):
            with self.assertRaises(SystemExit):
                demo.main()
            request.assert_not_called()
        self.assertEqual(self.args.output.read_text(), "previous evidence")


class LocalOriginTests(unittest.TestCase):
    def test_accept_loopback_origins(self):
        for url in ("http://127.0.0.1:3001", "http://localhost:3000/", "http://[::1]:3000"):
            self.assertEqual(demo.validate_base_url(url), url.rstrip("/"))

    def test_reject_external_credentials_or_path(self):
        for url in ("http://example.com", "file://localhost", "http://user:password@localhost",
                    "http://localhost/path", "http://localhost?token=private", "http://localhost#fragment"):
            with self.subTest(url=url), self.assertRaises(argparse.ArgumentTypeError):
                demo.validate_base_url(url)


if __name__ == "__main__":
    unittest.main()
