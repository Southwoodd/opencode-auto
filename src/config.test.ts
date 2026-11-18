import { test } from "node:test"
import assert from "node:assert/strict"
import { candidateIds, classifierPrompt, normalizeOptions, parseTier, strategyFor } from "./config.ts"

test("defaults are safe", () => {
  const options = normalizeOptions(undefined)
  assert.equal(options.enabled, true)
  assert.equal(options.autoModelId, "auto")
  assert.equal(options.timeoutMs, 4000)
  assert.equal(options.classifierModel, undefined)
  assert.equal(options.strategy, "session")
  assert.deepEqual(options.strategies, { opencode: "request" })
  assert.deepEqual(options.routes, {
    opencode: {
      simple: "deepseek-v4.1-flash-free",
      standard: "mimo-v2.6-flash-free",
      complex: "longcat-2.5-free",
    },
  })
  assert.equal(strategyFor(options, "opencode"), "request")
  assert.ok(options.fallback.length > 0)
})

test("configuring any route replaces the built-in defaults", () => {
  const options = normalizeOptions({ routes: { proxyapi: { simple: "x" } } })
  assert.deepEqual(options.routes, { proxyapi: { simple: "x" } })
  assert.equal(options.strategy, "session")
})

test("a custom fallback list replaces the default one", () => {
  const options = normalizeOptions({ fallback: ["a", "", 5] })
  assert.deepEqual(options.fallback, ["a"])
})

test("blank route values are dropped", () => {
  const options = normalizeOptions({
    routes: {
      proxyapi: { simple: "", standard: "gpt-6.2-sol", complex: "claude-opus-5-5" },
      empty: { simple: "" },
    },
  })
  assert.deepEqual(options.routes, {
    proxyapi: { standard: "gpt-6.2-sol", complex: "claude-opus-5-5" },
  })
})

test("a route map can carry its own strategy", () => {
  const options = normalizeOptions({
    strategy: "session",
    routes: {
      opencode: { strategy: "request", simple: "a", standard: "b", complex: "c" },
      proxyapi: { simple: "x" },
    },
  })
  assert.deepEqual(options.routes.opencode, { simple: "a", standard: "b", complex: "c" })
  assert.equal(options.strategy, "session")
  assert.deepEqual(options.strategies, { opencode: "request" })
  assert.equal(strategyFor(options, "opencode"), "request")
  assert.equal(strategyFor(options, "proxyapi"), "session")
  assert.equal(strategyFor(options, "unknown"), "session")
})

test("an unknown strategy name is ignored", () => {
  const options = normalizeOptions({ strategy: "turbo", routes: { opencode: { strategy: "fast", simple: "a" } } })
  assert.equal(options.strategy, "session")
  assert.deepEqual(options.strategies, {})
})

test("incomplete classifier config is ignored", () => {
  assert.equal(normalizeOptions({ classifier: { model: { providerID: "opencode" } } }).classifierModel, undefined)
})

test("candidateIds prefers the exact tier, then standard, and dedupes", () => {
  const routes = { acme: { standard: "mid", complex: "big" }, flat: { simple: "one" } }
  assert.deepEqual(candidateIds(routes, "acme", "standard"), ["mid", "big"])
  assert.deepEqual(candidateIds(routes, "acme", "complex"), ["big", "mid"])
  assert.deepEqual(candidateIds(routes, "acme", "simple"), ["mid", "big"])
  assert.deepEqual(candidateIds(routes, "flat", "simple"), ["one"])
  assert.deepEqual(candidateIds(routes, "other", "simple"), [])
})

test("parseTier accepts a word or a sentence with one", () => {
  assert.equal(parseTier("complex"), "complex")
  assert.equal(parseTier("  STANDARD."), "standard")
  assert.equal(parseTier("I would say simple here"), "simple")
  assert.equal(parseTier("hard to tell"), undefined)
})

test("classifierPrompt truncates long input", () => {
  const prompt = classifierPrompt("x".repeat(5000), 100)
  assert.ok(prompt.includes("…[truncated]"))
  assert.ok(prompt.length < 1000)
  assert.ok(!prompt.includes("x".repeat(101)))
})

test("classifierPrompt asks for one word", () => {
  assert.ok(classifierPrompt("hi").includes("exactly one lowercase word"))
})
