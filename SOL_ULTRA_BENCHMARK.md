# SOL//SHIFT — Conservative Sol Ultra Benchmark

## Scope and scoring method

This is a repository-backed assessment of the completed SOL//SHIFT build, not a claim about the model in isolation. Each of the 16 required categories is scored independently on a 0–10 scale and given equal weight. The overall score is the arithmetic mean, rounded to one decimal place.

The anchors used here are deliberately strict:

- **5** — a functional but partial attempt.
- **7** — a credible delivery with material gaps.
- **8** — a polished, integrated result with good observable evidence.
- **9** — exceptional work supported by broad, independent validation.
- **10** — effectively complete and independently verified across production conditions.

Repository code, automated tests, build configuration, and documented browser-playtest corrections count as evidence. Design intent alone does not. No category receives a 9 because the project has not had independent player studies, a broad physical-device matrix, production traffic, or long-running telemetry. Scores also do not assume that a feature is flawless merely because a build or unit test passes.

## 1. Creative originality

- **Attempted:** Turn one hold/release interaction into six connected physical laws, while establishing an original artificial-sun identity and avoiding resemblance to a familiar single-mechanic arcade clone.
- **Successfully delivered:** The visible capture → tension → release toy remains legible while ORBIT, FRACTURE, FLOW, ECHO, SWARM, and NOVA change the physical and material context. The white-hot Core, restrained spectral palette, law-change wave, and Shift Signature form a coherent product identity.
- **Repository evidence:** The seven-lens concept tournament and retained-concept rationale are recorded in `DESIGN_DECISIONS.md`; law-specific mechanics live in `app/game/simulation.ts`; phase material languages, Core rendering, field shader, transitions, trails, and effects live in `app/game/renderer.ts`; the product language is consistently used by `app/game/SolShiftGame.tsx` and `app/globals.css`.
- **Remaining weaknesses:** Attraction, bullet-avoidance, chain reactions, and survival scoring are familiar ingredients even though their combination is distinctive. Originality has been critically reviewed internally, but not tested with a large external audience; some spectators may initially read the later phases as visual variants before understanding their mechanical differences.
- **Score: 8.4/10.** The game has a defensible, cohesive identity and an unusual six-law structure, but the score stops below exceptional without independent comparison and player-recognition data.

## 2. Gameplay coherence

- **Attempted:** Keep steering, holding, visible charging, and releasing meaningful across six laws; make the first interaction understandable quickly; reward timing and spatial judgment rather than passive holding.
- **Successfully delivered:** Mouse, touch, and keyboard feed the same target/charge/release state. Captured mass becomes a configuration-dependent Nova; holding increases both opportunity and exposure. Phase transitions preserve the Core, momentum, controls, metrics, and arena instead of loading separate minigames. Failure, completion, immediate retry, Daily, and escalating Endless flows share the same rules.
- **Repository evidence:** `app/game/simulation.ts` implements input-edge latching, movement, capture, recoil, stability, combo, gates, near misses, phase scoring, failure, and Endless cycling. `tests/simulation.test.ts` verifies input transitions, capture/release scoring, exact phase boundaries, staged difficulty, normal idle failure, Daily completion, and harder Endless cycles. `DESIGN_DECISIONS.md` documents the common physical invariant.
- **Remaining weaknesses:** The repository proves deterministic behavior, not subjective fun or optimal tuning. There is no independent usability study, retention cohort, or blind playtest record. Six rule changes in one minute still create a comprehension burden, especially for a first run.
- **Score: 8.0/10.** The rules form a real, playable whole rather than disconnected effects, but feel and long-term replay value need outside players to validate them.

## 3. Codebase architecture

