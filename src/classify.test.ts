import { test } from "node:test"
import assert from "node:assert/strict"
import { analyze, classify, shouldEscalate } from "./classify.ts"

const plain = (length: number) => "а".repeat(length)

test("greeting is simple and confident", () => {
  const result = classify("привет, как дела?")
  assert.equal(result.tier, "simple")
  assert.equal(result.score, 0)
  assert.equal(result.ambiguous, false)
})

test("one-liner edit is simple", () => {
  assert.equal(classify("поправь опечатку в README").tier, "simple")
})

test("medium plain request is standard but flagged ambiguous", () => {
  const result = classify(plain(314))
  assert.equal(result.tier, "standard")
  assert.equal(result.ambiguous, true)
})

test("architecture plus migration is complex", () => {
  const text = `Спроектируй архитектуру сервиса и опиши миграцию данных. ${plain(600)}`
  const result = classify(text)
  assert.equal(result.tier, "complex")
  assert.ok(result.signals.hardKeywords.length >= 2)
})

test("three code blocks lift a short message to standard", () => {
  const text = "```a```\n```b```\n```c```"
  const result = classify(text)
  assert.equal(result.signals.codeBlocks, 3)
  assert.equal(result.tier, "standard")
})

test("stack trace makes a short message complex", () => {
  const text = "TypeError: cannot read property\n    at foo (app.js:1:2)\n    at bar (app.js:3:4)"
  const result = classify(text)
  assert.equal(result.signals.hasStackTrace, true)
  assert.equal(result.tier, "complex")
})

test("attached files raise the tier", () => {
  const result = classify("посмотри", 3)
  assert.equal(result.tier, "standard")
  assert.equal(result.ambiguous, true)
})

test("keywords are matched case-insensitively", () => {
  assert.deepEqual(analyze("REFACTOR this module").hardKeywords, ["refactor"])
})

test("code fences count as blocks, not characters", () => {
  assert.equal(analyze("`inline` and ```block```").codeBlocks, 1)
})

test("length alone never escalates a running session", () => {
  const long = classify("а".repeat(2500))
  assert.equal(long.tier, "standard")
  assert.equal(shouldEscalate(long, "simple"), false)
})

test("a hard keyword escalates upward", () => {
  const text = `Спланируй архитектуру и миграцию биллинга. ${plain(600)}`
  assert.equal(classify(text).tier, "complex")
  assert.equal(shouldEscalate(classify(text), "standard"), true)
})

test("escalation never downgrades", () => {
  assert.equal(shouldEscalate(classify("привет"), "complex"), false)
  assert.equal(shouldEscalate(classify("привет"), "standard"), false)
})

test("a stack trace escalates a simple session", () => {
  const text = "boom\n    at foo (app.js:1:2)"
  assert.equal(shouldEscalate(classify(text), "simple"), true)
})
