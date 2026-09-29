// Run: node --experimental-strip-types scripts/check-plain-text.mjs
import assert from "node:assert";
import { looksLikeCode, fenceCode, keepLineBreaks } from "../src/utils/plain-text.ts";

const arduino = `#include <WiFi.h>
#include <DHT.h>

const char* ssid = "SSID";
void setup() {
  Serial.begin(115200);
}`;
assert.ok(looksLikeCode(arduino), "Arduino sketch is code");
assert.ok(looksLikeCode("def add(a, b):\n    return a + b\n\nprint(add(1, 2))"), "Python is code");
assert.ok(!looksLikeCode("change the logo\nfix the formatting\nincrease rendering speed"), "a to-do list is not code");
assert.ok(!looksLikeCode("## Next steps\n1. Logo fix\n2. Typography"), "Markdown notes are not code");
assert.ok(!looksLikeCode("int x = 1;"), "one line stays as typed");
assert.ok(!looksLikeCode("```\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```"), "already fenced");
assert.equal(fenceCode("a;\nb;\n\n"), "```\na;\nb;\n```\n");

assert.equal(keepLineBreaks("one\ntwo"), "one  \ntwo  ");
assert.equal(keepLineBreaks("a\n\nb"), "a  \n\nb  ");
assert.equal(keepLineBreaks("```\nx = 1\ny = 2\n```\nafter"), "```\nx = 1\ny = 2\n```\nafter  ");
console.log("plain-text checks pass");
