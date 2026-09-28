// Run: node --experimental-strip-types scripts/check-secrets.mjs
import assert from "node:assert";
import { scanForSecrets, removeSecret } from "../src/utils/secrets.ts";
const s = (t) => scanForSecrets(t).map((m) => `${m.kind}:${m.label}`);
assert.deepEqual(s("use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 here"), ["credential:API key"]);
assert.deepEqual(s("token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123"), ["credential:API key"]);
assert.deepEqual(s("password=hunter2hunter"), ["credential:Password or secret"]);
assert.deepEqual(s("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----"), ["credential:Private key"]);
assert.deepEqual(s("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), ["credential:Access token"]);
assert.deepEqual(s("mail priya@example.com or call +91 98765 43210"), ["contact:Email address", "contact:Phone number"]);
assert.deepEqual(s("Shipped on 2026-09-28 14:30, used 3 sensors and 12 wires."), []);
assert.deepEqual(s("Use the VL53L0X over I2C at 400 kHz."), []);
assert.deepEqual(s("run 1790604444528 and id 20260929123456"), []);
assert.deepEqual(s("call 9876543210"), ["contact:Phone number"]);
const m = scanForSecrets("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123")[0];
assert.ok(!m.display.includes("abcdefghijklmnop"), "credential masked");
assert.equal(removeSecret("a X b X", "X"), "a [removed] b [removed]");
console.log("secrets checks pass");
