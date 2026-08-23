# Choir — Design Brief for Antigravity

Use this as a design brief, not a spec to copy literally. Make deliberate choices for color, typography, and layout based on the rules below — don't default to generic SaaS/AI-app patterns. Before writing any code, produce a short design plan (palette as 4-6 named hex values, type pairing, layout concept, one signature element) and show it to me for approval before building.

## What Choir is (ground every decision in this)

Choir is a team chat app where a group of people and an AI model share context. Core mechanic: a **shared thread** everyone on the team sees, plus each person's own **multiple private threads** for solo exploration with the AI. People "post" chosen messages from private into shared when they're ready — like sharing a conclusion after thinking alone. The name "Choir" reflects this: individual voices (private threads) that contribute to one shared song (the shared thread).

## Hard rules — do not violate these

1. **Do not default to the current AI-app visual cliché**: warm cream background + high-contrast serif + terracotta/clay accent (~#D97757). This is the single most overused look in AI products right now and will read as generic, not distinctive.
2. **Do not default to indigo/purple gradients, glassy cards, or generic "AI product" iconography** (sparkles, robot heads, glowing orbs). Avoid these regardless of how tempting the default component library makes them.
3. **Do not use a near-black background + single neon accent** (acid-green/vermilion) as a shortcut to "looks premium" — also an overused default.
4. **The two thread types (shared vs. private) must be visually distinguishable at a glance**, without relying on text labels alone — through color weight, background treatment, or spatial treatment.
5. **Accessibility floor, non-negotiable**: visible keyboard focus states, responsive down to mobile width, respects `prefers-reduced-motion`, sufficient text contrast.

## Direction to explore (not prescriptive — use as inspiration, then make your own call)

- **Tone**: warm and human, not corporate/sterile. Choir is for small teams and friends working closely together, not enterprise software. Calm, confident, a little personality — not playful/gimmicky.
- **Metaphor space**: voice, sound, gathering, many-becoming-one. This can show up subtly (e.g., how a "typing/streaming" AI response indicator looks) without being literal or cheesy (no literal microphone icons, no music-note motifs).
- **Structural pattern**: the core layout is a sidebar (list of shared thread + named private threads) + one main thread view, with a toggleable drawer to peek at the shared thread while inside a private thread. Reference points worth knowing (for your own research, not to copy): Linear's sidebar restraint and single-accent color discipline; Discord's channel-list-to-single-active-view structure; Notion's warmth and use of whitespace; Figma's visual language for distinguishing "your active work" from shared/others' state.
- Feel free to deviate from all of the above if you land on something more specific and better-justified for this exact product.

## Specific interaction moments that need deliberate design treatment

1. **AI response streaming (in progress vs. finished)** — must be immediately obvious which state a message is in, especially since concurrent `@AI` mentions can produce multiple simultaneous streaming responses in the same shared thread. Each needs its own clear boundary.
2. **The shared-thread drawer, viewed from inside a private thread** — must read as clearly secondary/recessive to the private thread you're actively in. Never let it compete visually with the main view or cause confusion about which thread you're about to type into.
3. **"Post to shared" action** — this is the product's signature interaction and deserves a real moment: a visible, satisfying transition or confirmation when a private message moves into the shared thread. Don't let this happen silently.
4. **Messages shared from someone's private thread, once in the shared thread** — should be clearly marked as originating from private exploration (matches the spec's `[Shared from User's private thread]` labeling) without looking like a lesser or bolted-on message type.
5. **Empty states** — a brand-new project's shared thread, or a freshly created private thread, should feel like an invitation to start, not a blank error-adjacent void.

## Copy/voice rules

- Write from the user's side of the screen: name things by what people control, not backend concepts (e.g., "Share to team," not "Post to shared_thread").
- Active voice, plain verbs, sentence case. A button's action word should match the resulting confirmation (e.g., "Share" → "Shared").
- No apologetic or vague error copy. State what happened and what to do about it in the interface's own voice (e.g., "Shared AI is unavailable — ask the project owner to check their usage limits," already specified in the product spec — keep this tone consistent everywhere else).

## Process

1. Propose a design plan first (palette with named hex values, typography pairing with roles, layout concept, one signature element that embodies "Choir" specifically) — show it before building.
2. Critique your own plan against the hard rules above before proceeding — if any part of it resembles a generic default, revise it and note what changed.
3. Build one screen at a time (start with the main shared-thread view), so direction can be checked early rather than after the whole UI is built.
4. Use shadcn/ui or Radix primitives as a base for accessibility and consistency, styled to match the chosen design plan rather than left as defaults.