- **Attempted:** Separate deterministic gameplay from presentation, audio, product protocol, share-card generation, and React UI; keep React out of the frame-by-frame simulation path.
- **Successfully delivered:** The game uses a fixed-step simulation, a hybrid renderer, one procedural-audio engine, a validated storage/challenge protocol, an isolated result-card module, and a DOM interface shell. Gameplay randomness is separate from cosmetic randomness, and render-quality changes do not affect seeded simulation state.
- **Repository evidence:** The main boundaries are `app/game/simulation.ts`, `renderer.ts`, `audio.ts`, `protocol.ts`, `resultCard.ts`, `types.ts`, and `SolShiftGame.tsx`. `README.md` explains ownership, and `tests/simulation.test.ts` explicitly verifies that diagnostic snapshots detach data while hot render snapshots reuse live world storage.
- **Remaining weaknesses:** `simulation.ts` and `renderer.ts` are large modules with many phase-specific branches; further growth would justify smaller law/render strategy modules. There is no formal schema migration framework for stored records, and integration still depends on a sizeable imperative component in `SolShiftGame.tsx`.
- **Score: 8.6/10.** The architecture is unusually disciplined for a compact browser game and protects determinism and frame-loop performance, though some modules are approaching maintainability limits.

## 4. Long-horizon execution

- **Attempted:** Carry one ambitious instruction through concept selection, vertical slice, six-law implementation, product loops, audio, accessibility, adversarial QA, performance correction, documentation, and production configuration.
- **Successfully delivered:** The repository contains the complete game system and all requested launch documents rather than a concept or isolated demo. Important work was sequenced: the common toy and ORBIT/FRACTURE slice preceded expansion; rendered playtesting exposed runtime problems; later passes added distribution and reliability systems.
- **Repository evidence:** `BUILD_PROVENANCE.md` records eight major implementation passes and the parallel studio roles; `DESIGN_DECISIONS.md` records the pre-build tournament and scope gates; the source, tests, public assets, Worker entry, and `.openai/hosting.json` show the work crossing design, implementation, QA, and delivery concerns.
- **Remaining weaknesses:** The process account is authored inside the same project and is not an independent audit log. The current repository has limited historical commit evidence, so iteration must be evaluated from the final artifacts and documented corrections rather than a granular public change history.
- **Score: 8.7/10.** The breadth is integrated and visibly carried to a shippable state, but provenance is not equivalent to third-party process verification.

## 5. Physics implementation

- **Attempted:** Build deterministic arcade physics for momentum, inverse-distance attraction, capture orbits, recoil, collision response, fracture, analytic fluid flow, path replay, predictive flocking, and a curated final-law combination.
- **Successfully delivered:** ORBIT curves and captures bodies; FRACTURE creates bounded directional fragments and chains; FLOW samples deterministic current and vortex fields; ECHO replays recorded movement as danger; SWARM uses neighborhood-driven group behavior and prediction; NOVA combines representative objects under global budgets. Fixed 60 Hz stepping makes Daily runs reproducible.
- **Repository evidence:** `app/game/simulation.ts` contains the law forces, collision and stability logic, entity pools, history buffers, swarm passes, current fields, Nova suppression corridor, and 600-tick phase schedule. `tests/simulation.test.ts` separately exercises each law, resize/clamping, determinism, survivability, phase timing, and 100 full seeded runs.
- **Remaining weaknesses:** This is deliberately tuned arcade physics, not a general rigid-body solver. Collision handling is discrete rather than continuous, and there are no numerical reference tests for conservation laws because spectacle and control take precedence over physical realism. Feel parameters remain hand-tuned.
- **Score: 8.5/10.** The physics breadth is substantive, deterministic, and mechanically used, while still short of simulation-engine rigor or independent feel validation.

## 6. Graphics and shader quality

