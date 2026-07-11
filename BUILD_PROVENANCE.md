# SOL//SHIFT — Build Provenance

## Initial instruction

The project began from one detailed user-provided objective: autonomously design, implement, test, polish, and ship an original browser game named SOL//SHIFT, with the hook “Survive 60 seconds while the laws of physics mutate around you.” The objective required six ten-second laws, one universal attraction/charge/release interaction, desktop and mobile support, procedural audio, deterministic Daily and Endless modes, challenge links, result artifacts, Creator Mode, direct browser playtesting, performance work, tests, launch documentation, and honest provenance.

The full supplied objective remains available in the original Codex task attachment. This document summarizes provenance; it does not pretend the build happened without iteration.

## Starting state

The workspace was an empty Git repository. The Sites initializer created a vinext/Next/React/Cloudflare Worker-compatible shell. That generated shell contained only a loading skeleton, template metadata, optional database examples, and two starter assertions. It contained no game code, game design, visual system, simulation, audio, sharing, or relevant gameplay tests.

No human-authored game code or visual assets were present.

## Autonomous decisions

Major decisions made during the build include:

1. **Retain SOL//SHIFT after a seven-lens concept tournament.** Five lenses retained it; two preferred narrower concepts. The dissent was incorporated as hard scope discipline rather than ignored.
2. **Make visible captured mass the toy.** Hold curves and captures; charge stores visible tension; release converts that exact arrangement into motion and recoil.
3. **Treat touch as canonical.** Press–drag–release is intentional, with the steering target lifted above a finger. Mouse and keyboard preserve the same rhythm.
4. **Separate deterministic simulation from presentation.** Gameplay advances at a fixed 60 Hz, with exactly 600 ticks per law and 3,600 per Daily run.
5. **Use a hybrid procedural renderer.** A small custom WebGL field shader supplies depth and law colour; Canvas2D supplies crisp gameplay silhouettes and a complete fallback.
6. **Use browser-native procedural audio.** A single gesture-created Web Audio graph supplies the evolving score and all feedback without licensed samples.
7. **Keep the product anonymous and local-first.** Daily seeds, challenge URLs, results, local bests, and result cards need no server.
8. **Preserve causal readability over effect count.** The Core identity, object roles, field lines, trails, and law-change wave remain invariant.

## Major implementation passes

This count describes substantial internal passes, not individual file saves.

1. **Environment and concept pass** — repository inspection, seven independent concept evaluations, rubric comparison, retained-concept constraints, and architecture.
2. **Vertical-slice pass** — fixed-step Core movement, visible attraction/capture, charge, Nova, gates, ORBIT, FRACTURE, stability, scoring, renderer, audio graph, menu, HUD, and deterministic tests.
3. **First rendered playtest pass** — direct in-app browser play, screenshots, and correction of two issues invisible to compilation: audio unlock blocking game start, and focus scrolling the arena/HUD.
4. **Six-law pass** — FLOW, ECHO, SWARM, NOVA, isolated phase streams, global object budgets, final difficulty, and deeper deterministic/stress coverage.
5. **Product-loop pass** — Daily/Endless state, challenge protocol, safe storage, archetypes, Shift Signatures, result cards, progressive sharing, and Creator Mode.
6. **Responsive/accessibility pass** — mobile viewports, safe areas, touch occlusion, orientation/visibility recovery, reduced motion, contrast, focus, mute, and failure fallbacks.
7. **Adversarial and performance pass** — repeated runs, resize and invalid-state tests, console inspection, allocation review, adaptive quality, object/memory high-water checks, and critical corrections. This pass capped presentation at 60 Hz on high-refresh displays, removed deep world cloning from the render loop, throttled reactive audio updates, bounded canvas backing storage, and made adaptive tiers reduce bloom, shader layers, particles, trails, and fallback path complexity—not only resolution.
8. **Launch pass** — clean production validation, desktop and phone screenshots, bundle measurements, result/share fallbacks, documentation, launch sequence, conservative benchmark, and Sites hosting handoff.
9. **Clarity and payoff pass** — a second product audit exposed that the premise was clearer than the scoring loop. The run now waits for first input, teaches pull → loaded Nova → bank in the arena, exposes banked and at-risk Flux, gives every law an actionable directive, differentiates empty and loaded releases in rendering and audio, adds event-level score feedback, and turns results into specific retry coaching.

The final build therefore used **nine major implementation passes**. Within those passes, many smaller tuning and correction cycles occurred.

## Parallel studio roles

