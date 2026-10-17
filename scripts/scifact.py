#!/usr/bin/env python3
"""Download the official BEIR SciFact release and prepare a traceable demo."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATASET_URL = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip"
# Published in https://github.com/beir-cellar/beir#available-datasets
EXPECTED_MD5 = "5f7d1de60b170fc8027bb7898e2efca1"
MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
REQUIRED_FILES = ("corpus.jsonl", "queries.jsonl", "qrels/test.tsv")
LICENSE_URL = "https://github.com/allenai/scifact/blob/master/LICENSE.md"


def digest(path: Path, algorithm: str = "sha256") -> str:
    hasher = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_archive(path: Path) -> None:
    """Publish a download only after its official checksum matches."""
    if path.exists():
        if digest(path, "md5") != EXPECTED_MD5:
            raise ValueError(f"Cached archive checksum mismatch: {path}; remove it and retry")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        request = urllib.request.Request(DATASET_URL, headers={"User-Agent": "KnowWeave-SciFact/1"})
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".scifact-download-", delete=False) as output:
            temporary = Path(output.name)
            with urllib.request.urlopen(request, timeout=60) as response:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise ValueError("SciFact archive exceeds download size limit")
                    output.write(chunk)
        if digest(temporary, "md5") != EXPECTED_MD5:
            raise ValueError("Downloaded archive does not match the published BEIR SciFact MD5")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def safe_extract(archive: Path, destination: Path) -> None:
    """Reject unsafe members before writing anything; preserve the release layout."""
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        seen = set()
        total = 0
        for member in members:
            name = PurePosixPath(member.filename)
            mode = member.external_attr >> 16
            if (
                name.is_absolute()
                or ".." in name.parts
                or "\\" in member.filename
                or not name.parts
                or name.parts[0] != "scifact"
                or stat.S_ISLNK(mode)
                or (stat.S_IFMT(mode) and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)))
                or name in seen
            ):
                raise ValueError(f"Unsafe or duplicate ZIP member: {member.filename}")
            target = destination / name
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError(f"ZIP member escapes destination: {member.filename}")
            seen.add(name)
            total += member.file_size
            if total > MAX_EXTRACTED_BYTES:
                raise ValueError("SciFact archive exceeds extracted size limit")
        for member in members:
            target = destination / member.filename
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(member) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)


def load_jsonl(path: Path, *, corpus: bool = False) -> dict[str, dict]:
    result = {}
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            try:
                item = json.loads(line)
                identifier = item["_id"]
                if not isinstance(identifier, str) or not identifier:
                    raise ValueError("_id must be a nonempty string")
                if not isinstance(item["text"], str):
                    raise ValueError("text must be a string")
                if corpus and not isinstance(item.get("title"), str):
                    raise ValueError("title must be a string")
                if identifier in result:
                    raise ValueError(f"duplicate _id {identifier}")
                result[identifier] = item
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"{path}:{number}: {error}") from error
    if not result:
        raise ValueError(f"Empty dataset file: {path}")
    return result


def load_dataset(data_dir: Path) -> tuple[dict, dict, dict]:
    for relative in REQUIRED_FILES:
        if not (data_dir / relative).is_file():
            raise ValueError(f"Missing {data_dir / relative}; run the download command first")
    corpus = load_jsonl(data_dir / "corpus.jsonl", corpus=True)
    queries = load_jsonl(data_dir / "queries.jsonl")
    qrels: dict[str, dict[str, int]] = {}
    path = data_dir / "qrels/test.tsv"
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        if reader.fieldnames != ["query-id", "corpus-id", "score"]:
            raise ValueError(f"Unexpected qrels header in {path}")
        for number, row in enumerate(reader, 2):
            try:
                query_id, corpus_id = row["query-id"], row["corpus-id"]
                score = int(row["score"])
                if None in row or query_id not in queries or corpus_id not in corpus:
                    raise ValueError("unknown query/corpus ID or extra columns")
                if corpus_id in qrels.get(query_id, {}):
                    raise ValueError("duplicate query/corpus pair")
                qrels.setdefault(query_id, {})[corpus_id] = score
            except (ValueError, TypeError) as error:
                raise ValueError(f"{path}:{number}: {error}") from error
    if not qrels:
        raise ValueError(f"Empty qrels: {path}")
    return corpus, queries, qrels


def statistics(corpus: dict, queries: dict, qrels: dict) -> dict:
    return {
        "corpus_documents": len(corpus),
        "queries_total": len(queries),
        "test_queries": len(qrels),
        "test_qrels": sum(len(rows) for rows in qrels.values()),
    }


def download(data_dir: Path) -> dict:
    data_dir = data_dir.absolute()
    if data_dir.is_symlink():
        raise ValueError("Dataset directory must not be a symlink")
    data_dir.parent.mkdir(parents=True, exist_ok=True)
    archive = data_dir.parent / "scifact.zip"
    fetch_archive(archive)
    with tempfile.TemporaryDirectory(dir=data_dir.parent, prefix=".scifact-extract-") as temporary:
        staging = Path(temporary)
        safe_extract(archive, staging)
        extracted = staging / "scifact"
        counts = statistics(*load_dataset(extracted))
        files = {str(path.relative_to(extracted)): digest(path) for path in sorted(extracted.rglob("*")) if path.is_file()}
        metadata = {
            "dataset": "BEIR SciFact", "url": DATASET_URL,
            "archive_md5": EXPECTED_MD5, "archive_sha256": digest(archive),
            "files_sha256": files, "statistics": counts,
        }
        if data_dir.exists():
            for relative, expected in files.items():
                existing = data_dir / relative
                if not existing.is_file() or digest(existing) != expected:
                    raise ValueError(f"Existing dataset differs from official archive: {existing}; use a new --data-dir")
        else:
            write_json(extracted / "download-manifest.json", metadata)
            extracted.rename(data_dir)
    return metadata


def id_key(identifier: str) -> tuple:
    return (0, int(identifier), identifier) if identifier.isdecimal() else (1, identifier)


def prepare(data_dir: Path, output_dir: Path, count: int = 3, topic: str = "cancer") -> dict:
    if count < 1:
        raise ValueError("--count must be at least 1")
    corpus, queries, qrels = load_dataset(data_dir)
    data_dir, output_dir = data_dir.resolve(), output_dir.resolve()
    if output_dir == data_dir or output_dir.is_relative_to(data_dir) or data_dir.is_relative_to(output_dir):
        raise ValueError("Demo output must be separate from the original dataset directory")
    selected_ids: list[str] = []
    selected_queries: list[str] = []
    # Keep one distinct, positively relevant document per selected query.
    # No random state, clock, or input row ordering affects this selection.
    for query_id in sorted(qrels, key=id_key):
        if topic.casefold() not in queries[query_id]["text"].casefold():
            continue
        candidates = sorted(qrels[query_id], key=lambda doc_id: (-qrels[query_id][doc_id], id_key(doc_id)))
        candidates = [doc_id for doc_id in candidates if qrels[query_id][doc_id] > 0 and doc_id not in selected_ids]
        if candidates:
            selected_ids.append(candidates[0])
            selected_queries.append(query_id)
        if len(selected_ids) == count:
            break
    if len(selected_ids) != count:
        raise ValueError(f"Only {len(selected_ids)} distinct relevant documents match topic {topic!r}; reduce --count or change --topic")
    documents, questions = [], []
    content_by_file = {}
    for corpus_id in selected_ids:
        item = corpus[corpus_id]
        # Filenames use a position, not the untrusted corpus ID.
        filename = f"documents/{len(documents) + 1:02d}.txt"
        content = f"{item['title']}\n\n{item['text']}\n\nSource: BEIR SciFact; corpus_id={corpus_id}\n"
        content_by_file[filename] = content
        documents.append({
            "corpus_id": corpus_id, "title": item["title"], "file": filename,
            "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            "relevant_queries": [
                {"query_id": query_id, "score": qrels[query_id][corpus_id]}
                for query_id in selected_queries if qrels[query_id].get(corpus_id, 0) > 0
            ],
        })
    for query_id in selected_queries:
        questions.append({
            "query_id": query_id, "text": queries[query_id]["text"],
            "demo_question": f"What evidence in the imported SciFact sources supports or contradicts this claim: {queries[query_id]['text']}",
            "qrels": [{"corpus_id": doc_id, "score": qrels[query_id][doc_id], "included": doc_id in selected_ids}
                      for doc_id in sorted(qrels[query_id], key=id_key)],
        })
    manifest = {
        "schema_version": 1, "dataset": "BEIR SciFact", "purpose": "small Wiki ingest demo, not a retrieval benchmark",
        "source_url": DATASET_URL, "license_url": LICENSE_URL,
        "licenses": {"claims_and_evidence": "CC-BY-4.0", "corpus_abstracts": "ODC-By-1.0"},
        "selection": {"split": "test", "topic": topic, "count": count, "order": "numeric query ID; highest relevance then numeric corpus ID; distinct documents"},
        "input_sha256": {relative: digest(data_dir / relative) for relative in REQUIRED_FILES},
        "statistics": statistics(corpus, queries, qrels), "documents": documents, "queries": questions,
    }
    # Build first, then atomically publish. A repeat is a no-op only when content
    # matches; a different selection needs a new output directory.
    if output_dir.exists():
        expected = {"manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", **content_by_file}
        for relative, content in expected.items():
            path = output_dir / relative
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                raise ValueError(f"Existing demo differs: {path}; choose a new --output-dir")
    else:
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output_dir.parent, prefix=".scifact-demo-") as temporary:
            staging = Path(temporary) / "demo"
            (staging / "documents").mkdir(parents=True)
            for relative, content in content_by_file.items():
                (staging / relative).write_text(content, encoding="utf-8")
            write_json(staging / "manifest.json", manifest)
            staging.rename(output_dir)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    download_parser = commands.add_parser("download", help="Download, verify, and preserve the official release")
    download_parser.add_argument("--data-dir", type=Path, default=ROOT / "data/scifact")
    prepare_parser = commands.add_parser("prepare", help="Prepare a small deterministic, source-traceable demo")
    prepare_parser.add_argument("--data-dir", type=Path, default=ROOT / "data/scifact")
    prepare_parser.add_argument("--output-dir", type=Path, default=ROOT / "data/scifact-demo")
    prepare_parser.add_argument("--count", type=int, default=3)
    prepare_parser.add_argument("--topic", default="cancer", help="Case-insensitive query substring; empty string selects any topic")
    args = parser.parse_args()
    try:
        if args.command == "download":
            result = download(args.data_dir)
            summary = {"data_dir": str(args.data_dir), **result["statistics"], "archive_md5": result["archive_md5"], "archive_sha256": result["archive_sha256"]}
        else:
            result = prepare(args.data_dir, args.output_dir, args.count, args.topic)
            summary = {"manifest": str(args.output_dir / "manifest.json"), "corpus_ids": [row["corpus_id"] for row in result["documents"]], "query_ids": [row["query_id"] for row in result["queries"]]}
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"SciFact error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
