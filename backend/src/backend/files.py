"""
Files attached to messages (2026-09-30).

A message's `attachments` is a list of {path, name, size, type}; `path` points into the
private "attachments" storage bucket. Everything that reads a thread for the AI sees each file
as a one-line note. The files a question is about (its own and the replied-to message's, else the
latest shared file) are also opened and labelled with where they came from: images and PDFs go to
Anthropic natively, and every provider gets the text of text, Word and PowerPoint files (and of
PDFs it can't take natively). See stream_ai_response in llm.py for the choice.
"""

import base64
import html
import io
import logging
import re
import zipfile
from pathlib import PurePosixPath
from typing import Any

from pypdf import PdfReader

from backend.db import get_db

logger = logging.getLogger(__name__)

BUCKET = "attachments"
# Anthropic takes these image types, at most 5 MB each; a few per answer keeps the cost sane.
AI_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
AI_IMAGE_BYTES = 5 * 1024 * 1024
AI_IMAGES = 5
# Documents (PDF, Word, PowerPoint) per answer; PDFs go natively up to Anthropic's page limit.
AI_DOCS = 3
PDF_PAGES = 100
# Images and PDFs sent natively in one request, raw bytes (Anthropic caps a request at 32 MB,
# and base64 adds a third).
MEDIA_BYTES = 20 * 1024 * 1024
# Word and PowerPoint files are zips: at most this many parts, and this much unpacked XML.
OFFICE_PARTS = 500
OFFICE_UNPACKED_BYTES = 40 * 1024 * 1024
# How far back the AI looks for "the latest shared file" when a question has none of its own.
RECENT_FILE_MESSAGES = 10
# Text files are read in full up to this size, and all of them together up to TEXT_TOTAL chars.
TEXT_BYTES = 50 * 1024
TEXT_TOTAL = 60_000
TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".xml", ".html", ".htm", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".ipynb",
    ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".go", ".rs", ".rb", ".php", ".lua",
    ".sql", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".r", ".m", ".dart", ".vue", ".svelte", ".ino", ".v",
    ".vhd", ".vhdl", ".log", ".tex", ".gitignore", ".dockerfile",
}  # fmt: skip


def attachments_of(msg: dict[str, Any]) -> list[dict[str, Any]]:
    files = msg.get("attachments")
    return [f for f in files if isinstance(f, dict)] if isinstance(files, list) else []


