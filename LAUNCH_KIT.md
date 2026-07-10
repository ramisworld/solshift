# SOL//SHIFT — Launch Kit

## One-sentence hook

**Survive 60 seconds while the laws of physics mutate around you.**

Alternative launch framing: **A tiny artificial sun. Six laws of physics. One minute to survive.**

## Concise description

SOL//SHIFT is a touch-first physics survival game built for the browser. Steer a luminous Core, hold to capture matter and tighten its orbit, then release the exact configuration as a Nova wave. Every ten seconds the same world mutates—from orbital mechanics to fracture, flow, hostile memory, emergent swarms, and a final collapse.

## Controls

- Move with pointer, touch, WASD, or arrow keys.
- Hold primary input or Space to attract matter and build visible tension.
- Release to fire Nova, break vulnerable hazards, bank Flux, and recoil.
- `P`/`Escape` pauses; `M` toggles sound.

## Recommended public URL structure

- Canonical game: use the deployed HTTPS production origin with `/` as the only path.
- Daily challenge: append `?v=1&mode=daily&seed=…&target=…&archetype=…` to that origin.
- Endless challenge: use the same validated format with `mode=endless`.
- Creator Mode should be entered from the clearly separated menu control; public challenge URLs never enable or inherit Creator state.

Use one canonical origin in launch posts. Redirect alternate domains to it without changing the validated challenge query.

## Exact 15-second recording sequence

Use Creator Mode, showcase seed, auto-pilot where noted, full motion, 1× playback, clean HUD, and a native 16:9 frame. Capture authentic simulation output only.

| Time | Shot |
| --- | --- |
| 0.0–1.8s | Begin on ORBIT already in motion. Sweep the Core across three motes while holding; their paths visibly curve and compress into the halo. |
| 1.8–4.3s | Release near a prepared FRACTURE cluster. Show the clean Nova edge, recoil, first heavy break, delayed secondary break, and multiplier response. |
| 4.3–6.2s | Use the `FLOW TRANSITION` Creator scenario, which starts late in FRACTURE and then crosses the ordinary simulation boundary. Keep camera and Core continuous while the transition wave turns shards into FLOW ribbons. |
| 6.2–8.7s | Jump to ECHO or SWARM. Use a short steering feint so a dangerous remembered path crosses behind the Core, or split a predictive swarm formation with one Nova. |
| 8.7–12.2s | Use `FINAL NOVA`, which starts at the authentic five-second mark of the final law. Let matter collapse inward, hold through the dangerous contraction, then release the dominant final wave. |
| 12.2–15.0s | Cut only after the authentic run resolves. Hold the result screen long enough to read the score, archetype, Shift Signature, and challenge action. |

Recording note: the jumps between showcase scenarios are Creator Mode recording aids. They reposition the ordinary deterministic simulation clock and use standard player input; they do not grant invulnerability, alter scoring, or substitute bespoke effects. The `FLOW TRANSITION` cue crosses a real phase boundary. Do not imply that the edited 15-second clip is one uncut 60-second run.

## Exact 30-second alternative

| Time | Shot |
| --- | --- |
| 0–3s | Menu lockup and immediate Daily entry; keep the transition under one second. |
| 3–7s | ORBIT capture, gate slingshot, Nova recoil. |
| 7–12s | FRACTURE cluster with a clear three-step chain. |
| 12–16s | Visible transition into FLOW; bend one current and ride the opening created by Nova. |
| 16–20s | ECHO shows the game replaying an earlier route as danger. |
| 20–24s | SWARM predicts, reforms, and breaks under a timed release. |
| 24–28s | NOVA collapse and final release. |
| 28–30s | Result card, Shift Signature, and challenge link. |

## Framing

### Landscape

- Record at 1920×1080 or 2560×1440.
- Keep the Core inside the central 60% so 16:9 platform crops preserve it.
- Use clean HUD for the 15-second hero clip; full HUD for the 30-second proof clip.
- Do not zoom after capture. The Core’s screen-space identity and the law-change wave provide the composition.

