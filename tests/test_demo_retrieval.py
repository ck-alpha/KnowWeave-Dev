"""Prevent the online demo from accepting rankings without real evidence."""
import copy
import hashlib
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import demo_retrieval


class EvidenceValidation(unittest.TestCase):
    def setUp(self):
        self.page = {"slug": "aldh1", "content": "Measured evidence.\n", "frontmatter": {"sources": ["source-1"]}}
        content = self.page["content"].encode()
        self.payload = {"ok": True, "response": {"answer": "Evidence [[aldh1]].", "pagesUsed": ["aldh1"],
            "retrieval": {"hits": [{"slug": "aldh1"}], "suppliedPages": [{"slug": "aldh1",
                "contentHash": hashlib.sha256(content).hexdigest(), "contentBytes": len(content)}]}}}

    def verify(self, payload):
        with patch.object(demo_retrieval, "read_page", return_value=self.page), patch.object(
            demo_retrieval, "read_source", return_value=({"rawText": "Original corpus_id=45638119"}, "source-hash")
        ):
            return demo_retrieval.verify_answer("http://127.0.0.1:3000", payload)

    def test_source_trace_is_recorded(self):
        self.assertEqual(self.verify(self.payload)[0]["corpus_ids"], ["45638119"])

    def test_ranked_but_not_supplied_page_is_rejected(self):
        value = copy.deepcopy(self.payload)
        value["response"]["retrieval"]["suppliedPages"] = []
        with self.assertRaisesRegex(ValueError, "outside retrieved"):
            self.verify(value)

    def test_context_outside_ranked_results_is_rejected(self):
        value = copy.deepcopy(self.payload)
        value["response"]["retrieval"]["hits"] = []
        with self.assertRaisesRegex(ValueError, "outside retrieved"):
            self.verify(value)

    def test_changed_evidence_hash_is_rejected(self):
        value = copy.deepcopy(self.payload)
        value["response"]["retrieval"]["suppliedPages"][0]["contentHash"] = "old-hash"
        with self.assertRaisesRegex(ValueError, "differs from persisted"):
            self.verify(value)

    def test_no_clickable_citation_is_rejected(self):
        value = copy.deepcopy(self.payload)
        value["response"]["answer"] = "A bare assertion."
        with self.assertRaisesRegex(ValueError, "inline citations"):
            self.verify(value)

    def test_invented_inline_citation_is_rejected(self):
        value = copy.deepcopy(self.payload)
        value["response"]["answer"] += " [[invented]]"
        with self.assertRaisesRegex(ValueError, "outside retrieved"):
            self.verify(value)


if __name__ == "__main__":
    unittest.main()