- **Attempted:** Produce a premium scientific-cinematic identity with custom procedural depth, crisp gameplay silhouettes, restrained bloom, phase transformations, responsive effects, and a graceful non-WebGL path.
- **Successfully delivered:** A custom WebGL field shader handles atmosphere, law accents, distortion, and quality tiers; a Canvas2D foreground renders collision-critical entities, the iconic Core, trails, capture tension, wavefronts, shards, echoes, swarm agents, and pooled particles. WebGL context loss falls back safely, and phase transitions remain continuous.
- **Repository evidence:** `app/game/renderer.ts` includes shader source, WebGL compilation and restoration, Canvas2D fallback backgrounds, pooled cosmetic objects, adaptive shader/particle/trail/detail levels, bounded DPR, and law-specific drawing. `app/globals.css` supplies the controlled UI motion, grain, typography, and responsive framing. `public/og.png` and `public/favicon.png` extend the identity to launch surfaces.
- **Remaining weaknesses:** The renderer uses one lightweight background shader plus immediate-mode Canvas2D rather than a full GPU scene, instanced geometry, or a multi-pass post-processing stack. Visual quality is supported by direct browser inspection but not by automated image-diff tests or a broad GPU/browser screenshot matrix.
- **Score: 8.3/10.** The visual system is custom, coherent, and production-conscious; it is not trying to match the rendering depth of a dedicated engine or high-end desktop title.

## 7. Audio generation

- **Attempted:** Create an original browser-native musical and feedback identity that evolves every ten seconds, reacts to charge/combo/Nova, respects autoplay rules, and requires no copyrighted assets.
- **Successfully delivered:** One gesture-gated Web Audio graph provides a 96 BPM six-phase score, oscillated beds and pulses, phase filtering, attraction response, transition cues, collision/collect/near-miss feedback, combo escalation, and bounded effect voices. Mute and volume states are controllable, and audio unlock cannot block gameplay.
- **Repository evidence:** `app/game/audio.ts` contains the phase patterns, oscillator/filter/gain graph, voice accounting, event synthesis, ducking, lifecycle, volume, mute, resume, suspend, and disposal logic. `app/game/SolShiftGame.tsx` connects gestures, visibility, pause, settings, simulation events, and throttled reactive updates to the engine. The no-sample provenance is documented in `BUILD_PROVENANCE.md`.
- **Remaining weaknesses:** Audio output is not unit-tested perceptually or through offline spectral snapshots. Browser/device speaker variation, Safari timing, mix fatigue, and phase-to-phase musical appeal still need physical-device and listener testing. Procedural oscillators offer less timbral richness than a carefully mastered sample library.
- **Score: 7.9/10.** The audio is a real adaptive system rather than placeholder beeps, but it has less objective validation than the simulation and protocol layers.

## 8. UI and interaction design

- **Attempted:** Make the game understandable without a traditional tutorial, preserve immediate entry and restart, and provide legible menus, HUD, pause/settings, challenge context, results, and Creator controls without overwhelming the arena.
- **Successfully delivered:** The menu leads with the hold/release interaction and primary Daily action; the HUD exposes time, score, exact scoring multiplier, stability, phase, and charge; results expose score, archetype, six-cell signature, comparison status, retry, challenge, copy, download, and share. Native keyboard behavior is preserved inside buttons, sliders, and selects; pause/results move and trap focus; utility controls cannot accidentally steer or fire.
- **Repository evidence:** `app/game/SolShiftGame.tsx` implements menu/run/pause/result/Creator states and their input handling. `app/globals.css` defines hierarchy, responsive panels, focus states, HUD modes, and result layouts. `tests/rendered-html.test.mjs` verifies the anonymous entry surface and removal of starter-only content.
- **Remaining weaknesses:** There is no formal task-completion/usability study. The result and Creator panels are information-dense and become internally scrollable on the smallest supported viewport. Clipboard, download, and native-share behavior necessarily varies by browser.
- **Score: 8.2/10.** The UI is product-complete and visually integrated, with remaining uncertainty concentrated in external usability rather than missing flows.

## 9. Mobile responsiveness

