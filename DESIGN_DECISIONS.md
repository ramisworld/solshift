# SOL//SHIFT — Design Decisions

## Concept tournament

Seven independent lenses stress-tested the supplied concept before implementation. Each used the same weighted rubric: visual hook 20%, fun in five seconds 15%, replayability 15%, originality 15%, spectator appeal 15%, technical feasibility 10%, and capability breadth 10%.

| Lens | SOL//SHIFT | Strongest alternative | Alternative score | Verdict |
| --- | ---: | --- | ---: | --- |
| Viral concept | 8.320 | AFTERCUT | 8.900 | Replace |
| Casual/replayability | 8.435 | TETHER//SHIFT | 8.360 | Retain |
| Experimental interaction | 8.920 | PULSE//RIDER | 8.745 | Retain |
| Premium visual direction | 8.940 | VOID//LOOM | 8.855 | Retain |
| Technical feasibility | 8.825 | GRAVITY//CHAIN | 8.620 | Retain |
| Social/X growth | 8.610 | ECHO//TRACE | 8.820 | Retain |
| Critical failure analysis | 7.600 | SUN//SLING | 8.615 | Replace |

The average SOL//SHIFT score was **8.52/10**. Alternatives were intentionally different, so their scores cannot be averaged into a coherent competing product. No single alternative won across the complete set of lenses. Five reviewers retained SOL//SHIFT; two credible dissenters showed that a narrower self-echo or orbit-sling game would be easier to finish and explain.

## Final concept decision

**Retain SOL//SHIFT.** Its law-mutation hook, spectator crescendo, replay structure, and breadth are the strongest complete proposition. Replacement concepts scored higher only within individual lenses, not across the full rubric. The dissent changes the implementation: breadth is allowed only after the common physical toy proves fun.

The invariant interaction is:

1. **Capture visible mass.** Holding bends trajectories and pulls matter into an unmistakable orbit.
2. **Build visible tension.** Captured orbit radius contracts, motion accelerates, and danger closes in.
3. **Release the configuration.** Nova converts the actual captured arrangement into a wave, chain reaction, and bounded recoil.

Attraction is not an invisible vacuum, charge is not merely a meter, and Nova is not a generic screen-clearing bomb.

## Vertical-slice gates

ORBIT, FRACTURE, and their seamless transition are implemented and played before the other four phases are expanded. The slice must demonstrate:

- Same-frame visual response and under-100 ms perceived input feedback.
- A satisfying first capture/release in the opening three seconds.
- Touch steering and charging as one intentional press–drag–release cadence.
- A readable captured orbit and recoil direction.
- A fracture event with weight, bounded hit-stop, and a clear cause.
- The same input meaning on both sides of the phase transition.
- A stable 60 FPS target on desktop and a viable 30–60 FPS mobile path.

If the loop still feels like “move a circle and press a bomb” after two serious tuning passes, the fallback is the narrower **SUN//SLING** structure: visible orbit-building and release become the entire game.

## Mechanical decisions

- The simulation uses a fixed 60 Hz step. A Daily run is exactly 3,600 active ticks; each phase is 600 ticks.
- Gameplay randomness uses isolated deterministic streams. Rendering never consumes gameplay randomness.
- Touch is canonical: press and drag steers while charging; release fires. Pointer and keyboard preserve the same rhythm.
- Survival is forgiving; scoring is demanding. The Core has visible stability layers, tight collision hulls, short invulnerability, and loses unbanked Flux/combo before ending the run.
- Score rewards captured mass, varied chains, gates, near misses, and contextual release timing. Holding by itself earns nothing.
- Phase changes mutate the forces and material behavior of a shared object grammar. They do not invert steering or create six unrelated minigames.
- NOVA curates representative earlier systems under one budget; it does not run every system at maximum density.

## Visual decisions

- The white-hot, amber-edged Core never changes identity. Two asymmetric orbital scars keep its silhouette recognizable in compressed video.
- Shared primitives are field lines, stable matter nodes, wavefronts, and trails.
- A law-change wave crosses the arena; objects transform as it reaches them. Momentum, camera, Core, and HUD do not cut.
- Phase accents remain controlled: ORBIT mineral blue, FRACTURE pale cyan, FLOW ultraviolet/silver, ECHO spectral coral, SWARM sulfur gold, NOVA solar white/amber.
- Bloom is reserved for the Core, Nova edge, and selected impacts. Collision-critical geometry renders above decoration.
- Fracture favors a few large directional shards with delayed secondary breaks rather than confetti.

## Technical decisions

- React owns the shell, menus, HUD, results, and accessibility. The frame loop is imperative and does not render through React.
- A deterministic TypeScript simulation is separated from rendering and procedural audio.
- Rendering uses a lightweight WebGL background shader plus a crisp Canvas2D gameplay layer. Canvas2D alone remains a graceful fallback.
- Pooled entities and particles, capped impulses, strict object budgets, bounded DPR, and adaptive cosmetic quality protect mobile performance.
- One lifetime Web Audio graph starts after the first gesture. Phase layers and effects reuse that graph.
- Daily seeds are UTC-based. Challenge URLs are validated, bounded, versioned, and require no server.
- Creator Mode is authentic and marks showcase results unranked.

## Product language

- One-sentence hook: **Survive 60 seconds while the laws of physics mutate around you.**
- The six-cell result artifact is the **Shift Signature**.
- A text-safe signature uses `O5·F4·W3·E2·S5·N6`.
- No unverifiable global ranks or percentiles are shown. Sharing compares deterministic seeds, challenger targets, personal bests, attempts, and signatures.
