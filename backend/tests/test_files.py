"""
Files attached to messages (2026-09-30), with fakes only (no model, no storage, no credits):
- every AI reader sees a note per file, including attachment-only messages;
- files on the latest messages up to the asking one (and on the replied-to one) are opened:
  Anthropic gets images and PDFs natively, every provider gets text, Word and PowerPoint text
  (and a PDF's text when it can't go natively); older files stay notes, so they aren't paid again;
- oversized, locked, binary or unreadable files stay as their note; caps hold;
- the Markdown export lists files.
"""

import io
import zipfile
from unittest.mock import patch

from fastapi.testclient import TestClient
from pypdf import PdfWriter

import main
from backend import files, llm
from backend.auth import get_current_user
from tests.fakes import FakeClient
from tests.test_context import captured, msg, world  # noqa: F401  (captured is a fixture)


def pdf_with_text(text: str) -> bytes:
    """A real one-page PDF whose page says `text`."""
    stream = f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def blank_pdf(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=100, height=100)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def office_file(parts: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, xml in parts.items():
            archive.writestr(name, xml)
    return buffer.getvalue()


POSTER = pdf_with_text("Communication protocols poster")
DOCX = office_file({"word/document.xml": (
    '<w:document><w:body><w:p><w:r><w:t>Project plan</w:t></w:r></w:p>'
    '<w:p><w:r><w:t>Sensors &amp; pumps</w:t></w:r><w:r><w:tab/><w:t>by Friday</w:t></w:r></w:p></w:body></w:document>'
)})  # fmt: skip
PPTX = office_file({
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Results</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Intro</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Thanks</a:t></a:r></a:p></p:sld>",
})  # fmt: skip

PNG = {"path": "t/1/shot.png", "name": "shot.png", "size": 2048, "type": "image/png"}
NOTES = {"path": "t/2/notes.py", "name": "notes.py", "size": 40, "type": "text/x-python"}
PDF = {"path": "t/3/poster.pdf", "name": "poster.pdf", "size": len(POSTER), "type": "application/pdf"}
WORD = {"path": "t/4/plan.docx", "name": "plan.docx", "size": len(DOCX),
        "type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}  # fmt: skip
SLIDES = {"path": "t/5/deck.pptx", "name": "deck.pptx", "size": len(PPTX),
          "type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}  # fmt: skip
CONTENTS = {
    PNG["path"]: b"\x89PNG fake", NOTES["path"]: b"print('hi')", PDF["path"]: POSTER,
    WORD["path"]: DOCX, SLIDES["path"]: PPTX,
}  # fmt: skip


def fake_storage(calls: list[str], contents: dict[str, bytes] = CONTENTS):
    def download(path: str) -> bytes | None:
        calls.append(path)
        return contents.get(path)

    return download


def test_notes_name_every_file_and_are_added_once():
    big = {**PDF, "size": 2_200_000}
    noted = files.with_notes({"content": "look", "attachments": [PNG, big]})
    assert noted["content"] == (
        "look\n[Attached file: shot.png (image, 2 KB)]\n[Attached file: poster.pdf (PDF, 2.1 MB)]"
    )
    assert files.with_notes(noted)["content"] == noted["content"]
    assert files.with_notes({"content": "", "attachments": [NOTES]})["content"] == (
        "[Attached file: notes.py (text file, 40 bytes)]"
    )
    assert files.with_notes({"content": "plain"}) == {"content": "plain"}
    assert files.human_size(5 * 1024 * 1024) == "5 MB" and files.human_size(None) == "unknown size"
    assert files.kind({"name": "app.zip", "type": "application/zip"}) == "ZIP file"
    assert files.kind({"name": "Dockerfile", "type": ""}) == "text file"
    assert files.kind(WORD) == "DOCX file"


def test_attachment_only_messages_reach_ai_readers_but_withdrawn_ones_dont():
    db = world([
        msg(1, text="", attachments=[PDF]),
        msg(2, text="", attachments=None, shared_by="u-a", withdrawn_at=msg(3)["created_at"]),
    ])
    with patch.object(llm, "get_db", return_value=db):
        view = llm.thread_view("t", None, 50_000)["messages"]
    assert [m["id"] for m in view] == ["m1"]
    assert "poster.pdf (PDF" in view[0]["content"]


def test_asking_message_hands_anthropic_images_and_pdfs_and_text_to_everyone(captured):  # noqa: F811
    calls: list[str] = []
    old = {**PNG, "path": "t/9/old.png", "name": "old.png"}
    db = world([
        msg(1, sender="u-b", text="old screenshot", attachments=[old]),
        *[msg(i, text=f"chat {i}") for i in range(2, 13)],
        msg(13, sender="u-a", text="what's wrong here?", attachments=[PNG, NOTES, PDF]),
    ])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls)):
        frames = list(llm.stream_ai_response("t", "u-a", message_id="m13", tz_offset=0))
    last = captured["messages"][-1]["content"]
    assert [block["type"] for block in last] == ["text", "image", "text", "document", "text"]
    assert last[0]["text"] == "[File: shot.png, attached to the message you're answering]"
    assert last[1]["source"]["media_type"] == "image/png"
    assert last[3]["source"]["media_type"] == "application/pdf" and last[3]["title"] == "poster.pdf"
    text = last[-1]["text"]
    assert "what's wrong here?" in text and "print('hi')" in text
    assert "Contents of the attached file notes.py (attached to the message you're answering)" in text
    assert "[Attached file: poster.pdf (PDF" in text
    # A file more than 10 messages back is a note in history, never downloaded again.
    assert "[Attached file: old.png (image" in captured["messages"][0]["content"]
    assert calls == [PNG["path"], NOTES["path"], PDF["path"]]
    assert any("Opening the attached files" in f for f in frames)


def test_a_file_uploaded_earlier_is_read_when_asked_about_later(captured):  # noqa: F811
    db = world([
        msg(1, sender="u-a", text="", attachments=[PDF]),
        msg(2, sender="u-b", text="nice"),
        msg(3, sender="u-a", text="what do you think of this poster?"),
    ])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage([])):
        list(llm.stream_ai_response("t", "u-a", message_id="m3", tz_offset=0))
    last = captured["messages"][-1]["content"]
    assert last[0]["text"].startswith("[File: poster.pdf, attached earlier by Priya")
    assert last[1]["type"] == "document" and last[1]["title"] == "poster.pdf"
    assert last[-1]["text"].endswith("what do you think of this poster?")


