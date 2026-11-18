export type Tier = "simple" | "standard" | "complex"

export interface PromptSignals {
  length: number
  codeBlocks: number
  hardKeywords: string[]
  files: number
  hasStackTrace: boolean
}

export interface Classification {
  tier: Tier
  score: number
  ambiguous: boolean
  signals: PromptSignals
}

const HARD_KEYWORDS = [
  "архитектур",
  "спроектир",
  "перепроектир",
  "миграц",
  "рефактор",
  "докажи",
  "исследуй",
  "сравни",
  "проанализируй",
  "оптимизир",
  "финмодел",
  "юнит-эконом",
  "стратег",
  "производительност",
  "дебаж",
  "отлад",
  "найди баг",
  "почему не работает",
  "инцидент",
  "утечк",
  "нагрузк",
  "architect",
  "design a",
  "migrat",
  "refactor",
  "prove",
  "investigat",
  "analyz",
  "optimi",
  "benchmark",
  "race condition",
  "deadlock",
  "concurrency",
  "vulnerab",
  "root cause",
  "flaky",
  "regression",
  "scalab",
  "trade-off",
  "tradeoff",
]

const STACK_TRACE = /(\n\s+at\s+\S+\s+\(|\bTraceback \(most recent call last\)|\bpanic:|\bError:\s.+\n\s+at )/

function lengthScore(length: number): number {
  if (length < 140) return 0
  if (length < 500) return 2
  if (length < 2000) return 3
  return 4
}

function codeScore(codeBlocks: number): number {
  if (codeBlocks === 0) return 0
  if (codeBlocks <= 2) return 2
  return 4
}

function filesScore(files: number): number {
  if (files <= 0) return 0
  if (files === 1) return 1
  return 2
}

export function analyze(text: string, files = 0): PromptSignals {
  const lowered = text.toLowerCase()
  return {
    length: text.length,
    codeBlocks: Math.floor((text.match(/```/g)?.length ?? 0) / 2),
    hardKeywords: HARD_KEYWORDS.filter((word) => lowered.includes(word)),
    files,
    hasStackTrace: STACK_TRACE.test(text),
  }
}

/**
 * Heuristic complexity score.
 *
 * 0–1   simple   — greetings, one-liners, trivial lookups
 * 2–5   standard — everyday work
 * >= 6  complex  — architecture, migrations, hard debugging, research
 */
export function classify(text: string, files = 0): Classification {
  const signals = analyze(text, files)
  const score =
    lengthScore(signals.length) +
    codeScore(signals.codeBlocks) +
    Math.min(signals.hardKeywords.length, 2) * 3 +
    filesScore(signals.files) +
    (signals.hasStackTrace ? 6 : 0)

  const tier: Tier = score <= 1 ? "simple" : score <= 5 ? "standard" : "complex"

  // The genuinely hard calls: a medium-length request with no other signal,
  // or a request sitting right on a tier boundary.
  const mediumAndPlain =
    signals.hardKeywords.length === 0 &&
    signals.codeBlocks === 0 &&
    signals.files === 0 &&
    !signals.hasStackTrace &&
    signals.length >= 140 &&
    signals.length <= 600

  return {
    tier,
    score,
    ambiguous: mediumAndPlain || score === 2 || score === 5,
    signals,
  }
}

const RANK: Record<Tier, number> = { simple: 0, standard: 1, complex: 2 }

/**
 * A model switch costs a prompt-cache miss on the whole conversation, so the
 * tier moves once per session and only upwards — and only when the prompt
 * carries a signal that length alone cannot fake.
 */
export function shouldEscalate(next: Classification, current: Tier): boolean {
  if (RANK[next.tier] <= RANK[current]) return false
  return next.signals.hardKeywords.length > 0 || next.signals.hasStackTrace
}
