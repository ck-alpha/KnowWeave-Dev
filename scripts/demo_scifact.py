#!/usr/bin/env python3
"""Exercise the running app's real Ingest → Wiki → Query → source API chain."""
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import scifact

ROOT = Path(__file__).resolve().parents[1]


def request(base, path, body=None, timeout=900):
    encoded = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=encoded, headers={"Content-Type": "application/json"})
    try:
        # This CLI only permits loopback servers. Never route local documents
        # through an inherited HTTP_PROXY/HTTPS_PROXY from the shell.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{path}: HTTP {error.code}: {error.read().decode()[:2000]}") from error


def preflight(args):
    """Verify every local input before the first app mutation."""
    manifest_path = args.manifest.resolve()
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema_version") != 1 or manifest.get("dataset") != "BEIR SciFact":
        raise ValueError("Expected a version 1 BEIR SciFact demo manifest")
    for relative in scifact.REQUIRED_FILES:
        if scifact.digest(args.data_dir / relative) != manifest["input_sha256"][relative]:
            raise ValueError(f"Original dataset checksum mismatch: {relative}")
    corpus, queries, qrels = scifact.load_dataset(args.data_dir)
    if manifest["statistics"] != scifact.statistics(corpus, queries, qrels):
        raise ValueError("Manifest statistics do not match the original dataset")
    docs = manifest["documents"][:args.limit]
    if not docs:
        raise ValueError("Manifest contains no documents")
    selected_ids = {doc["corpus_id"] for doc in docs}
    if len(selected_ids) != len(docs):
        raise ValueError("Manifest contains duplicate corpus IDs")
    contents = {}
    for doc in docs:
        path = (manifest_path.parent / doc["file"]).resolve()
        if not path.is_relative_to(manifest_path.parent):
            raise ValueError("Document path escapes manifest directory")
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != doc["sha256"]:
            raise ValueError(f"Demo document checksum mismatch: {doc['corpus_id']}")
        original = corpus[doc["corpus_id"]]
        expected = f"{original['title']}\n\n{original['text']}\n\nSource: BEIR SciFact; corpus_id={doc['corpus_id']}\n"
        if doc["title"] != original["title"] or content.decode("utf-8") != expected:
            raise ValueError(f"Demo document does not match original corpus: {doc['corpus_id']}")
        contents[doc["corpus_id"]] = content.decode("utf-8")
    questions = []
    manifest_ids = {doc["corpus_id"] for doc in manifest["documents"]}
    for question in manifest["queries"]:
        query_id = question["query_id"]
        expected_question = f"What evidence in the imported SciFact sources supports or contradicts this claim: {queries[query_id]['text']}"
        relations = {row["corpus_id"]: row["score"] for row in question["qrels"]}
        if (
            question["text"] != queries[query_id]["text"]
            or question["demo_question"] != expected_question
            or len(relations) != len(question["qrels"])
            or relations != qrels[query_id]
            or any(row["included"] is not (row["corpus_id"] in manifest_ids) for row in question["qrels"])
        ):
            raise ValueError(f"Demo query does not match original queries/qrels: {query_id}")
        if any(row["score"] > 0 and row["corpus_id"] in selected_ids for row in question["qrels"]):
            questions.append(question)
    if not questions:
        raise ValueError("No demo question has a positive qrel to the selected documents")
    return manifest, manifest_bytes, docs, contents, questions[:args.questions]


def read_page(base_url, slug):
    if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9-]+", slug):
        raise ValueError(f"Invalid Wiki page slug: {slug!r}")
    page = request(base_url, f"/api/pages/{urllib.parse.quote(slug, safe='')}")
    if page.get("slug") != slug or not isinstance(page.get("content"), str) or not page["content"].strip():
        raise ValueError(f"Wiki page {slug} is missing or has no persisted content")
    sources = page["frontmatter"].get("sources", [])
    if not isinstance(sources, list) or not sources or any(not isinstance(source_id, str) or not source_id for source_id in sources):
        raise ValueError(f"Wiki page {slug} has no valid source lineage")
    return page


def read_source(base_url, source_id, expected_sha256=None):
    source = request(base_url, f"/api/sources/{urllib.parse.quote(source_id, safe='')}")
    if (
        source["source"]["id"] != source_id
        or not source["source"].get("ingestedAt")
        or not isinstance(source.get("rawText"), str)
        or not source["rawText"]
        or source.get("truncated")
        or source.get("rawError")
    ):
        raise ValueError(f"Cannot verify complete ingested raw source {source_id}")
    actual = hashlib.sha256(source["rawText"].encode("utf-8")).hexdigest()
    if expected_sha256 is not None and actual != expected_sha256:
        raise ValueError(f"Raw source checksum mismatch: {source_id}")
    return source, actual