def test_reply_target_files_are_opened_too(captured):  # noqa: F811
    calls: list[str] = []
    db = world([
        msg(1, sender="u-b", text="here's the error", attachments=[PNG]),
        *[msg(i, text=f"chat {i}") for i in range(2, 13)],
        msg(13, sender="u-a", text="what does it say?", reply_to_message_id="m1"),
    ])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls)):
        list(llm.stream_ai_response("t", "u-a", message_id="m13", tz_offset=0))
    last = captured["messages"][-1]["content"]
    assert last[0]["text"].startswith("[File: shot.png, attached to the message being replied to (attached earlier by Arjun")
    assert last[1]["type"] == "image"
    assert "[Attached file: shot.png (image, 2 KB)]" in last[-1]["text"]  # inside the reply quote
    assert calls == [PNG["path"]]


def test_asking_about_a_new_image_never_brings_in_an_earlier_pdf(captured):  # noqa: F811
    # Live failure: a PDF, then a screenshot with "what do you see?", got an answer about both.
    calls: list[str] = []
    db = world([
        msg(1, sender="u-a", text="what do you think of this poster?", attachments=[PDF]),
        msg(2, sender=None, text="It's bold and clear."),
        msg(3, sender="u-a", text="what do you see?", attachments=[PNG]),
    ])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls)):
        list(llm.stream_ai_response("t", "u-a", message_id="m3", tz_offset=0))
    last = captured["messages"][-1]["content"]
    assert [block["type"] for block in last] == ["text", "image", "text"]
    assert last[0]["text"] == "[File: shot.png, attached to the message you're answering]"
    assert calls == [PNG["path"]]


