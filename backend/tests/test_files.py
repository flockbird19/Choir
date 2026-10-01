"""
Files attached to messages (2026-09-30), with fakes only (no model, no storage, no credits):
- every AI reader sees a note per file, including attachment-only messages;
- files are opened inside the message they came with (chat, Catch me up, findings, Export as
  prompt), the asked and replied-to messages' first, then newest to oldest within shared caps;
  Anthropic gets images and PDFs natively, OpenAI and Gemini images, everyone text, Word,
  PowerPoint (and other providers' PDF) text; files past the caps stay notes;
- the conversation is cached up to the app's note, which ends the last turn;
- oversized, locked, binary or unreadable files stay as their note;
- the Markdown export lists files.
"""

import io
import zipfile
from unittest.mock import patch

from fastapi.testclient import TestClient
from pypdf import PdfWriter

import main
from backend import files, findings, handoff, llm
from backend.auth import get_current_user
from tests.fakes import FakeClient, turn_text
from tests.test_context import captured, msg, world  # noqa: F401  (captured is a fixture)
from tests.test_prompts import chat


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


def kinds(content) -> list[str]:
    return [block["type"] for block in content] if isinstance(content, list) else ["str"]


def test_files_stay_inside_the_message_they_came_with(captured):  # noqa: F811
    # Live failure (three guessing rules): a PDF, then a screenshot, then "who's building it
    # according to the pdf?". Now every file sits in its own message, as in ChatGPT and Claude.ai.
    calls: list[str] = []
    db = world([
        msg(1, sender="u-a", text="what do you think of the abstract?", attachments=[PDF]),
        msg(2, sender=None, text="It's clear."),
        msg(3, sender="u-b", text="what do you see?", attachments=[PNG]),
        msg(4, sender="u-a", text="who's building it according to the pdf?"),
    ])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls)):
        frames = list(llm.stream_ai_response("t", "u-a", message_id="m4", tz_offset=0))
    turns = captured["messages"]
    assert kinds(turns[0]["content"]) == ["text", "text", "document"]
    assert turns[0]["content"][0]["text"].startswith("[Priya · ") and turns[0]["content"][1]["text"] == "[File: poster.pdf]"
    assert turns[0]["content"][2]["title"] == "poster.pdf"
    assert turns[1] == {"role": "assistant", "content": "It's clear."}
    assert kinds(turns[2]["content"]) == ["text", "text", "image"] and "[Arjun · " in turns[2]["content"][0]["text"]
    assert turn_text(turns[3]["content"]).endswith("who's building it according to the pdf?")
    assert calls == [PNG["path"], PDF["path"]]  # newest first, so the caps keep the latest files
    assert any("Opening the attached files" in f for f in frames)


def test_the_asking_messages_own_files_come_with_it_and_the_cache_ends_before_the_note(captured):  # noqa: F811
    db = world([msg(1, sender="u-a", text="what's wrong here?", attachments=[PNG, NOTES, PDF])])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage([])):
        list(llm.stream_ai_response("t", "u-a", message_id="m1", tz_offset=0))
    last = captured["messages"][-1]["content"]
    assert kinds(last) == ["text", "text", "image", "text", "text", "document", "text"]
    assert last[1]["text"] == "[File: shot.png]"
    assert last[3]["text"].startswith("Contents of the attached file notes.py:") and "print('hi')" in last[3]["text"]
    assert last[5]["cache_control"] == {"type": "ephemeral"}  # the conversation and its files are cached
    assert last[6]["text"].startswith("[Note from the Choir app") and "cache_control" not in last[6]


def test_caps_keep_the_newest_files_and_older_ones_stay_notes(captured):  # noqa: F811
    calls: list[str] = []
    shots = [{**PNG, "path": f"t/{i}/s.png", "name": f"s{i}.png"} for i in range(1, 8)]
    db = world([*[msg(i, sender="u-a", text="", attachments=[shots[i - 1]]) for i in range(1, 8)], msg(8, text="compare them")])
    contents = {s["path"]: b"img" for s in shots}
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls, contents)):
        list(llm.stream_ai_response("t", "u-a", message_id="m8", tz_offset=0))
    assert calls == [s["path"] for s in reversed(shots)][: files.AI_IMAGES]
    oldest = captured["messages"][0]["content"]
    assert isinstance(oldest, str) and "[Attached file: s1.png (image" in oldest


def test_a_replied_to_message_opens_its_files_first(captured):  # noqa: F811
    calls: list[str] = []
    shots = [{**PNG, "path": f"t/{i}/s.png", "name": f"s{i}.png"} for i in range(1, 8)]
    db = world([
        *[msg(i, sender="u-a", text="", attachments=[shots[i - 1]]) for i in range(1, 8)],
        msg(8, sender="u-a", text="what does this one say?", reply_to_message_id="m1"),
    ])
    contents = {s["path"]: b"img" for s in shots}
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download", fake_storage(calls, contents)):
        list(llm.stream_ai_response("t", "u-a", message_id="m8", tz_offset=0))
    assert calls[0] == shots[0]["path"] and len(calls) == files.AI_IMAGES
    assert kinds(captured["messages"][0]["content"]) == ["text", "text", "image"]


def test_no_files_means_no_downloads(captured):  # noqa: F811
    db = world([msg(1, sender="u-a", text="hello")])
    with patch.object(llm, "get_db", return_value=db), patch.object(files, "_download") as download:
        list(llm.stream_ai_response("t", "u-a", message_id="m1", tz_offset=0))
    assert turn_text(captured["messages"][-1]["content"]).endswith("hello")
    download.assert_not_called()


