#!/usr/bin/env python3
"""Run a real SciFact → Wiki → incremental index → three-mode source demo.

Start KnowWeave with a fresh KNOWWAEVE_WIKI_PATH, then pass that same path as
--wiki-path. Existing pages or sources are rejected; nothing is deleted/reset.
LLM page updates and the explicit manual reading-list edit are reported apart.
This small demo is not a benchmark or a scientific answer-quality evaluation.
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from demo_retrieval import verify_answer
from demo_scifact import ROOT, preflight, read_page, read_source, request, save


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_base_url(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme not in ("http", "https")
            or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/")):
        raise argparse.ArgumentTypeError("Use a loopback HTTP(S) origin without credentials or a path")
    return value.rstrip("/")


def verify_target(args):
    settings = request(args.base_url, "/api/settings", timeout=args.timeout)
    if Path(settings["wikiPath"]).resolve() != args.wiki_path.resolve():
        raise ValueError("Server Wiki does not match --wiki-path; start a separate server with KNOWWAEVE_WIKI_PATH")
    for slot in ("ingest", "query"):
        if settings["settings"]["defaultModels"][slot] != {"provider": "ollama", "model": args.model}:
            raise ValueError(f"{slot} must use Ollama {args.model}; run pnpm setup:local")
    if settings["settings"]["requireApprovalForIngest"]:
        raise ValueError("This isolated demo Wiki must allow automatic Ingest application")
    return settings


def index_status(args):
    payload = request(args.base_url, "/api/retrieval", timeout=args.timeout)
    if payload.get("ok") is not True or payload.get("modelAvailable") is not True:
        raise ValueError(f"Embedding model unavailable: {payload.get('modelError', payload)}")
    return payload["status"]


def refresh(args, expected=None):
    verify_target(args)
    result = request(args.base_url, "/api/retrieval", {}, args.timeout)
    if result.get("ok") is not True or not result.get("ready") or result.get("pending") != 0:
        raise ValueError(f"Embedding refresh did not become ready: {result}")
    if expected is not None and result.get("embedded") != expected:
        raise ValueError(f"Expected {expected} changed vectors, got {result.get('embedded')}")
    return result


def edit_page(args, slug, content):
    """Use the same manual-edit API as the Wiki editor, bypassing shell proxies."""
    verify_target(args)
    path = f"/api/pages/{urllib.parse.quote(slug, safe='')}"
    req = urllib.request.Request(args.base_url + path, method="PUT",
                                 data=json.dumps({"content": content}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=args.timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{path}: HTTP {error.code}: {error.read().decode()[:2000]}") from error
    if result.get("ok") is not True:
        raise ValueError(f"Manual edit was not applied: {result}")
    return result


def verify_stale_rejection(args, question):
    try:
        request(args.base_url, "/api/query", {"question": question, "mode": "hybrid"}, args.timeout)
    except RuntimeError as error:
        if "HTTP 409" not in str(error) or '"INDEX_NOT_READY"' not in str(error):
            raise
        return {"http_status": 409, "code": "INDEX_NOT_READY", "error": str(error)}
    raise ValueError("Hybrid succeeded while the index was stale; no silent fallback is allowed")


def run(args, report):
    # Verify all selected documents against the original corpus before mutation.
    manifest, manifest_bytes, docs, contents, questions = preflight(args)
    if len(docs) < 2:
        raise ValueError("Round 03 demo needs at least two distinct SciFact documents")
    verify_target(args)
    pages = request(args.base_url, "/api/pages", timeout=args.timeout)
    sources = request(args.base_url, "/api/sources", timeout=args.timeout)
    if pages["pages"] or sources["sources"]:
        raise ValueError("Demo requires an empty Wiki (no pages or sources). Use a new Wiki directory; existing data is never reset")
    report.update(wiki_path=str(args.wiki_path.resolve()),
                  manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
                  input_sha256=manifest["input_sha256"], dataset_statistics=manifest["statistics"],
                  selection=manifest["selection"], initial_index=index_status(args))
    save(args.output, report)

    known_pages = {}
    source_hashes = {}
    source_corpus = {}
    for number, doc in enumerate(docs, 1):
        verify_target(args)
        title = f"SciFact {doc['corpus_id']} — {doc['title']}"
        text = contents[doc["corpus_id"]]
        expected_raw_hash = sha256(f"# {title.strip()}\n\n{text.strip()}\n")
        print(f"[{number}/{len(docs)}] Ingest SciFact {doc['corpus_id']}", flush=True)
        started = time.monotonic()
        result = request(args.base_url, "/api/ingest", {"title": title, "text": text}, args.timeout)
        # Retain the response even if the subsequent persistence check fails.
        entry = {"corpus_id": doc["corpus_id"], "input_sha256": doc["sha256"],
                 "result": result, "seconds": round(time.monotonic() - started, 3),
                 "persisted_pages": [], "existing_page_updates": []}
        report["ingests"].append(entry)
        save(args.output, report)
        if result.get("ok") is not True or result.get("kind") != "applied":
            raise ValueError(f"Ingest was not applied: {result}")
        source_id = result["sourceId"]
        if not isinstance(source_id, str) or not source_id or source_id in source_hashes:
            raise ValueError("Ingest returned an invalid or reused source ID")
        _, raw_hash = read_source(args.base_url, source_id, expected_raw_hash)
        source_hashes[source_id] = raw_hash
        source_corpus[source_id] = doc["corpus_id"]
        entry["raw_sha256"] = raw_hash
        changes = result["response"]["newPages"] + result["response"]["pageUpdates"]
        if not changes:
            raise ValueError("Ingest produced no Wiki content")
        for change in changes:
            page = read_page(args.base_url, change["slug"])
            if source_id not in page["frontmatter"]["sources"]:
                raise ValueError(f"Persisted page {page['slug']} omits its imported source")
            current_hash = sha256(page["content"])
            previous = known_pages.get(page["slug"])
            if previous:
                old_sources = set(previous["frontmatter"]["sources"])
                if not old_sources <= set(page["frontmatter"]["sources"]):
                    raise ValueError(f"Ingest lost existing source lineage for {page['slug']}")
                entry["existing_page_updates"].append({
                    "slug": page["slug"], "before_sha256": sha256(previous["content"]),
                    "after_sha256": current_hash, "source_ids": page["frontmatter"]["sources"],
                    "content_changed": previous["content"] != page["content"],
                })
            known_pages[page["slug"]] = page
            entry["persisted_pages"].append({"slug": page["slug"], "content_sha256": current_hash,
                                               "page_url": f"/wiki/{page['slug']}"})
        entry["index_before_refresh"] = index_status(args)
        if entry["index_before_refresh"]["pending"] < 1:
            raise ValueError("Imported content did not create any pending document vectors")
        entry["refresh"] = refresh(args, entry["index_before_refresh"]["pending"])
        save(args.output, report)

    # A deliberate editor action makes index invalidation reproducible even
    # when Qwen chooses separate concept pages rather than revising an old page.
    first = report["ingests"][0]
    target_slug = first["persisted_pages"][0]["slug"]
    before = read_page(args.base_url, target_slug)
    links = []
    for entry in report["ingests"]:
        slug = entry["persisted_pages"][0]["slug"]
        source_id = entry["result"]["sourceId"]
        page_link = f" — [[{slug}]]" if slug != target_slug else ""
        links.append(f"- [SciFact corpus {entry['corpus_id']}](/sources/{source_id}){page_link}")
    addition = ("\n\n## Related imported SciFact evidence\n\n"
                "This reading list links the original study records; it does not imply that their findings are interchangeable.\n\n"
                + "\n".join(links) + "\n")
    print("Add a manual cross-document reading list; verify vector invalidation", flush=True)
    edit_page(args, target_slug, before["content"].rstrip() + addition)
    after = read_page(args.base_url, target_slug)
    if after["content"] != before["content"].rstrip() + addition:
        raise ValueError("Manual edit content did not round-trip")
    if set(after["frontmatter"]["sources"]) != set(before["frontmatter"]["sources"]):
        raise ValueError("Manual edit changed source lineage")
    report["incremental_edit"] = {"kind": "manual_cross_document_reading_list", "slug": target_slug,
                                  "before_sha256": sha256(before["content"]), "after_sha256": sha256(after["content"]),
                                  "index_after_edit": index_status(args)}
    save(args.output, report)
    if report["incremental_edit"]["index_after_edit"]["pending"] != 1:
        raise ValueError("Editing one page must invalidate exactly one vector")
    report["incremental_edit"]["stale_hybrid"] = verify_stale_rejection(args, questions[0]["demo_question"])
    report["incremental_edit"]["refresh"] = refresh(args, expected=1)
    report["unchanged_refresh"] = refresh(args, expected=0)
    report["llm_existing_page_updates"] = [update for entry in report["ingests"] for update in entry["existing_page_updates"]]
    save(args.output, report)

    for question in questions:
        relevant = {row["corpus_id"] for row in question["qrels"] if row["score"] > 0}
        for mode in ("bm25", "embedding", "hybrid"):
            verify_target(args)
            started = time.monotonic()
            payload = request(args.base_url, "/api/query", {"question": question["demo_question"], "mode": mode}, args.timeout)
            query = {"query_id": question["query_id"], "question": question["demo_question"], "mode": mode,
                     "seconds": round(time.monotonic() - started, 3), "payload": payload}
            report["queries"].append(query)
            save(args.output, report)
            evidence = verify_answer(args.base_url, payload)
            if payload["response"]["retrieval"]["mode"] != mode:
                raise ValueError("Server did not execute the requested retrieval mode")
            for row in evidence:
                source_id = row["source_id"]
                if source_id not in source_hashes or row["raw_sha256"] != source_hashes[source_id]:
                    raise ValueError("Cited raw source differs from a verified SciFact import")
            if not any(source_corpus[row["source_id"]] in relevant for row in evidence):
                raise ValueError("Answer has no imported source with a positive qrel for this question")
            query["evidence"] = evidence
            save(args.output, report)
            print(f"PASS {mode}: {payload['response']['pagesUsed']}", flush=True)

    # Check uncited imported sources too, detecting any later accidental overwrite.
    for source_id, expected_hash in source_hashes.items():
        read_source(args.base_url, source_id, expected_hash)
    no_hit = request(args.base_url, "/api/query", {"question": "zzzxqvnonexistenttoken", "mode": "bm25"}, args.timeout)
    response = no_hit["response"]
    if (no_hit.get("ok") is not True or response["pagesUsed"] or response["confidence"] != "low"
            or response["retrieval"]["suppliedPages"] or response["retrieval"]["mode"] != "bm25"):
        raise ValueError("No-hit BM25 must report low-confidence evidence insufficiency")
    report["no_evidence"] = no_hit
    report["final_index"] = index_status(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", type=validate_base_url, default="http://127.0.0.1:3000")
    parser.add_argument("--wiki-path", type=Path, required=True, help="Expected empty server Wiki; never reset by this script")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/scifact-demo/manifest.json")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/scifact")
    parser.add_argument("--model", default="qwen3.8:27b")
    parser.add_argument("--limit", type=int, default=2)
    parser.add_argument("--questions", type=int, choices=(1, 2), default=1)
    parser.add_argument("--timeout", type=int, default=900)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    parser.add_argument("--output", type=Path, default=ROOT / f".local/evidence/round03/demo-{stamp}-{uuid.uuid4().hex[:8]}.json")
    args = parser.parse_args()
    if args.limit < 2 or args.timeout < 1:
        parser.error("--limit must be at least 2 and --timeout must be positive")
    if args.output.exists():
        parser.error("--output already exists; choose a new report path to preserve prior evidence")
    report = {"schema_version": 1, "started_at": datetime.now(timezone.utc).isoformat(), "status": "running",
              "purpose": "real small Wiki demo; not a retrieval benchmark or an answer-quality score",
              "model": args.model, "ingests": [], "queries": []}
    try:
        # Establish a writable evidence destination before touching the Wiki.
        save(args.output, report)
        run(args, report)
        report["status"] = "passed"
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError) as error:
        report["status"] = "failed"
        report["error"] = str(error)
        print(f"FAIL: {error}", file=sys.stderr)
    finally:
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        save(args.output, report)
        print(f"Evidence: {args.output}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