def test_replying_to_the_image_opens_only_the_image(captured):  # noqa: F811
    calls: list[str] = []
    db = world([
        msg(1, sender="u-a", text="", attachments=[PDF]),
        msg(2, sender="u-a", text="", attachments=[PNG]),
        msg(3, sender="u-a", text="I'm talking about this", reply_to_message_id="m2"),
    ])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls)):
        list(llm.stream_ai_response("t", "u-a", message_id="m3", tz_offset=0))
    assert calls == [PNG["path"]]
    assert "being replied to" in captured["messages"][-1]["content"][0]["text"]


def test_without_files_or_a_reply_every_recent_file_is_opened_newest_first(captured):  # noqa: F811
    # Live failure: a PDF, then a screenshot, then "who's building it according to the pdf?"
    # opened only the screenshot, so the AI never saw the PDF.
    calls: list[str] = []
    db = world([
        msg(1, sender="u-a", text="what do you think of the abstract?", attachments=[PDF]),
        msg(2, sender="u-b", text="what do you see?", attachments=[PNG]),
        msg(3, sender="u-a", text="who's building it according to the pdf?"),
    ])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls)):
        list(llm.stream_ai_response("t", "u-a", message_id="m3", tz_offset=0))
    assert calls == [PNG["path"], PDF["path"]]
    last = captured["messages"][-1]["content"]
    assert [block["type"] for block in last] == ["text", "image", "text", "document", "text"]
    assert last[0]["text"].startswith("[File: shot.png, attached earlier by Arjun")
    assert last[2]["text"].startswith("[File: poster.pdf, attached earlier by Priya")


def test_no_files_means_a_plain_text_turn(captured):  # noqa: F811
    db = world([msg(1, sender="u-a", text="hello")])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download") as download:
        list(llm.stream_ai_response("t", "u-a", message_id="m1", tz_offset=0))
    assert isinstance(captured["messages"][-1]["content"], str)
    download.assert_not_called()


def test_other_providers_read_pdf_word_and_powerpoint_text_but_get_no_images():
    calls: list[str] = []
    with patch.object(files, "_download", fake_storage(calls)):
        blocks, text = files.read_for_ai([{"attachments": [PNG, PDF, WORD, SLIDES]}], native=False)
    assert blocks == [] and PNG["path"] not in calls
    assert "Text of the attached PDF poster.pdf" in text and "Communication protocols poster" in text
    assert "Project plan\nSensors & pumps by Friday" in text
    assert text.index("Slide 1:\nIntro") < text.index("Slide 2:\nResults") < text.index("Slide 3:\nThanks")


def test_long_pdfs_go_as_text_and_unreadable_ones_say_so():
    long_pdf = {**PDF, "path": "t/6/long.pdf", "name": "long.pdf"}
    broken = {**PDF, "path": "t/7/broken.pdf", "name": "broken.pdf"}
    contents = {long_pdf["path"]: blank_pdf(files.PDF_PAGES + 1), broken["path"]: b"%PDF-1.4 not really"}
    with patch.object(files, "_download", fake_storage([], contents)):
        blocks, text = files.read_for_ai([{"attachments": [long_pdf, broken]}], native=True)
    assert blocks == []
    assert "Text of the attached PDF long.pdf" in text and "no readable text" in text
    assert "Text of the attached PDF broken.pdf" in text