def run(args, report):
    manifest, manifest_bytes, docs, contents, questions = preflight(args)
    report["manifest_sha256"] = hashlib.sha256(manifest_bytes).hexdigest()
    report["input_sha256"] = manifest["input_sha256"]
    report["selection"] = manifest["selection"]
    report["dataset_statistics"] = manifest["statistics"]
    settings = request(args.base_url, "/api/settings")
    report["wiki_path"] = settings["wikiPath"]
    for slot in ("ingest", "query"):
        config = settings["settings"]["defaultModels"][slot]
        if config != {"provider": "ollama", "model": args.model}:
            raise ValueError(f"{slot} must use Ollama {args.model}; run pnpm setup:local first")
    if settings["settings"]["requireApprovalForIngest"]:
        raise ValueError("Demo requires automatic ingest application; disable approval in this demo wiki's settings")
    selected_ids = {doc["corpus_id"] for doc in docs}
    expected_hashes = {}
    for doc in docs:
        content = contents[doc["corpus_id"]]
        title = f"SciFact {doc['corpus_id']} — {doc['title']}"
        # ingestPastedText preserves the source body in a Markdown file with
        # this explicit title wrapper (packages/core/src/ingest.ts).
        expected_raw = f"# {title.strip()}\n\n{content.strip()}\n"
        expected_hashes[doc["corpus_id"]] = hashlib.sha256(expected_raw.encode("utf-8")).hexdigest()
        print(f"Ingest SciFact {doc['corpus_id']}: {doc['title']}", flush=True)
        started = time.monotonic()
        result = request(args.base_url, "/api/ingest", {"text": content, "title": title}, args.timeout)
        if result.get("ok") is not True or result.get("kind") != "applied":
            raise ValueError(f"Ingest not applied: {result}")
        changed = result["response"]["newPages"] + result["response"]["pageUpdates"]
        if not changed:
            raise ValueError("Ingest produced no Wiki content")
        source_id = result["sourceId"]
        if not isinstance(source_id, str) or not source_id or any(e["result"]["sourceId"] == source_id for e in report["ingests"]):
            raise ValueError("Ingest returned an invalid or reused source ID")
        _, raw_hash = read_source(args.base_url, source_id, expected_hashes[doc["corpus_id"]])
        persisted_pages = []
        for changed_page in changed:
            page = read_page(args.base_url, changed_page["slug"])
            if source_id not in page["frontmatter"]["sources"]:
                raise ValueError(f"Applied Wiki page {page['slug']} omits the imported source")
            persisted_pages.append({"slug": page["slug"], "content_sha256": hashlib.sha256(page["content"].encode("utf-8")).hexdigest()})
        entry = {"corpus_id": doc["corpus_id"], "input_sha256": doc["sha256"], "raw_sha256": raw_hash, "persisted_pages": persisted_pages, "elapsed_seconds": round(time.monotonic() - started, 3), "result": result}
        report["ingests"].append(entry)
        save(args.output, report)
        print(f"Applied {len(changed)} pages in {entry['elapsed_seconds']} s", flush=True)
    for question in questions:
        print(f"Query SciFact {question['query_id']}", flush=True)
        started = time.monotonic()
        result = request(args.base_url, "/api/query", {"question": question["demo_question"]}, args.timeout)
        if result.get("ok") is not True:
            raise ValueError(f"Query was not successful: {result}")
        answer = result["response"]
        if not isinstance(answer.get("answer"), str) or not answer["answer"].strip():
            raise ValueError("Question produced an empty answer")
        if not isinstance(answer.get("pagesUsed"), list):
            raise ValueError("Question produced invalid pagesUsed")
        cited = set(answer["pagesUsed"]) | set(re.findall(r"\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]", answer["answer"]))
        if not cited:
            raise ValueError("Question produced no checkable Wiki citations")
        evidence = []
        ingested_sources = {e["result"]["sourceId"]: e["corpus_id"] for e in report["ingests"]}
        for slug in sorted(cited):
            page = read_page(args.base_url, slug)
            sources = page["frontmatter"]["sources"]
            for source_id in sources:
                corpus_id = ingested_sources.get(source_id)
                source, raw_hash = read_source(args.base_url, source_id, expected_hashes.get(corpus_id))
                evidence.append({"page_slug": slug, "source_id": source_id, "corpus_id": corpus_id, "title": source["source"]["title"], "raw_sha256": raw_hash})
        relevant_ids = {row["corpus_id"] for row in question["qrels"] if row["score"] > 0} & selected_ids
        if not any(e["corpus_id"] in relevant_ids for e in evidence):
            raise ValueError("Answer does not cite an imported document with a positive qrel for this question")
        report["queries"].append({"query_id": question["query_id"], "question": question["demo_question"], "elapsed_seconds": round(time.monotonic() - started, 3), "response": answer, "evidence": evidence})
        save(args.output, report)
    if not report["queries"]:
        raise ValueError("No demo question was tested")


def save(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/scifact-demo/manifest.json")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/scifact")
    parser.add_argument("--output", type=Path, default=ROOT / ".local/evidence/scifact-demo.json")
    parser.add_argument("--model", default="qwen3.8:27b")
    parser.add_argument("--limit", type=int, default=2)
    parser.add_argument("--questions", type=int, default=1)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    args.base_url = args.base_url.rstrip("/")
    if urllib.parse.urlparse(args.base_url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("Use a local KnowWeave server")
    if min(args.limit, args.questions, args.timeout) < 1:
        parser.error("limit, questions and timeout must be positive")
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "purpose": "small Wiki demo, not a retrieval benchmark", "model": args.model, "status": "running", "ingests": [], "queries": []}
    try:
        run(args, report)
        report["status"] = "passed"
        print(f"PASS: real Ingest → Wiki → Query → raw sources. Evidence: {args.output}")
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError) as error:
        report["status"] = "failed"
        report["error"] = str(error)
        print(f"FAIL: {error}; evidence: {args.output}", file=sys.stderr)
        return 1
    finally:
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        save(args.output, report)


if __name__ == "__main__":
    raise SystemExit(main())