def test_openai_gets_images_as_data_urls_in_their_message():
    db = world([msg(1, sender="u-a", text="", attachments=[PNG, PDF]), msg(2, sender="u-a", text="thoughts?")])
    with chat(db, provider="openai") as seen, patch.object(files, "_download", fake_storage([])):
        list(llm.stream_ai_response("t", "u-a", message_id="m2", tz_offset=0))
    first = seen["messages"][1]["content"]
    assert [p["type"] for p in first] == ["text", "text", "image_url", "text"]
    assert first[2]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "Text of the attached PDF poster.pdf" in first[3]["text"] and "Communication protocols poster" in first[3]["text"]
    last = seen["messages"][-1]["content"]
    assert isinstance(last, str) and "thoughts?" in last and "[Note from the Choir app" in last


def test_groq_reads_text_only_and_never_downloads_images():
    calls: list[str] = []
    with patch.object(files, "_download", fake_storage(calls)):
        opened = files.read_for_ai([{"id": "m", "sender_type": "user", "attachments": [PNG, PDF, WORD, SLIDES]}], "groq")
    text = llm.openai_content(opened["m"], "groq")
    assert isinstance(text, str) and PNG["path"] not in calls
    assert "Text of the attached PDF poster.pdf" in text and "Communication protocols poster" in text
    assert "Project plan\nSensors & pumps by Friday" in text
    assert text.index("Slide 1:\nIntro") < text.index("Slide 2:\nResults") < text.index("Slide 3:\nThanks")


def _one(attachments: list[dict], **extra) -> list[dict]:
    message = {"id": "m", "sender_type": "user", "attachments": attachments, **extra}
    return files.read_for_ai([message], "anthropic").get("m", [])


def test_long_pdfs_go_as_text_and_unreadable_ones_say_so():
    long_pdf = {**PDF, "path": "t/6/long.pdf", "name": "long.pdf"}
    broken = {**PDF, "path": "t/7/broken.pdf", "name": "broken.pdf"}
    contents = {long_pdf["path"]: blank_pdf(files.PDF_PAGES + 1), broken["path"]: b"%PDF-1.4 not really"}
    with patch.object(files, "_download", fake_storage([], contents)):
        blocks = _one([long_pdf, broken])
    assert kinds(blocks) == ["text", "text"]
    assert "Text of the attached PDF long.pdf" in blocks[0]["text"] and "no readable text" in blocks[0]["text"]
    assert "Text of the attached PDF broken.pdf" in blocks[1]["text"]


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
        assert _one([big_image, big_text, binary, missing, svg, zipped]) == []
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
        _one([stray, NOTES], thread_id="t")
    assert calls == [NOTES["path"]]


def test_caps_on_images_documents_and_text_are_shared_by_the_whole_conversation():
    many_images = [{**PNG, "path": f"t/i{i}/p.png"} for i in range(7)]
    many_pdfs = [{**PDF, "path": f"t/d{i}/p.pdf"} for i in range(5)]
    texts = [{**NOTES, "path": f"t/x{i}/n.txt", "name": f"n{i}.txt"} for i in range(3)]
    contents = {f["path"]: POSTER for f in many_pdfs} | {f["path"]: b"z" * 40_000 for f in texts}
    contents |= {f["path"]: b"img" for f in many_images}
    messages = [{"id": f"m{i}", "sender_type": "user", "attachments": [f]} for i, f in enumerate(many_images + many_pdfs + texts)]
    with patch.object(files, "_download", fake_storage([], contents)):
        opened = files.read_for_ai(messages, "anthropic")
    blocks = [block for found in opened.values() for block in found]
    assert sum(b["type"] == "image" for b in blocks) == files.AI_IMAGES
    assert sum(b["type"] == "document" for b in blocks) == files.AI_DOCS
    assert sum(b["text"].count("z") for b in blocks if b["type"] == "text") == files.TEXT_TOTAL


def test_catch_me_up_findings_and_export_see_files_in_their_message():
    def one_shot(run, thread: str):
        seen: list = []
        poster = {**PDF, "path": f"{thread}/3/poster.pdf"}
        db = world([
            msg(1, thread=thread, sender="u-a", text="the plan", attachments=[poster]),
            msg(2, thread=thread, sender="u-a", text="thoughts?"),
        ])

        def fake(provider, model, key, system, prompt, max_tokens):
            seen.append(prompt)
            return "ok"

        with (
            patch.object(llm, "get_db", return_value=db),
            patch.object(llm, "get_api_key", return_value="sk"),
            patch.object(llm, "complete_once", side_effect=fake),
            patch.object(findings, "complete_once", side_effect=fake),
            patch.object(handoff, "complete_once", side_effect=fake),
            patch.object(files, "_download", fake_storage([], {poster["path"]: POSTER})),
        ):
            run()
        return seen[-1]

    for prompt in (
        one_shot(lambda: llm.generate_digest("t", "u-a"), "t"),
        one_shot(lambda: findings.draft_findings("priv", "u-a"), "priv"),
        one_shot(lambda: handoff.draft_handoff_prompt("priv", "u-a"), "priv"),
    ):
        assert kinds(prompt) == ["text", "text", "document", "text"]
        assert "the plan\n[Attached file: poster.pdf (PDF" in prompt[0]["text"] and "thoughts?" not in prompt[0]["text"]
        assert prompt[1]["text"] == "[File: poster.pdf]" and prompt[2]["title"] == "poster.pdf"
        assert "thoughts?" in prompt[3]["text"]


def test_one_shot_prompts_stay_plain_text_without_files():
    assert llm.with_files("HEAD\n", [msg(1, text="hi")], lambda m: m["content"], "anthropic") == "HEAD\nhi"


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
