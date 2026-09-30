// Run: node --experimental-strip-types scripts/check-attachments.mjs
import assert from "node:assert";
import {
  attachmentsLabel, cleanFileName, formatBytes, isInlineImage, messageText, storageName, validAttachments, MAX_FILE_BYTES,
} from "../src/utils/attachments.ts";

assert.equal(formatBytes(512), "512 B");
assert.equal(formatBytes(2048), "2 KB");
assert.equal(formatBytes(2.2 * 1024 * 1024), "2.2 MB");
assert.equal(formatBytes(10 * 1024 * 1024), "10 MB");

assert.equal(storageName("Screenshot 2026-09-30 at 10.41.22 PM.png"), "Screenshot_2026-09-30_at_10.41.22_PM.png");
assert.equal(storageName("résumé final.pdf"), "resume_final.pdf");
assert.equal(storageName("../../etc/passwd"), "etc_passwd");
assert.equal(storageName("日本語.txt"), "file.txt");
assert.equal(storageName(".env"), "env");
assert.ok(!storageName("a/b\\c:d?.txt").match(/[\\/:?]/), "no path separators or odd characters");

assert.ok(isInlineImage({ type: "image/png" }) && isInlineImage({ type: "image/webp" }));
assert.ok(!isInlineImage({ type: "image/svg+xml" }), "SVG never shows inline");
assert.ok(!isInlineImage({ type: "text/html" }));

const png = { path: "t/1/a.png", name: "a.png", size: 5, type: "image/png" };
const pdf = { path: "t/2/b.pdf", name: "b.pdf", size: 5, type: "application/pdf" };
assert.equal(attachmentsLabel([png]), "Image: a.png");
assert.equal(attachmentsLabel([pdf]), "File: b.pdf");
assert.equal(attachmentsLabel([png, png]), "2 images");
assert.equal(attachmentsLabel([png, pdf]), "2 files");
assert.equal(attachmentsLabel(null), "");
assert.equal(messageText({ content: "", attachments: [pdf] }), "File: b.pdf");
assert.equal(messageText({ content: "hi", attachments: [pdf] }), "hi");

const T = "11111111-1111-1111-1111-111111111111";
const ok = { path: `${T}/abc/a.png`, name: "a.png", size: 10, type: "image/png", width: 40, height: 30 };
assert.deepEqual(validAttachments([ok], T), [ok]);
assert.deepEqual(validAttachments(undefined, T), []);
assert.equal(validAttachments([{ ...ok, path: `other/abc/a.png` }], T), null, "another thread's file");
assert.equal(validAttachments([{ ...ok, path: `${T}/../x/a.png` }], T), null, "path escape");
assert.equal(validAttachments([{ ...ok, path: `${T}/a.png` }], T), null, "wrong depth");
assert.equal(validAttachments([{ ...ok, size: MAX_FILE_BYTES + 1 }], T), null, "too big");
assert.equal(validAttachments([{ ...ok, name: "" }], T), null, "no name");
assert.equal(validAttachments(Array(11).fill(ok), T), null, "too many");
assert.equal(validAttachments("nope", T), null);
assert.equal(cleanFileName("report‮fdp.exe"), "reportfdp.exe", "direction marks removed");
assert.equal(cleanFileName("two\nlines.txt"), "twolines.txt", "control characters removed");
assert.equal(cleanFileName("   "), "file");
assert.equal(validAttachments([{ ...ok, name: "a‮gnp.exe" }], T), null, "hidden characters refused");
assert.deepEqual(validAttachments([{ ...ok, width: "x" }], T), [{ path: ok.path, name: "a.png", size: 10, type: "image/png" }]);

console.log("attachment checks pass");
