import { Plugin } from "@opencode/plugin"
import { classify, shouldEscalate, type Tier } from "./classify.ts"
import { classifierPrompt, normalizeOptions, parseTier, pickModel, strategyFor } from "./config.ts"

const DEFAULT_TIER: Tier = "standard"

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ])
}

export default Plugin.define({
  id: "southwood.opencode-auto",
  async setup(ctx: any) {
    const options = normalizeOptions(ctx.options)
    if (!options.enabled) return

    const debug = options.debug
      ? (...parts: unknown[]) => console.log("[opencode-auto]", ...parts)
      : () => {}

    // Tier chosen when the session started. Sticky: only ever moves up.
    const sessionTier = new Map<string, Tier>()
    // Tier of the most recent prompt. Used by the per-request strategy.
    const lastTier = new Map<string, Tier>()
    // Strategy of the provider this session runs on, learned at the first resolve.
    const strategyBySession = new Map<string, string>()

    async function askClassifier(text: string): Promise<Tier | undefined> {
      const generate = ctx.experimental?.generate?.text ?? ctx.generate?.text
      if (!generate || !options.classifierModel) return undefined
      try {
        const result = await withTimeout(
          generate({ model: options.classifierModel, prompt: classifierPrompt(text) }) as Promise<{
            text?: string
          }>,
          options.timeoutMs,
        )
        return parseTier(String(result?.text ?? ""))
      } catch (error) {
        debug("classifier failed, keeping heuristic tier", error)
        return undefined
      }
    }

    await ctx.session.hook("prompt", async (event: any) => {
      const sessionID = event?.sessionID ?? event?.session?.id
      if (!sessionID) return

      const text = String(event?.prompt?.text ?? "")
      const files = Array.isArray(event?.prompt?.files) ? event.prompt.files.length : 0
      const result = classify(text, files)
      const current = sessionTier.get(sessionID)
      const strategy = strategyBySession.get(sessionID)
      const escalating = current !== undefined && options.escalate && shouldEscalate(result, current)

      // The classifier costs one small request, so it only runs when its answer
      // will actually be used: session start, a per-request provider, or a
      // possible escalation.
      const needsClassifier =
        result.ambiguous && (current === undefined || strategy === "request" || escalating)

      let tier = result.tier
      if (needsClassifier) tier = (await askClassifier(text)) ?? tier

      lastTier.set(sessionID, tier)
      if (current === undefined || strategy === "request" || escalating) {
        sessionTier.set(sessionID, tier)
      }

      debug(`prompt ${sessionID} -> ${tier}`, {
        strategy: strategy ?? "unknown",
        current: current ?? "none",
        score: result.score,
        ambiguous: result.ambiguous,
        classified: needsClassifier,
      })
    })

    await ctx.session.hook("experimental.model.resolve", (event: any) => {
      if (event.kind !== "primary") return
      if (event.model.id !== options.autoModelId) return

      const sessionID = String(event.sessionID)
      const providerID = String(event.model.providerID)
      const strategy = strategyFor(options, providerID)
      strategyBySession.set(sessionID, strategy)

      const tier =
        (strategy === "request" ? lastTier.get(sessionID) : sessionTier.get(sessionID)) ?? DEFAULT_TIER
      const id = pickModel(options.routes, providerID, tier)
      if (!id) {
        debug(`no route for ${providerID}, keeping ${providerID}/${options.autoModelId}`)
        return
      }
      if (id === options.autoModelId) return

      event.model = { providerID, id }
      debug(`resolve ${sessionID} ${strategy} ${tier} -> ${providerID}/${id}`)
    })
  },
})
