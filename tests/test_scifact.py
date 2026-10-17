"""Offline regression tests for the SciFact data path (stdlib only)."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

MODULE = Path(__file__).resolve().parents[1] / "scripts/scifact.py"
SPEC = importlib.util.spec_from_file_location("scifact", MODULE)
scifact = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scifact)


class SciFactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        (self.data / "qrels").mkdir()
        self.corpus = [
            {"_id": "30", "title": "Paper thirty", "text": "Original abstract C."},
            {"_id": "20", "title": "Paper twenty", "text": "Original abstract B."},
            {"_id": "10", "title": "Paper ten", "text": "Original abstract A."},
        ]
        self.queries = [
            {"_id": "10", "text": "Cancer claim ten."},
            {"_id": "2", "text": "Cancer claim two."},
            {"_id": "1", "text": "Unrelated claim."},
            {"_id": "20", "text": "Cancer claim twenty."},
        ]
        self.write_records("corpus.jsonl", self.corpus)
        self.write_records("queries.jsonl", self.queries)
        (self.data / "qrels/test.tsv").write_text(
            "query-id\tcorpus-id\tscore\n10\t30\t1\n2\t20\t1\n2\t10\t1\n1\t30\t1\n20\t20\t1\n",
            encoding="utf-8",
        )

    def write_records(self, filename, records):
        (self.data / filename).write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")

    def make_archive(self, members):
        archive = self.root / "fixture.zip"
        with zipfile.ZipFile(archive, "w") as output:
            for name, data in members:
                output.writestr(name, data)
        return archive

    def test_safe_extract_preserves_files(self):
        archive = self.make_archive([("scifact/corpus.jsonl", "original"), ("scifact/qrels/test.tsv", "qrels")])
        destination = self.root / "extract"
        scifact.safe_extract(archive, destination)
        self.assertEqual((destination / "scifact/corpus.jsonl").read_text(), "original")
        self.assertEqual((destination / "scifact/qrels/test.tsv").read_text(), "qrels")

    def test_safe_extract_rejects_traversal_before_any_writes(self):
        for name in ("scifact/../../escape", "/scifact/absolute", "other/file", "scifact/..\\escape"):
            with self.subTest(name=name):
                archive = self.make_archive([("scifact/good", "good"), (name, "unsafe")])
                destination = self.root / "extract"
                with self.assertRaisesRegex(ValueError, "Unsafe"):
                    scifact.safe_extract(archive, destination)
                self.assertFalse(destination.exists())
                self.assertFalse((self.root / "escape").exists())

    def test_safe_extract_rejects_symlink(self):
        link = zipfile.ZipInfo("scifact/link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive = self.make_archive([(link, "../../escape")])
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            scifact.safe_extract(archive, self.root / "extract")

    def test_safe_extract_rejects_excessive_uncompressed_size(self):
        archive = self.make_archive([("scifact/large", "0123456789")])
        with patch.object(scifact, "MAX_EXTRACTED_BYTES", 5):
            with self.assertRaisesRegex(ValueError, "size limit"):
                scifact.safe_extract(archive, self.root / "extract")
        self.assertFalse((self.root / "extract").exists())

    def test_fetch_does_not_publish_invalid_download(self):
        target = self.root / "downloads/scifact.zip"
        with patch.object(scifact.urllib.request, "urlopen", return_value=io.BytesIO(b"corrupt")):
            with self.assertRaisesRegex(ValueError, "published"):
                scifact.fetch_archive(target)
        self.assertFalse(target.exists())
        self.assertEqual(list(target.parent.iterdir()), [])

    def test_fetch_publishes_valid_download_and_reuses_verified_cache(self):
        target = self.root / "downloads/scifact.zip"
        payload = b"test archive fixture"
        with patch.object(scifact, "EXPECTED_MD5", hashlib.md5(payload).hexdigest()):
            with patch.object(scifact.urllib.request, "urlopen", return_value=io.BytesIO(payload)) as request:
                scifact.fetch_archive(target)
                scifact.fetch_archive(target)
                request.assert_called_once()
        self.assertEqual(target.read_bytes(), payload)

    def test_fetch_rejects_invalid_cache_without_network(self):
        target = self.root / "scifact.zip"
        target.write_bytes(b"broken")
        with patch.object(scifact.urllib.request, "urlopen") as request:
            with self.assertRaisesRegex(ValueError, "Cached archive checksum mismatch"):
                scifact.fetch_archive(target)
            request.assert_not_called()
        self.assertEqual(target.read_bytes(), b"broken")

    def test_download_preserves_originals_and_detects_modifications(self):
        archive = self.make_archive([(f"scifact/{name}", (self.data / name).read_bytes()) for name in scifact.REQUIRED_FILES])
        payload = archive.read_bytes()
        destination = self.root / "downloaded/scifact"
        with patch.object(scifact, "EXPECTED_MD5", hashlib.md5(payload).hexdigest()):
            with patch.object(scifact.urllib.request, "urlopen", return_value=io.BytesIO(payload)):
                metadata = scifact.download(destination)
            self.assertEqual(scifact.download(destination), metadata)
            for name in scifact.REQUIRED_FILES:
                self.assertEqual((destination / name).read_bytes(), (self.data / name).read_bytes())
            (destination / "corpus.jsonl").write_text("changed")
            with self.assertRaisesRegex(ValueError, "differs from official"):
                scifact.download(destination)
            self.assertEqual((destination / "corpus.jsonl").read_text(), "changed")

    def test_selection_is_numeric_deterministic_and_traceable(self):
        original_hashes = {name: scifact.digest(self.data / name) for name in scifact.REQUIRED_FILES}
        first = scifact.prepare(self.data, self.root / "demo1", count=3, topic="cancer")
        second = scifact.prepare(self.data, self.root / "demo2", count=3, topic="cancer")
        self.assertEqual(first, second)
        self.assertEqual(first, scifact.prepare(self.data, self.root / "demo1", count=3, topic="cancer"))
        self.assertEqual([q["query_id"] for q in first["queries"]], ["2", "10", "20"])
        self.assertEqual([d["corpus_id"] for d in first["documents"]], ["10", "30", "20"])
        self.assertEqual(first["input_sha256"], original_hashes)
        self.assertEqual({name: scifact.digest(self.data / name) for name in scifact.REQUIRED_FILES}, original_hashes)
        for document in first["documents"]:
            path = self.root / "demo1" / document["file"]
            self.assertIn(f"corpus_id={document['corpus_id']}", path.read_text())
            self.assertEqual(document["sha256"], scifact.digest(path))
        self.assertEqual(first["documents"][2]["relevant_queries"], [{"query_id": "2", "score": 1}, {"query_id": "20", "score": 1}])
        self.assertEqual(first["queries"][0]["qrels"], [{"corpus_id": "10", "score": 1, "included": True}, {"corpus_id": "20", "score": 1, "included": True}])

    def test_selection_does_not_depend_on_jsonl_or_qrels_row_order(self):
        first = scifact.prepare(self.data, self.root / "demo1", count=2)
        self.write_records("corpus.jsonl", list(reversed(self.corpus)))
        self.write_records("queries.jsonl", list(reversed(self.queries)))
        path = self.data / "qrels/test.tsv"
        header, *rows = path.read_text().splitlines()
        path.write_text("\n".join([header, *reversed(rows)]) + "\n")
        second = scifact.prepare(self.data, self.root / "demo2", count=2)
        self.assertEqual(first["documents"], second["documents"])
        self.assertEqual(first["queries"], second["queries"])
        self.assertFalse(first["queries"][0]["qrels"][1]["included"])

    def test_prepare_refuses_overwriting_raw_dataset_or_a_different_demo(self):
        for output in (self.data, self.data / "nested", self.root):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, "separate"):
                scifact.prepare(self.data, output)
        output = self.root / "demo"
        scifact.prepare(self.data, output, count=2)
        old = (output / "manifest.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "Existing demo differs"):
            scifact.prepare(self.data, output, count=3)
        self.assertEqual((output / "manifest.json").read_bytes(), old)

    def test_prepare_insufficient_matches_does_not_publish_partial_demo(self):
        output = self.root / "demo"
        with self.assertRaisesRegex(ValueError, "Only 0"):
            scifact.prepare(self.data, output, topic="missing")
        self.assertFalse(output.exists())

    def test_duplicate_ids_are_rejected(self):
        self.write_records("corpus.jsonl", self.corpus + [self.corpus[0]])
        with self.assertRaisesRegex(ValueError, "duplicate _id"):
            scifact.load_dataset(self.data)

    def test_unknown_qrels_reference_is_rejected(self):
        with (self.data / "qrels/test.tsv").open("a") as handle:
            handle.write("2\tunknown\t1\n")
        with self.assertRaisesRegex(ValueError, "unknown query/corpus"):
            scifact.load_dataset(self.data)


if __name__ == "__main__":
    unittest.main()