def test_big_binary_or_unreadable_files_stay_as_notes():
    big_image = {**PNG, "size": files.AI_IMAGE_BYTES + 1}
    big_text = {**NOTES, "size": files.TEXT_BYTES + 1}
    binary = {**NOTES, "path": "t/4/data.csv", "name": "data.csv"}
    missing = {**NOTES, "path": "t/5/gone.txt", "name": "gone.txt"}
    svg = {"path": "t/6/logo.svg", "name": "logo.svg", "size": 100, "type": "image/svg+xml"}
    zipped = {"path": "t/8/code.zip", "name": "code.zip", "size": 100, "type": "application/zip"}
    calls: list[str] = []

    def download(path: str) -> bytes | None:
        calls.append(path)
        return b"\xff\xfe\x00bad" if path == binary["path"] else None

    with patch.object(files, "_download", download):
        blocks, text = files.read_for_ai([{"attachments": [big_image, big_text, binary, missing, svg, zipped]}], native=True)
    assert blocks == [] and text == ""
    assert calls == [binary["path"], missing["path"]]


def test_a_zip_bomb_is_not_unpacked():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", " " * (files.OFFICE_UNPACKED_BYTES + 1))
    bomb = buffer.getvalue()
    assert len(bomb) < 200_000  # tiny on disk, 40 MB unpacked
    assert files._office_text(bomb, "docx") == ""


def test_only_files_in_the_messages_own_thread_are_opened():
    # The database refuses such rows; the service-key reader checks again anyway.
    calls: list[str] = []
    stray = {**NOTES, "path": "other-thread/1/secret.txt"}
    with patch.object(files, "_download", fake_storage(calls)):
        blocks, text = files.read_for_ai([{"thread_id": "t", "attachments": [stray, NOTES]}], native=True)
    assert calls == [NOTES["path"]]


def test_caps_on_images_documents_and_text():
    many_images = [{**PNG, "path": f"t/i{i}/p.png"} for i in range(7)]
    many_pdfs = [{**PDF, "path": f"t/d{i}/p.pdf"} for i in range(5)]
    texts = [{**NOTES, "path": f"t/x{i}/n.txt", "name": f"n{i}.txt"} for i in range(3)]
    contents = {f["path"]: POSTER for f in many_pdfs} | {f["path"]: b"z" * 40_000 for f in texts}
    contents |= {f["path"]: b"img" for f in many_images}
    with patch.object(files, "_download", fake_storage([], contents)):
        blocks, text = files.read_for_ai([{"attachments": many_images + many_pdfs + texts}], native=True)
    assert sum(b["type"] == "image" for b in blocks) == files.AI_IMAGES
    assert sum(b["type"] == "document" for b in blocks) == files.AI_DOCS
    assert text.count("z") == files.TEXT_TOTAL


def test_markdown_export_lists_files():
    big = {**PDF, "size": 2_200_000}
    db = FakeClient(
        threads=[{"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None, "name": "Team Space"}],
        projects=[{"id": "p1", "team_id": "t1"}],
        team_members=[{"team_id": "t1", "user_id": "u-me", "role": "owner", "joined_at": "1"}],
        profiles=[{"id": "u-me", "display_name": "Priya"}],
        messages=[
            {"id": "a", "thread_id": "shared", "sender_type": "user", "sender_id": "u-me", "content": "",
             "attachments": [PNG, big], "created_at": "1"},
        ],
    )  # fmt: skip
    main.app.dependency_overrides[get_current_user] = lambda: "u-me"
    try:
        with (
            patch.object(main, "verify_thread_access", return_value=True),
            patch.object(main, "get_db", return_value=db),
            patch.object(llm, "get_db", return_value=db),
        ):
            text = TestClient(main.app).get("/api/export/shared?format=md").text
            data = TestClient(main.app).get("/api/export/shared?format=json").json()
    finally:
        main.app.dependency_overrides.clear()
    assert "_Attached: shot.png (image, 2 KB)_" in text and "_Attached: poster.pdf (PDF, 2.1 MB)_" in text
    assert data["messages"][0]["attachments"][0]["name"] == "shot.png"
