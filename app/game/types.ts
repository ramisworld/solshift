export const PHASES = [
  "ORBIT",
  "FRACTURE",
  "FLOW",
  "ECHO",
  "SWARM",
  "NOVA",
] as const;

export type PhaseName = (typeof PHASES)[number];
export type GameMode = "daily" | "endless";
export type GameStatus = "menu" | "playing" | "paused" | "results";

export interface Vec2 {
  x: number;
  y: number;
}

export interface InputState {
  target: Vec2;
  keyboard: Vec2;
  active: boolean;
  justPressed: boolean;
  justReleased: boolean;
  pointerType: "mouse" | "touch" | "pen" | "keyboard" | "demo";
}

export type EntityKind =
  | "energy"
  | "orbiter"
  | "gate"
  | "crystal"
  | "fragment"
  | "droplet"
  | "vortex"
  | "echo"
  | "swarm";

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  age: number;
  life: number;
  rotation: number;
  spin: number;
  state: number;
  value: number;
  captured: boolean;
  captureAngle: number;
  captureRadius: number;
  vulnerable: boolean;
  dangerous: boolean;
  phase: number;
  seed: number;
  health: number;
  alpha: number;
}

export interface CoreState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  charge: number;
  chargeSeconds: number;
  stability: number;
  invulnerable: number;
  hitFlash: number;
  novaAge: number;
  novaStrength: number;
  recoilX: number;
  recoilY: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  tick: number;
  charge: number;
}

export interface GameMetrics {
  score: number;
  bankedScore: number;
  unbankedFlux: number;
  energyCollected: number;
  largestChain: number;
  combo: number;
  highestCombo: number;
  nearMisses: number;
  novaCount: number;
  collisions: number;
  phaseScores: number[];
  phaseCompleted: boolean[];
}

export interface GameSnapshot {
  status: GameStatus;
  mode: GameMode;
  seed: number;
  tick: number;
  elapsed: number;
  cycle: number;
  phaseIndex: number;
  phase: PhaseName;
  phaseTime: number;
  phaseProgress: number;
  phaseTransition: number;
  difficulty: number;
  width: number;
  height: number;
  core: CoreState;
  entities: readonly Entity[];
  trail: readonly TrailPoint[];
  metrics: GameMetrics;
  shake: number;
  flash: number;
  timeScale: number;
  lastChain: number;
  runComplete: boolean;
  deathReason: string | null;
}

export type GameEvent =
  | { type: "phase"; phase: PhaseName; phaseIndex: number }
  | { type: "charge-start" }
  | { type: "nova"; x: number; y: number; strength: number; captured: number }
  | { type: "collect"; x: number; y: number; value: number; combo: number }
  | { type: "gate"; x: number; y: number; value: number }
  | { type: "fracture"; x: number; y: number; chain: number; strength: number }
  | { type: "near-miss"; x: number; y: number }
  | { type: "hit"; x: number; y: number; stability: number }
  | { type: "complete"; score: number }
  | { type: "game-over"; score: number; reason: string };

export interface SimulationOptions {
  width: number;
  height: number;
  mode: GameMode;
  seed: number;
  reducedMotion?: boolean;
}

export interface RenderQuality {
  level: "low" | "medium" | "high";
  dpr: number;
  particles: number;
  trailPoints: number;
  bloom: boolean;
  reducedMotion: boolean;
}

export const FIXED_STEP = 1 / 60;
export const PHASE_TICKS = 600;
export const RUN_TICKS = PHASE_TICKS * PHASES.length;
