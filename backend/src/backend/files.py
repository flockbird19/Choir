"""
Files attached to messages (2026-09-30).

A message's `attachments` is a list of {path, name, size, type}; `path` points into the
private "attachments" storage bucket. Everything that reads a thread for the AI sees each file
as a one-line note. Files are also opened inside the message they came with (read_for_ai), newest
first within shared caps: images for providers that see them, PDFs natively for Anthropic, and
the text of text, Word, PowerPoint (and other providers' PDF) files for everyone.
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


def sees_images(provider: str) -> bool:
    """Claude, GPT-4o and Gemini look at images; Choir's Groq model (Llama 3.3) reads text only."""
    return provider != "groq"


def read_for_ai(
    messages: list[dict[str, Any]], provider: str, text_total: int = TEXT_TOTAL
) -> dict[str, list[dict[str, Any]]]:
    """
    The files the AI opens, per message id, as content blocks that go *inside that message*,
    the way ChatGPT and Claude.ai keep a file where it was sent (no guessing which file a
    question means). `messages` come most important first (the asked and replied-to messages,
    then newest to oldest), so the caps, shared by the whole conversation, keep the right files;
    the rest stay as their note line.

    Blocks are Anthropic-shaped; llm.py turns them into OpenAI's for the other providers.
    - images: for providers that see images;
    - PDFs: as documents for Anthropic (it reads their pages, pictures included), else their text;
    - text and code files, and the words of Word and PowerPoint files: as text, for everyone.

    Anything too big, locked, unreadable or of another type stays as its note only.
    """
    native, images_ok = provider == "anthropic", sees_images(provider)
    opened: dict[str, list[dict[str, Any]]] = {}
    used = media = images = docs = 0

    for msg in messages:
        if msg.get("sender_type") != "user" or msg.get("id") in opened:
            continue
        blocks: list[dict[str, Any]] = []

        def add_text(label: str, body: str) -> None:
            nonlocal used
            body = body[: max(text_total - used, 0)]
            if body.strip():
                used += len(body)
                blocks.append({"type": "text", "text": f"{label}:\n```\n{body}\n```"})

        for file in attachments_of(msg):
            path, name = str(file.get("path") or ""), str(file.get("name") or "file")
            # Only files in the message's own thread folder (the database already insists; this
            # reads with the service key, so it checks again rather than trust the row).
            if msg.get("thread_id") and not path.startswith(f"{msg['thread_id']}/"):
                continue
            label = {"type": "text", "text": f"[File: {name}]"}
            try:
                size = int(file.get("size"))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                continue
            if not path:
                continue
            if file.get("type") in AI_IMAGE_TYPES:
                if images_ok and size <= AI_IMAGE_BYTES and images < AI_IMAGES and media + size <= MEDIA_BYTES:
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
                elif used < text_total:
                    add_text(f"Text of the attached PDF {name}", text or "(no readable text: it may be scanned images only)")
            elif office_kind(file):
                if docs >= AI_DOCS or used >= text_total:
                    continue
                data = _download(path)
                if data:
                    docs += 1
                    add_text(f"Text of the attached file {name}", _office_text(data, office_kind(file) or ""))
            elif is_text(file) and size <= TEXT_BYTES and used < text_total:
                data = _download(path)
                try:
                    text = data.decode("utf-8") if data else None
                except UnicodeDecodeError:
                    text = None
                if text is not None:
                    add_text(f"Contents of the attached file {name}", text)
        if blocks:
            opened[msg["id"]] = blocks
    return opened
