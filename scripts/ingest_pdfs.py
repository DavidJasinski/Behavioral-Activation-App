"""Extract text from source PDFs and build a chunked knowledge index.

Run:
    python scripts/ingest_pdfs.py

Outputs:
    sources/<name>.txt           Plain text per PDF (debug-friendly)
    knowledge.json               Chunked, indexed corpus consumed by the Coach
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = ROOT / "sources"
OUTPUT = ROOT / "knowledge.json"

# Each entry: (filename, modality, label)
SOURCES: list[tuple[str, str, str]] = [
    (
        "Behavioral-Activation-for-Depression.pdf",
        "ba",
        "Behavioral Activation for Depression",
    ),
    (
        "Graded-Exposure.pdf",
        "ivex",
        "In-Vivo Graded Exposure",
    ),
]

STOPWORDS = set(
    "a an and the to of in for on at with is am are was were be been being i me my you "
    "your we us our it its this that those these so but or if then than just very really "
    "maybe might can could would should do does did doing have has had not no yes ok okay "
    "over under up down out off again still more less because about into onto from as by "
    "what when where why how which who whose all any some many few each every other "
    "their them they he she him her his hers".split()
)

CHUNK_SIZE = 900   # characters per chunk (roughly a paragraph)
CHUNK_OVERLAP = 150


def normalize(text: str) -> str:
    text = text.replace("\u00a0", " ")
    # Unicode replacement char (U+FFFD) commonly stands in for smart quotes /
    # apostrophes in PDFs; collapsing to a straight apostrophe keeps text readable.
    text = text.replace("\ufffd", "'")
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    text = re.sub(r"-\n", "", text)            # join hyphenated line breaks
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{2,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def extract(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    pages: list[str] = []
    for i, page in enumerate(reader.pages):
        try:
            pages.append(page.extract_text() or "")
        except Exception as exc:  # noqa: BLE001
            pages.append(f"[page {i+1} extract failed: {exc}]")
    return normalize("\n\n".join(pages))


def chunk(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> Iterable[str]:
    if not text:
        return []
    out: list[str] = []
    n = len(text)
    start = 0
    while start < n:
        end = min(start + size, n)
        # Try to break on paragraph or sentence boundary near the end.
        if end < n:
            window = text[start:end]
            cut = max(window.rfind("\n\n"), window.rfind(". "))
            if cut > size * 0.5:
                end = start + cut + 1
        chunk_text = text[start:end].strip()
        if chunk_text:
            out.append(chunk_text)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return out


def topics(text: str, top_k: int = 12) -> list[str]:
    counts: dict[str, int] = {}
    for word in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", text.lower()):
        if word in STOPWORDS:
            continue
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    return [w for w, _ in ranked[:top_k]]


def main() -> int:
    if not SOURCES_DIR.exists():
        print(f"ERROR: missing sources dir: {SOURCES_DIR}", file=sys.stderr)
        return 1

    docs: list[dict] = []
    chunks: list[dict] = []

    for filename, modality, label in SOURCES:
        path = SOURCES_DIR / filename
        if not path.exists():
            print(f"skip (missing): {filename}", file=sys.stderr)
            continue
        print(f"reading {filename} ({path.stat().st_size:,} bytes)")
        text = extract(path)
        (SOURCES_DIR / (path.stem + ".txt")).write_text(text, encoding="utf-8")

        doc_id = f"{modality}-{path.stem}"
        doc_topics = topics(text)
        docs.append(
            {
                "id": doc_id,
                "filename": filename,
                "label": label,
                "modality": modality,
                "chars": len(text),
                "topics": doc_topics,
            }
        )

        for i, c in enumerate(chunk(text)):
            chunks.append(
                {
                    "doc_id": doc_id,
                    "modality": modality,
                    "label": label,
                    "i": i,
                    "text": c,
                    "topics": topics(c, top_k=8),
                }
            )

    payload = {
        "version": 1,
        "modalities": {
            "ba": {
                "label": "Behavioral Activation",
                "summary": (
                    "Behavioral Activation (BA) treats low mood and depression by "
                    "rebuilding contact with rewarding activities tied to your values. "
                    "You schedule small, specific actions, do them regardless of mood, "
                    "and learn from how they actually feel."
                ),
                "principles": [
                    "Action precedes motivation",
                    "Track activity and mood, not just thoughts",
                    "Tie activities to values",
                    "Start small and grade up",
                    "Outside-in change: behavior shapes feeling",
                ],
            },
            "ivex": {
                "label": "In-Vivo Exposure",
                "summary": (
                    "In-Vivo Exposure (graded exposure) treats anxiety and avoidance by "
                    "approaching feared situations in real life, on purpose, in graded "
                    "steps. New learning occurs when you stay with the situation long "
                    "enough for the feared outcome to be disconfirmed."
                ),
                "principles": [
                    "Approach what is avoided, gradually",
                    "Build a fear/avoidance hierarchy (SUDS 0-100)",
                    "Stay long enough for new learning, not just relief",
                    "Drop safety behaviors that block disconfirmation",
                    "Repeat across contexts to generalize learning",
                ],
            },
        },
        "docs": docs,
        "chunks": chunks,
    }

    OUTPUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(
        f"wrote {OUTPUT.relative_to(ROOT)}: "
        f"{len(docs)} docs, {len(chunks)} chunks"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