- **Attempted:** Treat touch as the canonical one-handed control and keep canvas, overlays, safe areas, orientation changes, focus loss, and tiny viewports usable.
- **Successfully delivered:** Pointer events unify mouse, pen, and touch; touch drag includes an occlusion lift; page scrolling is suppressed during play; renderer dimensions follow the stage; safe-area insets and portrait/compact rules reposition HUD and actions. Visibility changes pause/recover the run, and state is rescaled and clamped after resize.
- **Repository evidence:** Touch/pointer and resize/visibility integration is in `app/game/SolShiftGame.tsx`; mobile/safe-area rules and `touch-action` behavior are in `app/globals.css`; `app/game/renderer.ts` observes and resizes the arena; `tests/simulation.test.ts` verifies resize/clamp stability. `BUILD_PROVENANCE.md` records manual browser checks at phone-sized viewports.
- **Remaining weaknesses:** Browser emulation and narrow-viewport inspection are not a substitute for a physical iPhone/Android performance and ergonomics matrix. File download/share behavior remains platform-specific, and landscape phone play has less screen real estate for the full HUD.
- **Score: 7.8/10.** The implementation is meaningfully touch-first and responsive, but physical-device breadth and sustained mobile profiling are still missing.

## 10. Accessibility

- **Attempted:** Support keyboard-only play, visible focus, reduced motion, sufficient contrast, pause/recovery, mute and volume controls, scalable interface text, and color-independent hazard readability.
- **Successfully delivered:** WASD/arrows and Space mirror pointer play; P/Escape pause and M mute; native control keys are not hijacked; interactive DOM controls expose focus treatment and labels; modal focus is moved and contained; UI pinch zoom remains available; motion preferences affect CSS and renderer cosmetics without altering deterministic gameplay; settings persist mute, volume, and motion locally; threat silhouettes supplement hue.
- **Repository evidence:** Keyboard, focus trap, blur/visibility recovery, preference, and dialog behavior are implemented in `app/game/SolShiftGame.tsx`; focus, contrast, manual/OS reduced-motion, touch-action, and responsive type rules are in `app/globals.css`; `tests/simulation.test.ts` proves reduced motion does not change Daily state or ECHO history; renderer shapes in `app/game/renderer.ts` do not rely on color alone.
- **Remaining weaknesses:** Canvas gameplay has limited semantic value for screen-reader users, and there is no screen-reader, switch-control, high-contrast-mode, or automated WCAG audit. Controls are not remappable, and color-vision choices have not been verified with formal contrast/simulation tooling across every effect state.
- **Score: 7.5/10.** Several important accommodations are real and integrated, but the game is not equally operable across all assistive technologies.

## 11. Autonomous debugging

- **Attempted:** Run and inspect the product, find failures that static analysis misses, apply corrections, and challenge performance, protocol, input, resizing, and repeat-run assumptions.
- **Successfully delivered:** Browser playtesting exposed and corrected audio-start blocking, focus-induced arena scrolling, a misleading raw combo display, pause-panel state, overlay input propagation, challenge targeting, and a potentially hanging clipboard path. The final adversarial pass additionally corrected native keyboard hijacking, Endless time clamping, stale quota-failed storage, Creator autopilot failure, late-phase recording cues, resize/focus input latching, hidden challenge outcomes, slow-motion music drift, and exception cleanup. A performance review led to render-rate capping, hot-path snapshot reuse, audio-update throttling, and deeper adaptive-quality reductions.
- **Repository evidence:** The concrete runtime corrections are recorded in `BUILD_PROVENANCE.md`; their resulting code is in `SolShiftGame.tsx`, `resultCard.ts`, `renderer.ts`, and `simulation.ts`. Regression coverage includes snapshot ownership, hostile challenge values, disabled/corrupt storage, repeated seeded runs, invalid terminal states, and resize behavior in `tests/`.
- **Remaining weaknesses:** There is no external issue tracker or independent reproduction log, and not every manual browser action is represented as a repeatable end-to-end test. The browser matrix remains narrower than production QA for a public game.
- **Score: 8.7/10.** The work shows evidence-driven correction rather than build-pass complacency, while leaving room for more reproducible cross-browser QA.

## 12. Test coverage

