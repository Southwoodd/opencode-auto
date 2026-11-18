import type { Tier } from "./classify.ts"

export interface ModelRef {
  providerID: string
  id: string
}

export interface RouteMap {
  simple?: string
  standard?: string
  complex?: string
}

export type Strategy = "session" | "request"

/** A route map may carry its own strategy; it is stripped out before use. */
export type RawRouteMap = RouteMap & { strategy?: Strategy }

export interface RouterOptions {
  enabled?: boolean
  autoModelId?: string
  strategy?: Strategy
  routes?: Record<string, RawRouteMap>
  fallback?: string[]
  escalate?: boolean
  classifier?: {
    model?: ModelRef
    timeoutMs?: number
  }
  debug?: boolean
}

export interface NormalizedOptions {
  enabled: boolean
  autoModelId: string
  strategy: Strategy
  strategies: Record<string, Strategy>
  routes: Record<string, RouteMap>
  fallback: string[]
  escalate: boolean
  classifierModel?: ModelRef
  timeoutMs: number
  debug: boolean
}

export const DEFAULT_AUTO_MODEL_ID = "auto"
export const DEFAULT_TIMEOUT_MS = 4000
export const DEFAULT_STRATEGY: Strategy = "session"

/** Used only when the user configures no routes at all: the free OpenCode models. */
const DEFAULT_ROUTES: Record<string, RawRouteMap> = {
  opencode: {
    strategy: "request",
    simple: "deepseek-v4.1-flash-free",
    standard: "mimo-v2.6-flash-free",
    complex: "longcat-2.5-free",
  },
}

/** Tried in order when every tier model for a provider has left the catalog. */
const DEFAULT_FALLBACK = [
  "deepseek-v4.1-flash-free",
  "mimo-v2.6-flash-free",
  "longcat-2.5-free",
  "hy4-flash-free",
  "flint-40b-free",
]

function readStrategy(value: unknown): Strategy | undefined {
  return value === "session" || value === "request" ? value : undefined
}

export function normalizeOptions(raw: unknown): NormalizedOptions {
  const options = (raw ?? {}) as RouterOptions
  const configured = options.routes && Object.keys(options.routes).length > 0
  const routes: Record<string, RouteMap> = {}
  const strategies: Record<string, Strategy> = {}

  for (const [providerID, map] of Object.entries(configured ? options.routes! : DEFAULT_ROUTES)) {
    if (!map || typeof map !== "object") continue
    const clean: RouteMap = {}
    for (const tier of ["simple", "standard", "complex"] as const) {
      const value = map[tier]
      if (typeof value === "string" && value.length > 0) clean[tier] = value
    }
    if (Object.keys(clean).length > 0) routes[providerID] = clean

    const strategy = readStrategy(map.strategy)
    if (strategy) strategies[providerID] = strategy
  }

  const model = options.classifier?.model
  const classifierModel =
    model && typeof model.providerID === "string" && typeof model.id === "string" ? model : undefined

  const fallback = Array.isArray(options.fallback)
    ? options.fallback.filter((id): id is string => typeof id === "string" && id.length > 0)
    : DEFAULT_FALLBACK

  return {
    enabled: options.enabled !== false,
    autoModelId: options.autoModelId ?? DEFAULT_AUTO_MODEL_ID,
    strategy: readStrategy(options.strategy) ?? DEFAULT_STRATEGY,
    strategies,
    routes,
    fallback,
    escalate: options.escalate !== false,
    classifierModel,
    timeoutMs: options.classifier?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    debug: options.debug === true,
  }
}

export function strategyFor(options: NormalizedOptions, providerID: string): Strategy {
  return options.strategies[providerID] ?? options.strategy
}

/**
 * Candidate model ids for a tier, most specific first. The caller picks the
 * first one the provider actually offers.
 */
export function candidateIds(
  routes: Record<string, RouteMap>,
  providerID: string,
  tier: Tier,
): string[] {
  const map = routes[providerID]
  if (!map) return []
  const ids: string[] = []
  for (const want of [tier, "standard", "simple", "complex"] as Tier[]) {
    const id = map[want]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function classifierPrompt(text: string, maxChars = 2000): string {
  const trimmed = text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text

  return [
    "Classify how hard this request is for a coding assistant.",
    "Answer with exactly one lowercase word and nothing else: simple, standard, or complex.",
    "",
    "simple — greetings, small talk, one-line answers, tiny edits, trivial lookups.",
    "standard — everyday feature work, small bug fixes, explaining code, routine refactors.",
    "complex — architecture, migrations, refactors across many files, hard debugging,",
    "research, performance work, financial modelling, trade-off analysis.",
    "",
    "Request:",
    '"""',
    trimmed,
    '"""',
    "",
    "Answer:",
  ].join("\n")
}

const TIER_WORDS: Tier[] = ["simple", "standard", "complex"]

export function parseTier(reply: string): Tier | undefined {
  const match = reply.toLowerCase().match(/\b(simple|standard|complex)\b/)
  if (!match) return undefined
  return TIER_WORDS.find((tier) => tier === match[1])
}