### Vertical

- Record at 1080×1920.
- Keep essential action between 15% and 78% of frame height, clear of platform captions and controls.
- The portrait layout already places score/time at the top and utilities at the lower-right safe area.
- Use large fracture shapes, the Echo head, or the swarm wedge; thin decorative trails compress poorly.

## Strongest thumbnail

The white-hot Core at the centre of a just-released Nova, with three large cyan crystal plates caught at different stages of fracture and the amber transition ring entering the frame. The Core must remain the highest-contrast object. Use no headline; a small `SOL//SHIFT` wordmark and `06 LAWS / 60 SEC` label are sufficient.

## X launch-post options

### Option 1 — visible result first

> A tiny artificial sun. Six laws of physics. 60 seconds to survive.
>
> SOL//SHIFT is playable in the browser—no login, no install. Every Daily run is the same seeded universe, and every result becomes a challenge.
>
> [video]

### Option 2 — model/build framing

> GPT-5.6 Sol Ultra built a game where the laws of physics change every 10 seconds.
>
> It designed the interaction, deterministic simulation, custom rendering, procedural audio, mobile controls, tests, Creator Mode, and share loop—then played the result and fixed what broke.
>
> [video]

### Option 3 — challenge framing

> Today’s Daily seed is shared by everyone.
>
> Capture matter. Hold the tension. Release Nova. Survive all six laws.
>
> My Shift Signature: `O·F·W·E·S·N`
> Beat this run: [challenge link]

## Technical post for engineers

> SOL//SHIFT is a deterministic browser game, not a pre-rendered demo: fixed 60 Hz simulation, isolated seeded streams per law, pooled entities, analytic flow fields, path-replay hazards, two-pass swarm updates, a small WebGL field shader with Canvas2D fallback, and one gesture-gated procedural Web Audio graph.
>
> React handles the product shell—not the frame loop. Adaptive quality changes only cosmetics, so seeded hazards never change with visual quality. Tests step full 3,600-tick runs without waiting a minute.
>
> Build notes + source: [repository link]

## Game-first post

> SOL//SHIFT is out.
>
> You control a tiny sun. Everything you pull in becomes ammunition—but holding longer also pulls danger closer. Every 10 seconds the universe changes its rules.
>
> One minute. Immediate retry. Same Daily seed for everyone.
>
> [video]

## Suggested playable-link reply

> Play today’s Daily Shift here: [canonical link]
>
> Works with touch, mouse, or keyboard. Sound begins after your first gesture. No login or install.

## Suggested build-process follow-up

> This was not “one prompt, zero iteration.” One ambitious instruction started the build, then the model ran a seven-lens concept tournament, built an Orbit/Fracture slice, opened it in the browser, found runtime bugs the compiler missed, expanded the remaining laws, stress-tested deterministic runs, and performed visual/mobile/performance correction passes.
>
> Honest provenance and the conservative benchmark are in the repo: [link]

## Why this is a serious model benchmark

The benchmark is the integrated product, not the quantity of generated code. A credible result must keep one interaction coherent across six simulations; maintain deterministic challenge fairness; render a premium, readable spectacle on desktop and mobile; synthesize synchronized audio; recover from browser constraints; generate and share result artifacts; test time-dependent systems; profile repeated runs; and make product decisions when technical breadth conflicts with fun. Each claim has observable repository or runtime evidence and a documented weakness where the result remains imperfect.

## Honest iteration wording

Recommended wording:

> One detailed objective initiated the project. The model then worked autonomously through multiple internal roles and major passes: concept stress test, vertical slice, rendered playtest, six-law integration, social/product loop, responsive and adversarial QA, performance polish, and launch validation. No human-authored game code or external game assets were supplied.

Avoid “zero iteration,” “single pass,” “perfect first try,” “worldwide leaderboard,” or any claim that local scores are server-verified.