Independent internal agents were used as Viral Concept Director, Casual/Replayability Designer, Experimental Interaction Designer, Premium Visual Director, Technical Feasibility Lead, Social/X Growth Designer, Critical Reviewer, Gameplay Engineer, Graphics Engineer, Audio Designer, Product/Growth Designer, and simulation auditor. The primary agent maintained the shared direction and integrated their work.

## External libraries and assets

- Runtime framework/build: React, Next-compatible vinext, Vite, and the Cloudflare Vite plugin supplied by the initialized Sites shell.
- No physics engine, game engine, rendering framework, UI component library, analytics SDK, authentication SDK, external font request, stock illustration, music file, sound sample, or paid runtime API is used by the game.
- Typography uses a system-font stack, so the player does not download a font payload.
- Game graphics, particles, trails, phase fields, result cards, and audio are generated procedurally in the browser.
- `public/og.png` is a 1,200×630 launch image generated during this build with OpenAI image generation from a bespoke SOL//SHIFT art-direction prompt. `public/favicon.png` is a 128×128 crop derived from that generated image. These are the only non-procedural visual assets shipped with the game.

## Iteration evidence

Examples of changes made because the rendered product was tested rather than merely compiled:

- The game originally awaited `AudioContext.resume()` before starting. Synthetic browser gestures exposed that this promise can remain pending; audio unlock is now best-effort and never delays play.
- The animated grain layer originally made the fixed arena a scroll container. Focusing a menu/pause button moved the HUD hundreds of pixels offscreen; the arena now uses clipped overflow and a bounded grain layer.
- The first HUD displayed the raw chain count as `×0.0`; integration clarified the scoring convention and now displays a meaningful multiplier beginning at `×1.0`.
- A performance audit found that high-refresh displays could render above the intended cadence and that each render cloned all entities and trail points. The frame loop now presents at a 60 Hz ceiling while simulation remains fixed-step, and the renderer consumes a synchronous live view while retained test snapshots remain detached.
- The first adaptive-quality version reduced only backing resolution. The final version also removes bloom, lowers field-shader star layers, shortens trails, reduces particles and fallback geometry, and constrains each canvas to a 3.2-million-pixel backing budget.
- Clipboard APIs can remain pending in constrained browsers. Copy now has a short timeout and a textarea fallback, so the result panel cannot become stuck waiting on the platform.
- A post-launch review found that charge, captured mass, banked score, and at-risk Flux were simulated but under-explained. The clarity pass surfaced those values, stopped dismissing guidance on the first pointer press, reserved major audiovisual impact for loaded Novas and chains, and made a collision's lost Flux explicit.

## Human-authored code

None was supplied. All repository game code, tests, copy, shaders, procedural sound design, UI, and documentation were produced during this task. The user provided the creative/quality objective and the SOL//SHIFT starting direction.

## Final validation snapshot

- `npm test` passes **48/48 named checks**: 46 deterministic/protocol/game-feel/UI checks and 2 rendered-entry checks.
- TypeScript validation and ESLint complete without errors.
- The production dependency audit (`npm audit --omit=dev`) reports zero known vulnerabilities; Next's nested PostCSS is pinned to a compatible patched 8.5.x release through an npm override.
- The final production client artifact set is approximately **436 KiB raw / 132 KiB gzip**, with no webfont payload.
- The 100-seed deterministic stress stream observed a maximum of **86 live simulation entities** against the hard cap of 112; cosmetic particles, pulses, trails, ECHO history, audio voices, and canvas backing storage are separately bounded.
- Direct browser QA covered the complete menu/play/pause/result loop, challenge auto-start, result fallbacks, Creator cues and framing, preference persistence, and layouts at desktop, 390×844, and 320×568.

## Known limitations

This section is intentionally conservative and is finalized after the last browser/performance audit. Potential platform limitations include:

- Native file sharing varies by browser; copy and download remain universal fallbacks.
- Browser autoplay policies can keep audio silent until a valid user gesture, but cannot block play.
- Canvas-generated image downloading on iOS may open a preview rather than a traditional download.
- Performance depends on device/GPU capability; adaptive quality reduces cosmetics but never seeded hazards. Desktop/phone targets were checked in an automated Chromium environment, but no claim is made for a laboratory-grade trace on every physical device.
- Daily and challenge generation is seed-deterministic for a given arena geometry, but the live viewport defines that geometry. Portrait and landscape players receive the same spawn stream and laws, not a mathematically identical playfield or directly normalized score environment.
- Local scores are personal, not server-verified global rankings.