- **Attempted:** Cover deterministic and non-visual systems deeply, stress repeated runs and global budgets, validate hostile external state, and verify that the server-rendered product entry is clean.
- **Successfully delivered:** The repository has 40 named checks: 17 simulation tests, 19 protocol/result-card tests, 2 UI-logic tests, and 2 rendered-entry tests. They cover full-state reproducibility, exact 600/3,600-tick timing, all laws, input edges, difficulty, failure/completion exclusivity, Endless cycling/time, resize, reduced motion, Creator survival and real boundary cues, 100-run object budgets, UTC seeds, canonical/hostile URLs, quota-stale storage, PB/challenge status, scoring, signatures, archetypes, result text, card dimensions, exception-safe progressive share fallback, and starter removal.
- **Repository evidence:** `tests/simulation.test.ts`, `tests/protocol.test.ts`, `tests/ui-logic.test.ts`, `tests/rendered-html.test.mjs`, and the `test`, `test:logic`, `typecheck`, `lint`, and `build` scripts in `package.json`.
- **Remaining weaknesses:** There is no code-coverage percentage, visual regression suite, automated real-browser gameplay completion test, or direct Web Audio/WebGL correctness test. Manual browser checks cover several UI paths, but are not yet committed as repeatable Playwright tests.
- **Score: 8.4/10.** Deterministic core and product-protocol coverage are strong; browser rendering, audio, and full UI automation are the principal gaps.

## 13. Performance optimization

- **Attempted:** Hold a fixed simulation rate, cap presentation work, avoid per-frame deep copies and React renders, bound all dynamic objects, adapt visual cost without changing gameplay, and provide a lower-cost fallback.
- **Successfully delivered:** Simulation advances at fixed 60 Hz while rendering is capped at 60 Hz; the hot loop uses a live render snapshot and throttles audio reaction updates. Entity types, fragments, particles, pulses, trails, and ECHO history have explicit budgets or bounded buffers. The renderer pools cosmetics, caps DPR, samples frame time, and progressively reduces resolution, shader detail, bloom, particles, trails, fallback stars/lines/rings, and geometric segments. Canvas2D remains functional when WebGL is unavailable.
- **Repository evidence:** Hot-loop scheduling is in `app/game/SolShiftGame.tsx`; snapshot ownership, object caps, pools, and history bounds are in `app/game/simulation.ts`; adaptive tiers and renderer pools are in `app/game/renderer.ts`; `tests/simulation.test.ts` runs 100 deterministic scenarios and asserts global/final-law budgets. `README.md` describes the no-network core path and build architecture.
- **Remaining weaknesses:** Stable 60 FPS desktop and 30–60 FPS phone targets have not been proven through a published physical-device trace, long-session memory profile, or production RUM. Bundle and transfer measurements must be re-recorded after the final production build whenever dependencies/assets change. Canvas2D entity drawing remains CPU-bound at high object counts.
- **Score: 8.0/10.** The code has concrete, multi-layer performance safeguards and a serious adversarial correction pass, but frame-rate and memory claims remain targets until measured on representative hardware.

## 14. Documentation

- **Attempted:** Explain the game, controls, local development, production deployment, architecture, concept rationale, provenance, launch framing, recording workflow, limitations, and benchmark evidence.
- **Successfully delivered:** The repository includes all required documents with consistent terminology and honest iteration language. Setup and validation commands are explicit; major decisions and known limitations are not hidden; the launch kit provides exact 15- and 30-second shot plans plus social copy.
- **Repository evidence:** `README.md`, `DESIGN_DECISIONS.md`, `BUILD_PROVENANCE.md`, `LAUNCH_KIT.md`, and this `SOL_ULTRA_BENCHMARK.md`.
- **Remaining weaknesses:** The production origin is environment-owned and therefore reported in the release handoff rather than hardcoded into reusable source documentation. Post-launch physical-device findings and audience behavior will still require later documentation updates.
- **Score: 8.6/10.** Documentation is unusually complete and candid for the project size, with the remaining gaps tied mostly to final deployment and real-world operation.

## 15. Product completeness