def human_size(size: Any) -> str:
    try:
        n = float(size)
    except (TypeError, ValueError):
        return "unknown size"
    for unit in ("bytes", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return f"{int(n)} bytes" if unit == "bytes" else f"{n:.1f} {unit}".replace(".0 ", " ")
        n /= 1024
    return "unknown size"


def kind(file: dict[str, Any]) -> str:
    mime = str(file.get("type") or "")
    suffix = PurePosixPath(str(file.get("name") or "")).suffix.lower()
    if mime.startswith("image/"):
        return "image"
    if mime == "application/pdf" or suffix == ".pdf":
        return "PDF"
    if is_text(file):
        return "text file"
    return suffix.lstrip(".").upper() + " file" if suffix else "file"


def is_text(file: dict[str, Any]) -> bool:
    mime = str(file.get("type") or "")
    name = str(file.get("name") or "").lower()
    suffix = PurePosixPath(name).suffix
    return mime.startswith("text/") or mime in ("application/json", "application/xml") or suffix in TEXT_SUFFIXES or name == "dockerfile"


def note(file: dict[str, Any]) -> str:
    return f"[Attached file: {file.get('name') or 'file'} ({kind(file)}, {human_size(file.get('size'))})]"


def with_notes(msg: dict[str, Any]) -> dict[str, Any]:
    """The message with a note line per attached file, so every AI reader knows it's there."""
    files = attachments_of(msg)
    if not files or msg.get("_files_noted"):
        return msg
    notes = "\n".join(note(f) for f in files)
    text = (msg.get("content") or "").rstrip()
    return {**msg, "content": f"{text}\n{notes}" if text else notes, "_files_noted": True}


def _download(path: str) -> bytes | None:
    try:
        return get_db().storage.from_(BUCKET).download(path)
    except Exception:
        logger.warning("Could not read attached file %s", path, exc_info=True)
        return None


def is_pdf(file: dict[str, Any]) -> bool:
    return file.get("type") == "application/pdf" or str(file.get("name") or "").lower().endswith(".pdf")


def office_kind(file: dict[str, Any]) -> str | None:
    """'docx' or 'pptx' for Word and PowerPoint files (read as text), else None."""
    suffix = PurePosixPath(str(file.get("name") or "")).suffix.lower()
    return suffix[1:] if suffix in (".docx", ".pptx") else None


def _pdf(data: bytes) -> tuple[int | None, str]:
    """(page count, text) of a PDF; (None, "") if it can't be read (damaged or locked)."""
    try:
        reader = PdfReader(io.BytesIO(data))
        # Text from the first PDF_PAGES pages only: a huge or hostile PDF can't tie the server up.
        pages = list(reader.pages)[:PDF_PAGES]
        return len(reader.pages), "\n\n".join((page.extract_text() or "").strip() for page in pages).strip()
    except Exception:
        logger.warning("Could not read an attached PDF", exc_info=True)
        return None, ""


def _office_text(data: bytes, kind: str) -> str:
    """The words in a .docx (paragraph by paragraph) or .pptx (slide by slide), from its XML."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if kind == "docx":
                parts = ["word/document.xml"]
            else:
                slides = [n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
                parts = sorted(slides, key=lambda n: int(re.findall(r"\d+", n)[-1]))
            pages = []
            unpacked = 0
            for number, part in enumerate(parts[:OFFICE_PARTS], 1):
                # A zip bomb (a tiny file that unpacks to gigabytes) is stopped before unpacking.
                unpacked += archive.getinfo(part).file_size
                if unpacked > OFFICE_UNPACKED_BYTES:
                    break
                xml = archive.read(part).decode("utf-8", "replace")
                xml = re.sub(r"</(w|a):p>", "\n", xml)
                xml = re.sub(r"<(w:tab|w:br|a:br)\b[^>]*/>", " ", xml)
                words = html.unescape(re.sub(r"<[^>]+>", "", xml))
                words = re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", words)).strip()
                pages.append(f"Slide {number}:\n{words}" if kind == "pptx" else words)
            return "\n\n".join(p for p in pages if p.strip())
    except Exception:
        logger.warning("Could not read an attached %s file", kind, exc_info=True)
        return ""


def read_for_ai(
    messages: list[dict[str, Any]], native: bool, where: list[str] | None = None
) -> tuple[list[dict[str, Any]], str]:
    """
    What the AI gets from these messages' files, most relevant message first so the caps keep
    the right ones: (blocks, text). `where` says, per message, where its files come from ("attached
    to the message you're answering"); every file is labelled with it, so the AI never mistakes an
    earlier file for the one being asked about.

    - `blocks` are Anthropic content blocks, only when `native`: images, and PDFs as documents
      (it reads their pages, pictures included).
    - `text` is for every provider: text and code files, the words of Word and PowerPoint
      files, and a PDF's text when it can't go natively (another provider, too many pages).

    Anything too big, locked, unreadable or of another type stays as its note only.
    """
    blocks: list[dict[str, Any]] = []
    texts: list[str] = []
    used = media = images = docs = 0

    def add_text(label: str, body: str) -> None:
        nonlocal used
        body = body[: max(TEXT_TOTAL - used, 0)]
        if body.strip():
            used += len(body)
            texts.append(f"{label}:\n```\n{body}\n```")

    for index, msg in enumerate(messages):
        place = where[index] if where and index < len(where) else "attached in this thread"
        for file in attachments_of(msg):
            path, name = str(file.get("path") or ""), str(file.get("name") or "file")
            # Only files in the message's own thread folder (the database already insists; this
            # reads with the service key, so it checks again rather than trust the row).
            if msg.get("thread_id") and not path.startswith(f"{msg['thread_id']}/"):
                continue
            label = {"type": "text", "text": f"[File: {name}, {place}]"}
            try:
                size = int(file.get("size"))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                continue
            if not path:
                continue
            if file.get("type") in AI_IMAGE_TYPES:
                if native and size <= AI_IMAGE_BYTES and images < AI_IMAGES and media + size <= MEDIA_BYTES:
                    data = _download(path)
                    if data:
                        blocks.append(label)
                        blocks.append({"type": "image", "source": {"type": "base64", "media_type": str(file["type"]), "data": base64.b64encode(data).decode()}})
                        images += 1
                        media += len(data)
            elif is_pdf(file):
                if docs >= AI_DOCS:
                    continue
                data = _download(path)
                if not data:
                    continue
                docs += 1
                pages, text = _pdf(data)
                if native and pages is not None and pages <= PDF_PAGES and media + len(data) <= MEDIA_BYTES:
                    blocks.append(label)
                    blocks.append({
                        "type": "document", "title": name,
                        "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(data).decode()},
                    })  # fmt: skip
                    media += len(data)
                elif used < TEXT_TOTAL:
                    add_text(f"Text of the attached PDF {name} ({place})", text or "(no readable text: it may be scanned images only)")
            elif office_kind(file):
                if docs >= AI_DOCS or used >= TEXT_TOTAL:
                    continue
                data = _download(path)
                if data:
                    docs += 1
                    add_text(f"Text of the attached file {name} ({place})", _office_text(data, office_kind(file) or ""))
            elif is_text(file) and size <= TEXT_BYTES and used < TEXT_TOTAL:
                data = _download(path)
                try:
                    text = data.decode("utf-8") if data else None
                except UnicodeDecodeError:
                    text = None
                if text is not None:
                    add_text(f"Contents of the attached file {name} ({place})", text)
    return blocks, "\n\n".join(texts)
