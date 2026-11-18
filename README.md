# @southwood/opencode-auto

One **Auto** entry in the OpenCode model picker that picks the model per request: a cheap one for small talk, a solid one for everyday work, a strong one for architecture and hard debugging.

No proxy, no gateway, no extra accounts. It is a single OpenCode plugin built on the `experimental.model.resolve` hook.

```
simple    привет, как дела?              → glm-5.3          210₽
standard  добавь валидацию в форму       → gpt-6.2-sol      420₽
complex   спроектируй миграцию биллинга  → claude-opus-5-5  840₽
```

## Install

```sh
opencode plugin add @southwood/opencode-auto
```

Or from a GitHub checkout:

```sh
opencode plugin add github:YOUR_USER/opencode-auto
```

## Configure

Two steps. First, declare an `auto` model on every provider you want to route inside. Providers read this from your config, so the entry shows up in the picker under that provider.

```jsonc
// ~/.config/opencode/opencode.json
{
  "providers": {
    "proxyapi": {
      "models": {
        "auto": { "name": "Auto", "description": "Picks a model by task complexity" }
      }
    }
  }
}
```

Second, point the plugin at the models per tier:

```jsonc
{
  "plugins": [
    {
      "package": "@southwood/opencode-auto",
      "options": {
        "routes": {
          // Free models: switching costs latency only, so route on every request.
          "opencode": {
            "strategy": "request",
            "simple": "deepseek-v4.1-flash-free",
            "standard": "mimo-v2.6-flash-free",
            "complex": "longcat-2.5-free"
          },
          // Metered models: switching costs a cache miss, so pick once per session.
          "proxyapi": {
            "strategy": "session",
            "simple": "z-ai/glm-5.3",
            "standard": "openai/gpt-6.2-sol",
            "complex": "anthropic/claude-opus-5-5"
          }
        },
        "classifier": {
          "model": { "providerID": "opencode", "id": "deepseek-v4.1-flash-free" }
        }
      }
    }
  ]
}
```

Then pick **Auto** in the model picker. Any concrete model you select keeps working exactly as before — the router only touches requests made while `auto` is selected.

## How it decides

Heuristics run on every prompt, synchronously and for free:

| Signal | Weight |
|---|---|
| Length under 140 / 140–500 / 500–2000 / 2000+ | 0 / 2 / 3 / 4 |
| Code blocks: none / 1–2 / 3+ | 0 / 2 / 4 |
| Hard keywords (architecture, migration, refactor, prove, analyze, optimize, root cause, …) | +3 each, max +6 |
| Attached files: none / 1 / 2+ | 0 / 1 / 2 |
| Stack trace in the prompt | +6 |

```
score 0–1  → simple
score 2–5  → standard
score >= 6 → complex
```

If the result is genuinely ambiguous — a plain 140–600 character message with no code, files or keywords, or a score sitting on a tier boundary — **and** `classifier.model` is set, one tiny request goes to that model: "reply with one word: simple, standard or complex". Failures and timeouts fall back to the heuristic tier, never to an error.

The classifier is optional. Without `classifier.model` the plugin is pure heuristics and makes zero extra requests.

## Two strategies: per request or per session

`strategy` decides when the model is allowed to change. It is set globally and can be overridden inside any route map.

**`request`** — every message is classified and routed. Verified on a live session with an unchanged session id:

```
"привет, как дела?"                                  → deepseek-v4.1-flash-free
"Спланируй архитектуру … и миграцию данных …"        → longcat-2.5-free
"спасибо, коротко напомни что решили"                → deepseek-v4.1-flash-free
```

This is exactly how Cursor's router works: *"Cursor Router runs a classifier on each agent request and routes it based on task type and complexity."*

**`session`** — the tier is decided on your first message and sticks. Later messages never move it down, and only move it up on a hard signal (a hard keyword or a stack trace; length alone is not enough). Same session, same three messages:

```
"привет, как дела?"                                  → deepseek-v4.1-flash-free
"Спланируй архитектуру … и миграцию данных …"        → longcat-2.5-free
"спасибо, коротко напомни что решили"                → longcat-2.5-free
```

### Which one to pick

A model swap costs a prompt-cache miss on the entire conversation: the new model re-reads the whole history cold before answering. On a metered account that is real money, and on a long session it can cost more than simply staying on the stronger model.

- **Free models** (`opencode/*-free`): pay for nothing but latency, so `request` is the right default.
- **Metered models** on your own API key: the cache miss lands on your bill, so `session` is safer. This is also why OpenCode's docs tie encrypted compaction checkpoints to *"the same provider and model"* — a switch drops them.
- **A gateway provider** (one `providerID` fronting several vendors, such as ProxyAPI) can route across vendors per request, because OpenCode still sees a single provider. That is the closest thing to Cursor's setup; the cache argument is the only reason to hold back.

OpenCode itself has no rule against switching models mid-session — `/models` applies to the current session and does not rewrite your config. It is allowed, just not free.

## Which requests are routed

Only `primary` requests: the agent loop you actually talk to. Compaction, title generation and transient `generate` calls keep whatever model you configured for those agents — routing a title through Opus would be a waste.

## Limitations worth knowing

- **Same provider only.** `experimental.model.resolve` can only substitute a model of the provider the request already uses. A model from another provider is rejected as unavailable. That is why you declare `auto` per provider and why routing cannot jump from a free OpenCode model to a paid ProxyAPI one mid-session. Pick the provider first, then let Auto choose inside it.
- **Experimental API.** The hook is named `experimental.*`; a future OpenCode release may rename or change it. Pinned OpenCode versions keep working, and this package will follow the API.
- **Heuristics are heuristics.** A short but critical message can be misread as `simple`. The LLM fallback narrows that band; it does not eliminate it. Route complexity with your own `routes` if the defaults feel wrong.
- **The first message sets the tier.** Start a session with "привет" and Auto picks the cheap model for the whole session. If you know the work is heavy, say so in the first message, or override with `/models`.

## Options

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Set `false` to keep the plugin installed but inert |
| `autoModelId` | `"auto"` | Model id that triggers routing |
| `strategy` | `"session"` | `session` = pick once per session; `request` = classify every message. Can be overridden per provider inside its route map |
| `routes` | `{}` | `{ providerID: { strategy?, simple, standard, complex } }`; a missing tier falls back to `standard` |
| `escalate` | `true` | In `session` strategy, allow the tier to move up on a hard signal; never moves down |
| `classifier.model` | none | `{ providerID, id }` used only for ambiguous prompts |
| `classifier.timeoutMs` | `4000` | Classifier request deadline |
| `debug` | `false` | Log every decision to the server log |

## Troubleshooting

**Auto does not appear in the picker** — the `providers.<id>.models.auto` block is missing, or the provider id is wrong. `opencode models` prints every model the server sees; if `proxyapi/auto` is absent there, the config block is not being read.

**Everything routes to the same model** — that is a `routes` map with repeated ids, or a provider whose tier models are identical. Check with `"debug": true`.

**The first request after enabling lands on `standard`** — the tier is learned from your first prompt in a session. Sessions that were already running when the plugin loaded have no recorded tier yet.

**`Free usage limit reached`** — that is the OpenCode free tier's own quota, per model, not the plugin. Free limits are small and refill on a rolling basis, so a routed session can hit one mid-conversation while other free models still answer. Point the tiers at models that are actually alive for you, and check the current list with `opencode models`.

## License

MIT
