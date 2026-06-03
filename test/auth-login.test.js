import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, hashPassword, verifyPassword } from "../src/auth.js";

test("password hashes verify the original password only", () => {
  const hash = hashPassword("correct-horse-battery");
  assert.equal(verifyPassword("correct-horse-battery", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
  assert.equal(hash.includes("correct-horse-battery"), false);
});

test("dashboard session tokens expose only a plain token and hash pair", () => {
  const token = createSessionToken();
  assert.match(token.plainText, /^aps_[a-f0-9]+$/);
  assert.equal(token.hash.length, 64);
  assert.equal(token.hash.includes(token.plainText), false);
});
