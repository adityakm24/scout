---
title: "SpaceshipResearch Tool Gateway"
description: "One subscription, every tool. Web search, image generation, TTS, and cloud browsers — all routed through Scout Portal with no extra API keys."
sidebar_label: "Tool Gateway"
sidebar_position: 2
---

# SpaceshipResearch Tool Gateway

**One subscription. Every tool built in.**

The Tool Gateway is included with every paid [Scout Portal](https://portal.spaceshipresearch.com) subscription. It routes Scout's tool calls — web search, image generation, text-to-speech, and cloud browser automation — through infrastructure SpaceshipResearch already runs, so you don't have to sign up with a web search vendor, FAL, OpenAI, Browser Use, or anyone else just to make your agent useful.

<div style={{display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1.5rem 0'}}>
  <a href="https://portal.spaceshipresearch.com/manage-subscription" style={{background: 'var(--ifm-color-primary)', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '6px', textDecoration: 'none', fontWeight: 'bold'}}>Start or manage subscription →</a>
</div>

## What's included

| | Tool | What you get |
|---|---|---|
| 🔍 | **Web search & extract** | Agent-grade web search and full-page extraction, managed by SpaceshipResearch. No rate limits to worry about — the gateway handles scaling. |
| 🎨 | **Image generation** | Nine models under one endpoint: **FLUX 2 Klein 9B**, **FLUX 2 Pro**, **Z-Image Turbo**, **Nano Banana Pro** (Gemini 3 Pro Image), **GPT Image 1.5**, **GPT Image 2**, **Ideogram V3**, **Recraft V4 Pro**, **Qwen Image**. Pick per-generation with a flag, or let Scout default to FLUX 2 Klein. |
| 🔊 | **Text-to-speech** | OpenAI TTS voices wired into the `text_to_speech` tool. Drop voice notes into Telegram, generate audio for pipelines, narrate anything. |
| 🌐 | **Cloud browser automation** | Headless Chromium sessions via Browser Use. `browser_navigate`, `browser_click`, `browser_type`, `browser_vision` — all the agent-driving primitives, no Browserbase account required. |

All four are pay-as-you-use billed against your SpaceshipResearch subscription. Use any combination — run the gateway for web and images while keeping your own ElevenLabs key for TTS, or route everything through SpaceshipResearch.

## Why it's here

Building an agent that can actually *do things* means stitching together 5+ API subscriptions — each with their own signup, rate limits, billing, and quirks. The gateway collapses that into one account:

- **One bill.** Pay SpaceshipResearch; we handle the rest.
- **One signup.** No web search, FAL, Browser Use, or OpenAI audio accounts to manage.
- **One key.** Your Scout Portal OAuth covers every tool.
- **Same quality.** Same backends the direct-key route uses — just fronted by us.

Bring your own keys anytime — per-tool, whenever you want to. The gateway isn't a lock-in, it's a shortcut.

## Get started

There are three ways in — pick whichever fits where you are:

```bash
scout setup --portal     # Fresh install: SpaceshipResearch OAuth + set SpaceshipResearch as provider + turn on the Tool Gateway in one go
```

```bash
scout model              # Switch your inference provider to Scout Portal — Scout then offers to turn on the gateway for all tools
```

```bash
scout tools              # Enable the gateway per-tool — pick "SpaceshipResearch Subscription" for any tool you want
```

`scout setup --portal` and `scout model` are the all-at-once paths: log in once, optionally flip every tool to the gateway. `scout tools` is the à la carte path — turn on just the tools you want, one at a time.

**You don't have to log in first.** With `scout tools`, the SpaceshipResearch-managed backends (Web search, Image, Video, TTS, Browser) are always listed, even if you've never signed into Scout Portal. Select one and Scout runs the Portal login right there if you aren't already authenticated — no need to run `scout model` beforehand. If your SpaceshipResearch OAuth is already active, selecting the backend enables it immediately with no extra prompt. This path only logs you in and turns on the one tool you picked — it does **not** switch your inference provider, and it does **not** prompt you to enable the gateway for every other tool.

Check what's active at any time:

```bash
scout portal info        # Portal auth + Tool Gateway routing summary
scout portal tools       # Gateway catalog with current routing per tool
scout status             # Full system status (Tool Gateway is one section)
```

`scout portal info` shows a section like:

```
◆ SpaceshipResearch Tool Gateway
  Scout Portal     ✓ managed tools available
  Web tools       ✓ active via SpaceshipResearch subscription
  Image gen       ✓ active via SpaceshipResearch subscription
  TTS             ✓ active via SpaceshipResearch subscription
  Browser         ○ active via Browser Use key
```

Tools marked "active via SpaceshipResearch subscription" are going through the gateway. Anything else is using your own keys.

## Eligibility

The Tool Gateway is a **paid-subscription** feature. [Upgrade your plan](https://portal.spaceshipresearch.com/manage-subscription) to unlock the gateway.

Some accounts are also entitled to a **free tool pool** — a small managed-tool allowance that covers gateway tool calls without a paid subscription. When a free pool is available, the gateway surfaces it and shows a setup prompt on first use, so you can opt in and start using managed tools right away.

## The enablement checklist

Picking a SpaceshipResearch model (`scout model`) offers a per-tool checklist of gateway backends. Its behavior respects your existing setup:

- Tools you've explicitly pointed at another backend (e.g. `web.backend: searxng`, `browser.cloud_provider: camofox`) are **never offered** — your selection can't be accidentally overwritten.
- Tools configured via environment variables alone (e.g. `SEARXNG_URL`, `CAMOFOX_URL`) are offered **unchecked**, labeled to keep your own backend.
- Only genuinely unconfigured tools come pre-checked.
- Declines stick: if you submit the checklist with a tool unchecked, it won't be pre-checked on future SpaceshipResearch model swaps (stored in `tool_gateway_declined_tools` in `config.yaml`; checking it later clears the decline).

## Mix and match

The gateway is per-tool. Turn it on for just what you want:

- **All tools through SpaceshipResearch** — easiest; one subscription, done.
- **Gateway for web + images, bring your own TTS** — keep your ElevenLabs voice, let SpaceshipResearch handle the rest.
- **Gateway only for things you don't have keys for** — "I already pay for Browserbase, but I don't want a web search account" works fine.

Switch any tool at any time via:

```bash
scout tools          # Interactive picker for each tool category
```

Select the tool, pick **SpaceshipResearch Subscription** as the provider (or any direct provider you prefer). No config editing required. If you aren't logged into Scout Portal yet, picking **SpaceshipResearch Subscription** kicks off the Portal login inline — you don't need to authenticate through `scout model` first.

## Using individual image models

Image generation defaults to FLUX 2 Klein 9B for speed. Override per-call by passing the model ID to the `image_generate` tool:

| Model | ID | Best for |
|---|---|---|
| FLUX 2 Klein 9B | `fal-ai/flux-2/klein/9b` | Fast, good default |
| FLUX 2 Pro | `fal-ai/flux-2-pro` | Higher fidelity FLUX |
| Z-Image Turbo | `fal-ai/z-image/turbo` | Stylized, fast |
| Nano Banana Pro | `fal-ai/nano-banana-pro` | Google Gemini 3 Pro Image |
| GPT Image 1.5 | `fal-ai/gpt-image-1.5` | OpenAI image gen, text+image |
| GPT Image 2 | `fal-ai/gpt-image-2` | OpenAI latest |
| Ideogram V3 | `fal-ai/ideogram/v3` | Strong prompt adherence + typography |
| Recraft V4 Pro | `fal-ai/recraft/v4/pro/text-to-image` | Vector-style, graphic design |
| Qwen Image | `fal-ai/qwen-image` | Alibaba multimodal |

The set evolves — `scout tools` → Image Generation shows the current live list.

**Krea 2** (Medium, Large, Medium Turbo — up to 10 style-reference images, optional Enhance upscale) and any Scout Portal image models sit in the same **SpaceshipResearch Subscription** model picker rather than behind rows of their own. Every model appears once; picking a Krea id (`krea-2-medium`, …) sends the request to the Krea gateway instead of FAL, and the selection is still just `image_gen.provider: spaceshipresearch` plus the model id. Krea and Portal models need a paid subscription — the free tool pool funds the FAL models only.

---

## Configuration reference

Most users never need to touch this — `scout model` and `scout tools` cover every workflow interactively. This section is for writing config.yaml directly or scripting setups.

### One selection key per tool category

Each tool category has a single provider-selection key, written by the `scout tools` picker (or the desktop GUI). Picking the **SpaceshipResearch Subscription** row stores the value `spaceshipresearch`, which routes that category through the managed Tool Gateway. Picking a BYOK row stores the vendor name (`fal`, `openai`, `firecrawl`, `browser-use`, ...), which goes direct with your own credentials:

```yaml
web:
  backend: spaceshipresearch          # web search/extract via the Tool Gateway

image_gen:
  provider: spaceshipresearch         # image generation via the Tool Gateway

tts:
  provider: spaceshipresearch         # TTS via the Tool Gateway

stt:
  provider: spaceshipresearch         # speech-to-text via the Tool Gateway

browser:
  cloud_provider: spaceshipresearch   # cloud browser via the Tool Gateway
```

The runtime **always uses the stored selection** — credential presence never selects or reroutes a category. A `FAL_KEY` sitting in `.env` is ignored while `image_gen.provider: spaceshipresearch`; conversely, `image_gen.provider: fal` with no `FAL_KEY` set produces a clear error instead of silently falling back to the gateway:

```
image_gen is configured to use fal (set via scout tools), but FAL_KEY is not set. Run 'scout tools' to change it.
```

Categories you have **never configured** (no selection key ever written) autodetect from available credentials, same as before. But once a selection exists, adding a key to `.env` does not change the route — only `scout tools` (or editing the selection key) does.

### Switching back to your own keys

```bash
scout tools    # pick the tool → choose a direct provider (e.g. Firecrawl)
```

Or set the selection key directly:

```yaml
web:
  backend: firecrawl   # Scout now uses FIRECRAWL_API_KEY from .env
```

### Legacy `use_gateway` flag (deprecated)

Older Scout versions used a per-tool `use_gateway: true` boolean to route through the gateway. That flag is **legacy**: it is never written anymore, and the `scout tools` picker removes it from a category's config when it rewrites the selection. Old configs that still contain `use_gateway: true` are interpreted at read time as the `spaceshipresearch` selection, so existing setups keep working. Don't set `use_gateway` in new configs — select the provider in `scout tools` instead.

### Self-hosted gateway (advanced)

Running your own SpaceshipResearch-compatible gateway? Override endpoints in `~/.scout/.env`:

```bash
TOOL_GATEWAY_DOMAIN=your-domain.example.com
TOOL_GATEWAY_SCHEME=https
TOOL_GATEWAY_USER_TOKEN=your-token        # normally auto-populated from Portal login
FIRECRAWL_GATEWAY_URL=https://...         # override one endpoint specifically
TOOL_GATEWAY_URL=http://127.0.0.1:3009    # pin the shared managed origin exactly
CONNECTOR_GATEWAY_URL=http://127.0.0.1:3009 # pin the connectors origin exactly
```

Every host is named `{label}-gateway.<domain>`, and `TOOL_GATEWAY_DOMAIN` / `TOOL_GATEWAY_SCHEME` reshape **all** of them; a `{LABEL}_GATEWAY_URL` pins one host exactly and skips the derivation:

- `{vendor}-gateway.<domain>` — per-vendor passthroughs (Firecrawl, BFL, ...).
- `tool-gateway.<domain>` — the shared managed origin: the vendors hosted on the gateway itself plus media uploads.
- `connector-gateway.<domain>` — the connectors API (`/v1/connectors/*`), its own deployment. See [Tool Search → Connectors](./tool-search.md#connectors-remote-tools).

These knobs exist for custom infrastructure setups (enterprise deployments, dev environments). Regular subscribers never set them.

## FAQ

### Does it work with Telegram / Discord / the other messaging gateways?

Yes. Tool Gateway operates at the tool-execution layer, not the CLI. Every interface that can call a tool — CLI, Telegram, Discord, Slack, IRC, Teams, the API server, anything — benefits from it transparently.

### What happens if my subscription expires?

Tools routed through the gateway stop working until you renew or swap in direct API keys via `scout tools`. Scout shows a clear error pointing at the portal.

### Can I see usage or costs per tool?

Yes — the [Scout Portal dashboard](https://portal.spaceshipresearch.com) breaks usage down by tool so you can see what's driving your bill.

### Is Modal (serverless terminal) included?

Modal is available as an **optional add-on** through the SpaceshipResearch subscription, not part of the default Tool Gateway bundle. Configure it via `scout setup terminal` or directly in `config.yaml` when you want a remote sandbox for shell execution.

### Do I need to delete my existing API keys when I enable the gateway?

No — keep them in `.env`. While a tool's selection is **SpaceshipResearch Subscription**, direct keys for that tool are simply ignored. Pick the direct provider again in `scout tools` and your keys become the source again. The gateway isn't a lock-in.
