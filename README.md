# SOL//SHIFT

**Pull matter into orbit, release a Nova, bank Flux, and survive six mutating laws in 60 seconds.**

SOL//SHIFT is a deterministic, touch-first browser game about controlling a living artificial sun. Hold while steering to bend trajectories and capture matter; release to convert that visible configuration into a Nova wave, chain reaction, and recoil. Every ten seconds the same physical toy mutates into a new law: ORBIT, FRACTURE, FLOW, ECHO, SWARM, and NOVA.

The default Daily Shift gives every player the same UTC seed. Endless Shift keeps cycling the laws at increasing difficulty. No account, backend, telemetry, cookies, or network gameplay service is required.

## Goal and scoring loop

1. **Pull:** hold while steering near cyan matter to capture it around the Core.
2. **Nova:** release the exact captured configuration. More charge and captured mass produce a stronger, more rewarding Nova.
3. **Chain:** aim loaded Novas through crystals, swarms, and other law-specific targets to multiply Flux.
4. **Bank:** cross a luminous ring to convert at-risk Flux into permanent score. A hit removes unbanked Flux and one point of Core stability.
5. **Survive:** clear all six laws, protect the Core's three stability points, and beat the Daily score or your personal best.

The first run teaches this loop in the arena, and its 60-second clock does not begin until the player's first movement or attraction input.

## Controls

| Input | Move | Attract / charge | Nova |
| --- | --- | --- | --- |
| Mouse / pen | Point or drag | Hold primary input | Release |
| Touch | Press and drag; the target is lifted above the finger | Keep touching | Lift |
| Keyboard | WASD or arrow keys | Hold Space | Release Space |

`P` or `Escape` pauses. `M` toggles sound. The pause panel includes the reduced-motion control.

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the exact local URL printed by the development server.

Useful checks:

```bash
npm run typecheck
npm run lint
npm run test:logic
npm test
npm run build
```

`npm test` runs deterministic logic tests, produces the deployment build, and verifies the server-rendered anonymous entry screen.

## Production deployment

The repository uses vinext and the Sites Vite/Cloudflare Worker build. It requires no D1 database, R2 bucket, secrets, or environment variables.

```bash
npm ci
npm test
npm run build
```

Deploy the generated Worker-compatible output with Sites, or use the equivalent Cloudflare Worker pipeline. Route all requests to the app entry; challenge state is encoded in validated query parameters rather than separate routes.

## Architecture

- `app/game/simulation.ts` — fixed-step deterministic gameplay and scoring.
- `app/game/renderer.ts` — procedural WebGL field plus Canvas2D world/fallback.
- `app/game/audio.ts` — gesture-gated procedural Web Audio score and feedback.
- `app/game/protocol.ts` — Daily seeds, challenge URLs, storage, signatures, and archetypes.
- `app/game/resultCard.ts` — client-side share-card rendering and share fallbacks.
- `app/game/SolShiftGame.tsx` — imperative frame-loop integration and accessible DOM UI.
- `tests/` — deterministic, protocol, stress, and rendered-entry coverage.

React owns menus, the HUD, results, accessibility, and creator controls. Simulation and rendering never use React as a frame loop. Gameplay randomness is separated from cosmetic randomness; adaptive quality changes presentation only.

## Performance envelope

The current production client artifact set is approximately **436 KiB raw / 132 KiB gzip**, including framework, game, runtime, and CSS chunks. There is no downloadable font payload. The 1,200×630 social preview is requested independently by crawlers or direct asset access and is not part of the playable client chunk set.

Gameplay is fixed at 60 simulation steps per second. Presentation is capped at 60 Hz on high-refresh screens. Capability-based quality configures 48–220 cosmetic-particle slots and 28–84 trail points; reduced motion and measured slow frames lower the active budgets through two additional tiers that also reduce resolution, bloom, shader layers, and fallback geometry without changing deterministic hazards. The simulation caps live entities at 112, cosmetic particles use a fixed 512-slot pool, and each rendering canvas has a 3.2-million-pixel backing budget.

Automated tests cover 100 full deterministic seeds, global object ceilings, phase boundaries, repeated state transitions, and detached diagnostic snapshots. The measured 100-seed stress stream peaked at 86 live simulation entities against the hard ceiling of 112. Browser QA covered desktop, 390×844, and 320×568 layouts. These checks support the performance targets; they are not a substitute for a laboratory FPS/memory trace across every physical device. See the conservative benchmark for the precise strengths and remaining gaps.

## Privacy and offline behavior

Runs, preferences, attempts, and personal bests stay in local browser storage. ECHO replays only the current in-memory run path. The basic game makes no API calls and uploads no personal data. If storage is unavailable or corrupt, play continues with in-memory defaults.

## Documentation

- [Design decisions](DESIGN_DECISIONS.md)
- [Build provenance](BUILD_PROVENANCE.md)
- [Launch kit](LAUNCH_KIT.md)
- [Conservative benchmark](SOL_ULTRA_BENCHMARK.md)

## Browser support

The premium renderer targets current Chromium, Safari, and Firefox with WebGL enabled. A Canvas2D background fallback preserves the full deterministic game if WebGL initialization or context restoration fails. Web Share, clipboard, and image download are progressively enhanced; retry and local play never depend on them.
