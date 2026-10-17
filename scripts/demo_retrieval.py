#!/usr/bin/env python3
"""Verify all three live Wiki retrieval modes, Qwen evidence, and source lineage.

Uses existing Wiki pages; only the derived embedding index is refreshed.
Outputs local evidence, never treats this small demonstration as a benchmark.
"""
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from demo_scifact import request, read_page, read_source


def verify_answer(base_url, payload):
    if payload.get("ok") is not True:
        raise ValueError("Query API did not succeed")
    response = payload["response"]
    retrieval = response["retrieval"]
    supplied = {row["slug"]: row for row in retrieval["suppliedPages"]}
    hits = {row["slug"] for row in retrieval["hits"]}
    cited = set(response["pagesUsed"])
    inline = set(re.findall(r"\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]", response["answer"]))
    if not response["answer"].strip() or not cited or not inline:
        raise ValueError("Expected an answer with page and inline citations")
    if not inline <= cited or not cited <= supplied.keys() or not supplied.keys() <= hits:
        raise ValueError("Citation or model context is outside retrieved evidence")
    evidence = []
    for slug, row in supplied.items():
        page = read_page(base_url, slug)
        content = page["content"].encode("utf-8")
        if row["contentHash"] != hashlib.sha256(content).hexdigest() or row["contentBytes"] != len(content):
            raise ValueError(f"Supplied model evidence differs from persisted page {slug}")
        if slug not in cited:
            continue
        for source_id in page["frontmatter"]["sources"]:
            source, source_hash = read_source(base_url, source_id)
            evidence.append({"slug": slug, "source_id": source_id, "raw_sha256": source_hash,
                             "corpus_ids": re.findall(r"corpus_id=([0-9]+)", source["rawText"]),
                             "page_url": f"/wiki/{slug}", "source_url": f"/sources/{source_id}"})
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--question", default="Does elevated aldehyde dehydrogenase in breast tumours predict a favorable patient outcome?")
    parser.add_argument("--output", type=Path, default=Path(".local/evidence/round02/online.json"))
    args = parser.parse_args()
    base = urllib.parse.urlparse(args.base_url)
    if base.scheme not in ("http", "https") or base.hostname not in ("localhost", "127.0.0.1", "::1") or base.username or base.password:
        parser.error("--base-url must be a loopback HTTP(S) URL")
    args.base_url = args.base_url.rstrip("/")
    report = {"status": "running", "started_at": datetime.now(timezone.utc).isoformat(),
              "scope": "existing Wiki three-mode Qwen/source demo, not SciFact benchmark",
              "question": args.question, "queries": []}
    try:
        report["before"] = request(args.base_url, "/api/retrieval")
        report["build"] = request(args.base_url, "/api/retrieval", {})
        report["repeat_build"] = request(args.base_url, "/api/retrieval", {})
        if report["repeat_build"].get("embedded") != 0:
            raise ValueError("An unchanged index should reuse all document vectors")
        for mode in ("bm25", "embedding", "hybrid"):
            start = time.perf_counter()
            payload = request(args.base_url, "/api/query", {"question": args.question, "mode": mode})
            evidence = verify_answer(args.base_url, payload)
            if payload["response"]["retrieval"]["mode"] != mode:
                raise ValueError("Server did not execute the requested retrieval mode")
            report["queries"].append({"mode": mode, "seconds": time.perf_counter() - start,
                                      "payload": payload, "evidence": evidence})
            print(f"PASS {mode}: citations={payload['response']['pagesUsed']}")
        no_evidence = request(args.base_url, "/api/query", {"question": "zzzxqvnonexistenttoken", "mode": "bm25"})
        response = no_evidence["response"]
        if response["pagesUsed"] or response["confidence"] != "low" or response["retrieval"]["suppliedPages"]:
            raise ValueError("No-hit BM25 query must return low-confidence evidence insufficiency")
        report["no_evidence"] = no_evidence
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        print(str(error), file=sys.stderr)
    finally:
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Evidence: {args.output}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