- **Attempted:** Ship a coherent public game rather than a prototype: Daily and Endless play, six laws, failure/completion/restart, audio, settings, challenge handling, local progress, results, sharing, Creator Mode, responsive input, metadata, tests, and production build configuration.
- **Successfully delivered:** All requested product surfaces exist and connect to the same deterministic game. Daily requires no server; Endless escalates and reports time beyond 60 seconds; challenge URLs auto-start comparable seed/target context; results are recorded locally; Creator Mode supplies an authentic showcase seed, cross-viewport surviving auto input, real boundary/final-five-second cues, slow motion, clean/full HUD, 16:9/9:16 framing, and unranked results. The app has Worker-compatible build and routing files, metadata, favicon, and social preview.
- **Repository evidence:** `app/game/SolShiftGame.tsx` integrates the complete state flow; `simulation.ts`, `protocol.ts`, `audio.ts`, and `resultCard.ts` supply the product systems; `app/layout.tsx`, `app/page.tsx`, `worker/index.ts`, `vite.config.ts`, and `.openai/hosting.json` supply the entry/build/hosting surface; required operational instructions are in `README.md`.
- **Remaining weaknesses:** Public-traffic stability has not been demonstrated under real traffic, and there is no hosted global score verification or account sync by design. Native share/download details depend on browser capability. An external player cohort could still reveal balance or onboarding problems that repository QA cannot.
- **Score: 8.5/10.** This is a complete local-first game product with very few missing requested surfaces, but not yet a live-service product proven under audience load.

## 16. Social distribution mechanics

- **Attempted:** Make every run produce a compact, comparable artifact and a frictionless same-universe challenge, while providing recording tools and launch material without authentication or a backend.
- **Successfully delivered:** UTC Daily seeds create shared runs; validated URLs encode mode, seed, challenger score, and optional archetype; local PBs and deltas add stakes; the six-cell Shift Signature is compact text; a procedural 1200×630 card contains score, survival, archetype, combo, grades, challenge identity, and PB/challenger context. Web Share, copy, and image download degrade progressively. Creator Mode and `LAUNCH_KIT.md` make authentic short-form capture repeatable.
- **Repository evidence:** Daily seed, challenge, result, signature, archetype, and storage logic is in `app/game/protocol.ts`; card rendering and share fallbacks are in `app/game/resultCard.ts`; result and Creator flows are in `app/game/SolShiftGame.tsx`; protocol/card behavior is covered in `tests/protocol.test.ts`; launch sequences and post copy are in `LAUNCH_KIT.md`.
- **Remaining weaknesses:** The loop is product-engineered but not market-validated: there are no real share-rate, click-through, challenge-conversion, or retention measurements. The same seed is mechanically reproducible for equivalent arena geometry, but portrait and landscape viewports scale that geometry differently, so challenge scores are not normalized across aspect ratios. Local scores can also be modified by a determined user and are not suitable for authoritative global competition. Some mobile share targets may omit or transform image/URL payloads.
- **Score: 8.7/10.** The distribution loop is unusually complete for a serverless browser game, but virality remains a hypothesis until real players use it.

## Overall conservative result

| Category | Score |
| --- | ---: |
| Creative originality | 8.4 |
| Gameplay coherence | 8.0 |
| Codebase architecture | 8.6 |
| Long-horizon execution | 8.7 |
| Physics implementation | 8.5 |
| Graphics and shader quality | 8.3 |
| Audio generation | 7.9 |
| UI and interaction design | 8.2 |
| Mobile responsiveness | 7.8 |
| Accessibility | 7.5 |
| Autonomous debugging | 8.7 |
| Test coverage | 8.4 |
| Performance optimization | 8.0 |
| Documentation | 8.6 |
| Product completeness | 8.5 |
| Social distribution mechanics | 8.7 |
| **Equal-weight mean** | **8.3 / 10** |

**Overall: 8.3/10.** SOL//SHIFT is strong evidence of integrated creative, technical, product, and debugging execution: it is a complete deterministic game with six meaningfully different laws, custom presentation and audio, distribution mechanics, and a substantive test suite. The most important remaining uncertainties are empirical rather than hidden missing features—external fun/replayability validation, physical-device performance, broad accessibility testing, cross-browser end-to-end automation, and real audience behavior. Those gaps are large enough to prevent a 9, but they do not reduce the project to a prototype.
