import {
  FIXED_STEP,
  PHASES,
  PHASE_TICKS,
  RUN_TICKS,
  type CoreState,
  type Entity,
  type EntityKind,
  type GameEvent,
  type GameMetrics,
  type GameMode,
  type GameSnapshot,
  type GameStatus,
  type InputState,
  type SimulationOptions,
  type TrailPoint,
// @ts-expect-error Node's native TypeScript runner requires the source extension.
} from "./types.ts";

const TAU = Math.PI * 2;
const MAX_ENTITIES = 112;
const MAX_FRAGMENTS = 64;
const MAX_ENERGY = 20;
const MAX_GATES = 4;
const MAX_DROPLETS = 24;
const MAX_VORTICES = 4;
const MAX_ECHOES = 3;
const MAX_SWARM = 30;
const MAX_CRYSTALS = 22;
const MAX_ORBITERS = 16;
const NOVA_DROPLETS = 8;
const NOVA_VORTICES = 1;
const NOVA_ECHOES = 2;
const NOVA_SWARM = 12;
const NOVA_CRYSTALS = 6;
const NOVA_ORBITERS = 6;
const MAX_TRAIL = 120;
const MAX_GAMEPLAY_HISTORY = PHASE_TICKS;
const MIN_ARENA_SIZE = 96;
const MAX_ARENA_SIZE = 8192;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function arenaSize(value: number, fallback: number) {
  return clamp(finite(value, fallback), MIN_ARENA_SIZE, MAX_ARENA_SIZE);
}

function length(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

function pointSegmentDistance(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (segmentLengthSquared <= 1e-6) {
    return length(pointX - endX, pointY - endY);
  }
  const projection = clamp(
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / segmentLengthSquared,
    0,
    1,
  );
  return length(
    pointX - (startX + segmentX * projection),
    pointY - (startY + segmentY * projection),
  );
}

function mixSeed(seed: number, salt: number) {
  let value = (seed ^ salt ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

class RandomStream {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  uint() {
    let value = (this.state + 0x6d2b79f5) >>> 0;
    this.state = value;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  unit() {
    return this.uint() / 0x1_0000_0000;
  }

  range(minimum: number, maximum: number) {
    return minimum + (maximum - minimum) * this.unit();
  }

  integer(minimum: number, maximum: number) {
    return Math.floor(this.range(minimum, maximum + 1));
  }
}

function createCore(width: number, height: number): CoreState {
  return {
    x: width * 0.5,
    y: height * 0.5,
    vx: 0,
    vy: 0,
    radius: 12,
    charge: 0,
    chargeSeconds: 0,
    stability: 3,
    invulnerable: 0,
    hitFlash: 0,
    novaAge: 10,
    novaStrength: 0,
    recoilX: 0,
    recoilY: 0,
  };
}

function createMetrics(): GameMetrics {
  return {
    score: 0,
    bankedScore: 0,
    unbankedFlux: 0,
    energyCollected: 0,
    largestChain: 0,
    combo: 0,
    highestCombo: 0,
    nearMisses: 0,
    novaCount: 0,
    collisions: 0,
    phaseScores: PHASES.map(() => 0),
    phaseCompleted: PHASES.map(() => false),
  };
}

function blankInput(width: number, height: number): InputState {
  return {
    target: { x: width * 0.5, y: height * 0.5 },
    keyboard: { x: 0, y: 0 },
    active: false,
    justPressed: false,
    justReleased: false,
    pointerType: "demo",
  };
}

/**
 * Deterministic gameplay state for SOL//SHIFT.
 *
 * Simulation time advances only in exact 60 Hz ticks. Rendering can call update
 * with arbitrary frame deltas; input edges are latched until a gameplay tick
 * consumes them.
 */
export class GameSimulation {
  private width: number;
  private height: number;
  private mode: GameMode;
  private seed: number;
  private readonly reducedMotion: boolean;

  private status: GameSnapshot["status"] = "menu";
  private tick = 0;
  private cycle = 0;
  private phaseIndex = 0;
  private phaseTick = 0;
  private phaseTransition = 1;
  private difficulty = 1;
  private accumulator = 0;
  private disposed = false;

  private core: CoreState;
  private entities: Entity[] = [];
  private fragmentPool: Entity[] = [];
  private trail: TrailPoint[] = [];
  private gameplayHistory: TrailPoint[] = [];
  private echoPath: TrailPoint[] = [];
  private metrics = createMetrics();
  private pendingEvents: GameEvent[] = [];
  private nearMissed = new Set<number>();
  private nextEntityId = 1;
  private phaseRng: RandomStream;
  private swarmFrame: Array<Pick<Entity, "id" | "x" | "y" | "vx" | "vy" | "state" | "captured">> = [];

  private inputActive = false;
  private hasPointerTarget = false;
  private inputBuffer: InputState;
  private comboTicks = 0;
  private shake = 0;
  private flash = 0;
  private timeScale = 1;
  private lastChain = 0;
  private runComplete = false;
  private deathReason: string | null = null;

  constructor(options: SimulationOptions) {
    this.width = arenaSize(options.width, 1280);
    this.height = arenaSize(options.height, 720);
    this.mode = options.mode;
    this.seed = options.seed >>> 0;
    this.reducedMotion = options.reducedMotion === true;
    this.core = createCore(this.width, this.height);
    this.inputBuffer = blankInput(this.width, this.height);
    this.phaseRng = this.createPhaseStream(0, 0);
  }

  resize(width: number, height: number) {
    const nextWidth = arenaSize(width, this.width);
    const nextHeight = arenaSize(height, this.height);
    const scaleX = nextWidth / this.width;
    const scaleY = nextHeight / this.height;
    const velocityScale = Math.sqrt(scaleX * scaleY);

    this.core.x *= scaleX;
    this.core.y *= scaleY;
    this.core.vx *= velocityScale;
    this.core.vy *= velocityScale;

    for (const entity of this.entities) {
      entity.x *= scaleX;
      entity.y *= scaleY;
      entity.vx *= velocityScale;
      entity.vy *= velocityScale;
      entity.captureRadius *= velocityScale;
    }

    for (const point of this.trail) {
      point.x *= scaleX;
      point.y *= scaleY;
    }
    for (const point of this.gameplayHistory) {
      point.x *= scaleX;
      point.y *= scaleY;
    }
    for (const point of this.echoPath) {
      point.x *= scaleX;
      point.y *= scaleY;
    }

    this.inputBuffer.target.x *= scaleX;
    this.inputBuffer.target.y *= scaleY;
    this.width = nextWidth;
    this.height = nextHeight;

    this.clampCoreToArena();
    for (const entity of this.entities) {
      this.clampEntityToArena(entity);
    }
    this.inputBuffer.target.x = clamp(this.inputBuffer.target.x, 0, this.width);
    this.inputBuffer.target.y = clamp(this.inputBuffer.target.y, 0, this.height);
  }

  start(mode: GameMode, seed: number) {
    this.recycleAllEntities();
    this.mode = mode;
    this.seed = seed >>> 0;
    this.status = "playing";
    this.tick = 0;
    this.cycle = 0;
    this.phaseIndex = 0;
    this.phaseTick = 0;
    this.phaseTransition = 1;
    this.difficulty = 1;
    this.accumulator = 0;
    this.disposed = false;
    this.core = createCore(this.width, this.height);
    this.metrics = createMetrics();
    this.trail = [];
    this.gameplayHistory = [];
    this.echoPath = [];
    this.pendingEvents = [];
    this.nearMissed.clear();
    this.nextEntityId = 1;
    this.inputActive = false;
    this.hasPointerTarget = false;
    this.inputBuffer = blankInput(this.width, this.height);
    this.comboTicks = 0;
    this.shake = 0;
    this.flash = 0;
    this.timeScale = 1;
    this.lastChain = 0;
    this.runComplete = false;
    this.deathReason = null;
    this.phaseRng = this.createPhaseStream(0, 0);

    this.seedOpeningOrbit();
    this.pendingEvents.push({ type: "phase", phase: "ORBIT", phaseIndex: 0 });
  }

  setPaused(paused: boolean) {
    if (paused && this.status === "playing") {
      this.status = "paused";
      this.accumulator = 0;
    } else if (!paused && this.status === "paused") {
      this.status = "playing";
      this.accumulator = 0;
    }
  }

  /** Cancels a held field without emitting a Nova, used when focus is lost. */
  cancelInput() {
    this.inputActive = false;
    this.core.charge = 0;
    this.core.chargeSeconds = 0;
    this.inputBuffer.active = false;
    this.inputBuffer.justPressed = false;
    this.inputBuffer.justReleased = false;
  }

  forcePhase(index: number, phaseTick = 0) {
    const nextPhase = clamp(Math.floor(finite(index, 0)), 0, PHASES.length - 1);
    const nextPhaseTick = clamp(
      Math.floor(finite(phaseTick, 0)),
      0,
      PHASE_TICKS - 1,
    );
    this.recycleAllEntities();
    this.nearMissed.clear();
    this.phaseIndex = nextPhase;
    this.phaseTick = nextPhaseTick;
    this.tick = this.cycle * RUN_TICKS + nextPhase * PHASE_TICKS + nextPhaseTick;
    this.difficulty = this.difficultyAt(this.tick, this.cycle);
    this.phaseTransition = 1;
    this.accumulator = 0;
    this.runComplete = false;
    this.deathReason = null;
    this.core.stability = 3;
    this.core.invulnerable = 0.65;
    this.core.hitFlash = 0;
    this.core.charge = 0;
    this.core.chargeSeconds = 0;
    this.inputActive = false;
    this.inputBuffer.active = false;
    this.inputBuffer.justPressed = false;
    this.inputBuffer.justReleased = false;
    if (this.status === "menu" || this.status === "results") {
      this.status = "playing";
    }
    for (let phase = 0; phase < PHASES.length; phase += 1) {
      this.metrics.phaseCompleted[phase] = phase < nextPhase;
    }
    this.phaseRng = this.createPhaseStream(nextPhase, this.cycle);
    this.seedForcedPhase(nextPhase);
    this.pendingEvents = this.pendingEvents.filter((event) => event.type !== "phase");
    this.pendingEvents.push({
      type: "phase",
      phase: PHASES[nextPhase],
      phaseIndex: nextPhase,
    });
  }

  update(dt: number, input: InputState): GameEvent[] {
    this.ingestInput(input);
    const events = this.pendingEvents.splice(0);

    if (this.status !== "playing" || this.disposed) {
      return events;
    }

    const frameTime = finite(dt, 0);
    if (frameTime <= 0) {
      return events;
    }
    this.accumulator += frameTime;

    let consumeEdges = true;
    while (this.accumulator + 1e-10 >= FIXED_STEP && this.status === "playing") {
      const stepInput: InputState = {
        target: this.inputBuffer.target,
        keyboard: this.inputBuffer.keyboard,
        active: this.inputBuffer.active,
        justPressed: consumeEdges && this.inputBuffer.justPressed,
        justReleased: consumeEdges && this.inputBuffer.justReleased,
        pointerType: this.inputBuffer.pointerType,
      };
      this.step(stepInput, events);
      this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
      if (consumeEdges) {
        this.inputBuffer.justPressed = false;
        this.inputBuffer.justReleased = false;
        consumeEdges = false;
      }
    }

    return events;
  }

  getStatus(): GameStatus {
    return this.status;
  }

  getTick(): number {
    return this.tick;
  }

  getPhaseIndex(): number {
    return this.phaseIndex;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  /**
   * Hot-path view used synchronously by the renderer. Nested objects are
   * read-only by convention and remain owned by the simulation.
   */
  getRenderSnapshot(): GameSnapshot {
    return this.composeSnapshot(false);
  }

  /** Detached diagnostic/test snapshot safe to retain across later ticks. */
  getSnapshot(): GameSnapshot {
    return this.composeSnapshot(true);
  }

  private composeSnapshot(detached: boolean): GameSnapshot {
    const completePhase = this.runComplete && this.phaseIndex === PHASES.length - 1;
    const phaseTime = completePhase ? 10 : this.phaseTick * FIXED_STEP;
    const phaseProgress = completePhase ? 1 : clamp(this.phaseTick / PHASE_TICKS, 0, 1);

    return {
      status: this.status,
      mode: this.mode,
      seed: this.seed,
      tick: this.tick,
      elapsed: this.tick * FIXED_STEP,
      cycle: this.cycle,
      phaseIndex: this.phaseIndex,
      phase: PHASES[this.phaseIndex],
      phaseTime,
      phaseProgress,
      phaseTransition: this.phaseTransition,
      difficulty: this.difficulty,
      width: this.width,
      height: this.height,
      core: detached ? { ...this.core } : this.core,
      entities: detached ? this.entities.map((entity) => ({ ...entity })) : this.entities,
      trail: detached ? this.trail.map((point) => ({ ...point })) : this.trail,
      metrics: detached
        ? {
            ...this.metrics,
            phaseScores: [...this.metrics.phaseScores],
            phaseCompleted: [...this.metrics.phaseCompleted],
          }
        : this.metrics,
      shake: this.shake,
      flash: this.flash,
      timeScale: this.timeScale,
      lastChain: this.lastChain,
      runComplete: this.runComplete,
      deathReason: this.deathReason,
    };
  }

  end(reason = "run ended") {
    if (this.status !== "playing" && this.status !== "paused") {
      return;
    }
    this.finishAsGameOver(reason, this.pendingEvents);
  }

  dispose() {
    this.recycleAllEntities();
    this.trail = [];
    this.gameplayHistory = [];
    this.echoPath = [];
    this.pendingEvents = [];
    this.nearMissed.clear();
    this.fragmentPool = [];
    this.accumulator = 0;
    this.status = "menu";
    this.disposed = true;
  }

  private ingestInput(input: InputState) {
    const targetX = finite(input.target?.x, this.inputBuffer.target.x);
    const targetY = finite(input.target?.y, this.inputBuffer.target.y);
    const keyboardX = finite(input.keyboard?.x, 0);
    const keyboardY = finite(input.keyboard?.y, 0);

    const untouchedPointerSentinel =
      !this.hasPointerTarget &&
      targetX === 0 &&
      targetY === 0 &&
      !input.active &&
      !input.justPressed;
    if (!untouchedPointerSentinel) {
      this.hasPointerTarget = true;
      this.inputBuffer.target = {
        x: clamp(targetX, 0, this.width),
        y: clamp(targetY, 0, this.height),
      };
    }
    this.inputBuffer.keyboard = {
      x: clamp(keyboardX, -1, 1),
      y: clamp(keyboardY, -1, 1),
    };
    this.inputBuffer.active = input.active === true;
    this.inputBuffer.justPressed ||= input.justPressed === true;
    this.inputBuffer.justReleased ||= input.justReleased === true;
    this.inputBuffer.pointerType = input.pointerType;
  }

  private step(input: InputState, events: GameEvent[]) {
    this.handleInput(input, events);
    this.updateCore(input);
    this.spawnForCurrentPhase();
    this.updateEntities(events);
    this.resolveCoreContacts(events);
    this.removeExpiredEntities();
    this.updateFeedback();
    this.recordGameplayHistory();
    this.recordTrail();
    if (this.status === "playing") {
      this.advanceClock(events);
    }
  }

  private handleInput(input: InputState, events: GameEvent[]) {
    const pressed = input.justPressed || (input.active && !this.inputActive);
    const released = input.justReleased || (!input.active && this.inputActive);

    if (pressed && !this.inputActive) {
      this.inputActive = true;
      this.core.chargeSeconds = 0;
      this.core.charge = 0;
      events.push({ type: "charge-start" });
    }

    if (this.inputActive) {
      this.core.chargeSeconds += FIXED_STEP;
      const normalized = clamp(this.core.chargeSeconds / 1.35, 0, 1);
      this.core.charge = normalized * normalized * (3 - 2 * normalized);
    }

    if (released && this.inputActive) {
      this.fireNova(events, input.target);
      this.inputActive = false;
    } else if (!input.active && !pressed) {
      this.inputActive = false;
    }

    if (input.justPressed && input.justReleased) {
      this.inputActive = false;
    } else if (!input.justReleased) {
      this.inputActive = input.active || this.inputActive;
    }
  }

  private updateCore(input: InputState) {
    const keyboardMagnitude = length(input.keyboard.x, input.keyboard.y);
    let targetX = input.target.x;
    let targetY = input.target.y;

    if (keyboardMagnitude > 0.05) {
      const reach = clamp(Math.min(this.width, this.height) * 0.34, 90, 260);
      targetX = this.core.x + (input.keyboard.x / keyboardMagnitude) * reach;
      targetY = this.core.y + (input.keyboard.y / keyboardMagnitude) * reach;
    }

    targetX = clamp(finite(targetX, this.core.x), 0, this.width);
    targetY = clamp(finite(targetY, this.core.y), 0, this.height);

    const spring = this.inputActive ? 29 : 34;
    const damping = this.inputActive ? 8.4 : 9.2;
    let accelerationX = (targetX - this.core.x) * spring - this.core.vx * damping;
    let accelerationY = (targetY - this.core.y) * spring - this.core.vy * damping;
    const acceleration = length(accelerationX, accelerationY);
    const maximumAcceleration = clamp(Math.min(this.width, this.height) * 6.2, 900, 2800);
    if (acceleration > maximumAcceleration) {
      accelerationX = (accelerationX / acceleration) * maximumAcceleration;
      accelerationY = (accelerationY / acceleration) * maximumAcceleration;
    }

    this.core.vx += accelerationX * FIXED_STEP;
    this.core.vy += accelerationY * FIXED_STEP;

    if (this.phaseIndex === 2 || this.phaseIndex === 5) {
      const flow = this.sampleFlowField(this.core.x, this.core.y);
      const influence = this.phaseIndex === 2 ? 0.72 : 0.24;
      this.core.vx += flow.x * influence * FIXED_STEP;
      this.core.vy += flow.y * influence * FIXED_STEP;
    }

    const speed = length(this.core.vx, this.core.vy);
    const maximumSpeed = clamp(Math.min(this.width, this.height) * 0.82, 260, 620);
    if (speed > maximumSpeed) {
      this.core.vx = (this.core.vx / speed) * maximumSpeed;
      this.core.vy = (this.core.vy / speed) * maximumSpeed;
    }

    this.core.x += this.core.vx * FIXED_STEP;
    this.core.y += this.core.vy * FIXED_STEP;
    this.clampCoreToArena();
  }

  private fireNova(events: GameEvent[], target: InputState["target"]) {
    const captured = this.entities.filter((entity) => entity.captured && entity.age < entity.life);
    const capturedIds = new Set(captured.map((entity) => entity.id));
    const totalMass = captured.reduce((sum, entity) => sum + entity.mass, 0);
    let configurationX = 0;
    let configurationY = 0;

    for (const entity of captured) {
      configurationX += (entity.x - this.core.x) * entity.mass;
      configurationY += (entity.y - this.core.y) * entity.mass;
    }

    const configuredLength = length(configurationX, configurationY);
    const averageRadius = totalMass > 0 ? configuredLength / totalMass : 0;
    const asymmetry = totalMass > 0 ? clamp(averageRadius / 72, 0.12, 1) : 0;
    const chargeStrength = Math.max(0.08, this.core.charge);
    const massBoost = 1 + Math.min(totalMass, 10) * 0.055;
    const strength = clamp(chargeStrength * massBoost, 0.08, 1.35);
    let pathDirectionX = finite(target.x, this.core.x) - this.core.x;
    let pathDirectionY = finite(target.y, this.core.y) - this.core.y;
    let pathDirectionLength = length(pathDirectionX, pathDirectionY);
    if (pathDirectionLength <= 0.001) {
      pathDirectionX = this.core.vx;
      pathDirectionY = this.core.vy;
      pathDirectionLength = length(pathDirectionX, pathDirectionY);
    }
    if (pathDirectionLength <= 0.001) {
      pathDirectionX = 1;
      pathDirectionY = 0;
    } else {
      pathDirectionX /= pathDirectionLength;
      pathDirectionY /= pathDirectionLength;
    }

    let recoilDirectionX = 0;
    let recoilDirectionY = 0;
    if (configuredLength > 0.001) {
      recoilDirectionX = -configurationX / configuredLength;
      recoilDirectionY = -configurationY / configuredLength;
    } else if (captured.length === 0) {
      const targetVectorX = finite(target.x, this.core.x) - this.core.x;
      const targetVectorY = finite(target.y, this.core.y) - this.core.y;
      const targetLength = length(targetVectorX, targetVectorY);
      if (targetLength > 0.001) {
        recoilDirectionX = -targetVectorX / targetLength;
        recoilDirectionY = -targetVectorY / targetLength;
      }
    }

    const recoilMagnitude = captured.length > 0
      ? (30 + strength * 92) * asymmetry
      : 16 * strength;
    const recoilX = recoilDirectionX * recoilMagnitude;
    const recoilY = recoilDirectionY * recoilMagnitude;
    this.core.vx += recoilX;
    this.core.vy += recoilY;
    this.core.recoilX = recoilX;
    this.core.recoilY = recoilY;

    for (const entity of captured) {
      const offsetX = entity.x - this.core.x;
      const offsetY = entity.y - this.core.y;
      const distance = Math.max(1, length(offsetX, offsetY));
      const outwardX = offsetX / distance;
      const outwardY = offsetY / distance;
      const tangentX = -outwardY;
      const tangentY = outwardX;
      const launch = 155 + strength * 285;
      entity.captured = false;
      entity.vx = this.core.vx + outwardX * launch + tangentX * (50 + strength * 75);
      entity.vy = this.core.vy + outwardY * launch + tangentY * (50 + strength * 75);
      entity.dangerous = entity.kind === "fragment" && entity.radius >= 6;
    }

    if (captured.length > 0) {
      this.awardFlux(Math.round(5 + totalMass * 4), true);
    }

    const waveRadius = 68 + strength * 68;
    const initialCrystals: Entity[] = [];
    const initialSwarm: Entity[] = [];
    let clearedFlow = 0;
    for (const entity of this.entities) {
      if (entity.age >= entity.life || entity.captured) {
        continue;
      }
      const offsetX = entity.x - this.core.x;
      const offsetY = entity.y - this.core.y;
      const distance = Math.max(1, length(offsetX, offsetY));
      const insideWave = distance <= waveRadius + entity.radius;
      const projection = offsetX * pathDirectionX + offsetY * pathDirectionY;
      const perpendicular = Math.abs(offsetX * pathDirectionY - offsetY * pathDirectionX);
      const flowCorridor =
        (this.phaseIndex === 2 || this.phaseIndex === 5) &&
        (entity.kind === "droplet" || entity.kind === "vortex") &&
        projection >= -18 &&
        projection <= 220 + strength * 180 &&
        perpendicular <= 28 + strength * 42;
      if (!insideWave && !flowCorridor) {
        continue;
      }

      if (entity.kind === "crystal" && entity.vulnerable && insideWave) {
        initialCrystals.push(entity);
      } else if (entity.kind === "swarm" && insideWave) {
        if (capturedIds.has(entity.id)) {
          entity.state = -18;
          entity.dangerous = false;
        } else if (entity.state >= 0) {
          initialSwarm.push(entity);
        }
      } else if (entity.kind === "droplet" || entity.kind === "vortex") {
        const wasDangerous = entity.dangerous;
        entity.state = -Math.round(52 + strength * 92);
        entity.dangerous = false;
        entity.vx += (offsetX / distance) * (90 + strength * 260);
        entity.vy += (offsetY / distance) * (90 + strength * 260);
        if (wasDangerous) {
          clearedFlow += 1;
        }
      } else if (entity.kind === "echo" && insideWave) {
        entity.state = -Math.round(46 + strength * 70);
        entity.dangerous = false;
      } else if (entity.kind === "fragment" || entity.kind === "orbiter") {
        const force = (1 - clamp(distance / (waveRadius + entity.radius), 0, 1)) * (180 + strength * 420);
        entity.vx += (offsetX / distance) * force;
        entity.vy += (offsetY / distance) * force;
        if (entity.kind === "fragment" && entity.radius < 5.5 && strength > 0.55) {
          entity.life = entity.age;
          this.awardFlux(Math.max(1, Math.round(entity.value * 0.35)), false);
        }
      }
    }

    if (initialCrystals.length > 0) {
      this.resolveFractures(initialCrystals, strength, events, 1);
    }
    if (initialSwarm.length > 0) {
      this.resolveSwarmBreaks(initialSwarm, strength, events);
    }
    if (clearedFlow > 0) {
      this.awardFlux(clearedFlow * 4, true);
    }

    this.metrics.novaCount += 1;
    this.core.novaAge = 0;
    this.core.novaStrength = strength;
    this.core.charge = 0;
    this.core.chargeSeconds = 0;
    this.flash = Math.max(this.flash, 0.2 + strength * 0.34);
    this.shake = Math.max(this.shake, this.reducedMotion ? 0.08 : 0.2 + strength * 0.32);
    events.push({
      type: "nova",
      x: this.core.x,
      y: this.core.y,
      strength,
      captured: captured.length,
    });
  }

  private spawnForCurrentPhase() {
    if (this.phaseIndex === 0) {
      this.spawnOrbitTick();
    } else if (this.phaseIndex === 1) {
      this.spawnFractureTick();
    } else if (this.phaseIndex === 2) {
      this.spawnFlowTick();
    } else if (this.phaseIndex === 3) {
      this.spawnEchoTick();
    } else if (this.phaseIndex === 4) {
      this.spawnSwarmTick();
    } else {
      this.spawnNovaTick();
    }
  }

  private spawnOrbitTick() {
    if (this.phaseTick > 0 && this.phaseTick % 90 === 0) {
      this.spawnEnergy(false);
    }
    if (this.phaseTick === 150 || this.phaseTick === 420) {
      this.spawnGate();
    }
    if (this.phaseTick === 250) {
      this.spawnOrbiter(true);
    }
    if (this.phaseTick >= 310 && this.phaseTick % 105 === 0) {
      this.spawnOrbiter(false);
    }
  }

  private spawnFractureTick() {
    if (this.phaseTick > 0 && this.phaseTick % 105 === 0) {
      this.spawnEnergy(false);
    }
    if (this.phaseTick === 155 || this.phaseTick === 395) {
      this.spawnCrystalCluster(false);
    }
    if (this.phaseTick === 290) {
      this.spawnGate();
    }
  }

  private spawnFlowTick() {
    if (this.phaseTick === 36 || this.phaseTick === 238 || this.phaseTick === 470) {
      this.spawnEnergy(false);
    }
    if (this.phaseTick === 145 || this.phaseTick === 365) {
      this.spawnFlowRibbon(6, false);
    }
    if (this.phaseTick === 275) {
      this.spawnVortex(false);
    }
    if (this.phaseTick === 430) {
      this.spawnGate();
    }
  }

  private spawnEchoTick() {
    if (this.phaseTick === 42 || this.phaseTick === 255 || this.phaseTick === 470) {
      this.spawnEnergy(false);
    }
    if ((this.phaseTick === 205 || this.phaseTick === 365) && this.cycle > 0) {
      this.spawnEchoHead(false);
    }
    if (this.phaseTick === 335) {
      this.spawnGate();
    }
  }

  private spawnSwarmTick() {
    if (this.phaseTick === 35 || this.phaseTick === 250 || this.phaseTick === 475) {
      this.spawnEnergy(false);
    }
    if (this.phaseTick === 155) {
      this.spawnSwarmFormation(6, false);
    } else if (this.phaseTick === 325) {
      this.spawnSwarmFormation(7, false);
    } else if (this.phaseTick === 490 && this.cycle > 0) {
      this.spawnSwarmFormation(5, false);
    }
    if (this.phaseTick === 410) {
      this.spawnGate();
    }
  }

  private spawnNovaTick() {
    if (
      this.phaseTick === 35 ||
      this.phaseTick === 180 ||
      this.phaseTick === 335 ||
      this.phaseTick === 515
    ) {
      this.spawnEnergy(false);
    }
    if (
      this.phaseTick === 75 ||
      this.phaseTick === 235 ||
      this.phaseTick === 395 ||
      this.phaseTick === 540
    ) {
      this.spawnCollapseOrbiter();
    }
    if (this.phaseTick === 135 || this.phaseTick === 425) {
      this.spawnCrystalCluster(false);
    }
    if (this.phaseTick === 205) {
      this.spawnSwarmFormation(6, true);
    } else if (this.phaseTick === 315 || this.phaseTick === 500) {
      this.spawnSwarmFormation(5, true);
    }
    if (this.phaseTick === 285) {
      this.spawnVortex(true);
    }
    if (this.phaseTick === 455) {
      this.spawnEchoHead(true);
    }
  }

  private updateEntities(events: GameEvent[]) {
    const activeAtStart = this.entities.length;
    const worldScale = this.inputActive ? 0.86 + this.core.charge * 0.06 : 1;
    this.swarmFrame = this.entities
      .filter((entity) => entity.kind === "swarm" && entity.age < entity.life && entity.health > 0)
      .map(({ id, x, y, vx, vy, state, captured }) => ({
        id,
        x,
        y,
        vx,
        vy,
        state,
        captured,
      }));

    for (let index = 0; index < activeAtStart; index += 1) {
      const entity = this.entities[index];
      if (entity.health <= 0 || entity.age >= entity.life) {
        continue;
      }

      entity.age += FIXED_STEP;
      entity.rotation += entity.spin * FIXED_STEP * worldScale;
      let directPosition = false;

      if (entity.captured) {
        this.updateCapturedEntity(entity, worldScale);
      } else if (entity.kind === "echo") {
        this.updateEchoEntity(entity);
        directPosition = true;
      } else {
        this.updateFreeEntity(entity, worldScale);
        if (this.inputActive) {
          this.applyAttraction(entity);
        }
      }

      if (this.phaseIndex === 5 && !entity.captured && entity.kind !== "echo") {
        this.applyNovaCollapse(entity);
      }

      const stationaryVortex = entity.kind === "vortex" && this.phaseIndex !== 5;
      if (
        entity.kind !== "gate" &&
        !stationaryVortex &&
        !entity.captured &&
        !directPosition
      ) {
        entity.x += entity.vx * FIXED_STEP * worldScale;
        entity.y += entity.vy * FIXED_STEP * worldScale;
        this.bounceEntity(entity);
      }

      if (entity.life - entity.age < 0.5) {
        entity.alpha = clamp((entity.life - entity.age) * 2, 0, 1);
      }

      if (entity.kind === "fragment" && entity.dangerous) {
        this.resolveFragmentCrystalContact(entity, events);
      }
    }
    this.swarmFrame = [];
  }

  private updateCapturedEntity(entity: Entity, worldScale: number) {
    const direction = entity.seed % 2 === 0 ? 1 : -1;
    const angularSpeed = direction * (2.5 + this.core.charge * 4.4) / Math.sqrt(Math.max(0.5, entity.mass));
    entity.captureAngle += angularSpeed * FIXED_STEP * worldScale;
    const minimumRadius = this.core.radius + entity.radius + 6;
    const contraction = 1 - this.core.charge * 0.48;
    const desiredRadius = Math.max(minimumRadius, entity.captureRadius * contraction);
    const previousX = entity.x;
    const previousY = entity.y;
    entity.x = this.core.x + Math.cos(entity.captureAngle) * desiredRadius;
    entity.y = this.core.y + Math.sin(entity.captureAngle) * desiredRadius;
    this.clampEntityToArena(entity);
    entity.vx = (entity.x - previousX) / FIXED_STEP;
    entity.vy = (entity.y - previousY) / FIXED_STEP;
    entity.dangerous = false;
  }

  private updateFreeEntity(entity: Entity, worldScale: number) {
    if (entity.kind === "orbiter") {
      const offsetX = this.core.x - entity.x;
      const offsetY = this.core.y - entity.y;
      const distance = Math.max(24, length(offsetX, offsetY));
      const gravity = Math.min(330, 520_000 / (distance * distance + 1_200));
      entity.vx += (offsetX / distance) * gravity * FIXED_STEP * worldScale;
      entity.vy += (offsetY / distance) * gravity * FIXED_STEP * worldScale;
      entity.vx *= 0.999;
      entity.vy *= 0.999;
    } else if (entity.kind === "energy") {
      entity.vx *= 0.993;
      entity.vy *= 0.993;
      entity.rotation += 0.8 * FIXED_STEP;
    } else if (entity.kind === "crystal") {
      entity.vx *= 0.996;
      entity.vy *= 0.996;
      if (entity.state === 1 && entity.age > 0.9) {
        entity.dangerous = true;
      }
    } else if (entity.kind === "fragment") {
      entity.vx *= 0.994;
      entity.vy *= 0.994;
      if (entity.age > 0.18 && entity.radius >= 6) {
        entity.dangerous = true;
      }
    } else if (entity.kind === "swarm") {
      this.updateSwarmEntity(entity, worldScale);
    } else if (entity.kind === "droplet") {
      this.updateFlowDroplet(entity, worldScale);
    } else if (entity.kind === "vortex") {
      this.updateVortex(entity);
    }
  }

  private sampleFlowField(x: number, y: number) {
    const normalizedX = x / Math.max(1, this.width);
    const normalizedY = y / Math.max(1, this.height);
    const time = (this.phaseTick + this.cycle * PHASE_TICKS) * FIXED_STEP;
    const seedPhase = (this.seed % 997) / 997 * TAU;
    let flowX = 58 + Math.sin(normalizedY * TAU * 1.45 + time * 0.72 + seedPhase) * 34;
    let flowY = Math.cos(normalizedX * TAU * 1.2 - time * 0.54 + seedPhase * 0.7) * 42;

    for (const vortex of this.entities) {
      if (vortex.kind !== "vortex" || vortex.age >= vortex.life || vortex.health <= 0) {
        continue;
      }
      const offsetX = x - vortex.x;
      const offsetY = y - vortex.y;
      const distance = Math.max(8, length(offsetX, offsetY));
      const range = vortex.radius * 6.2;
      if (distance >= range) {
        continue;
      }
      const falloff = 1 - distance / range;
      const direction = vortex.seed % 2 === 0 ? 1 : -1;
      const stunScale = vortex.state < 0 ? 0.2 : 1;
      const swirl = falloff * falloff * (150 + this.difficulty * 18) * direction * stunScale;
      const inward = falloff * 34 * stunScale;
      flowX += (-offsetY / distance) * swirl - (offsetX / distance) * inward;
      flowY += (offsetX / distance) * swirl - (offsetY / distance) * inward;
    }

    return { x: flowX, y: flowY };
  }

  private updateFlowDroplet(entity: Entity, worldScale: number) {
    const stunned = entity.state < 0;
    if (stunned) {
      entity.state += 1;
      entity.dangerous = false;
    } else if (entity.age > 0.58) {
      entity.dangerous = entity.seed % 3 === 0;
    }

    const flow = this.sampleFlowField(entity.x, entity.y);
    const responsiveness = stunned ? 0.022 : 0.065;
    const wobble = Math.sin((this.phaseTick + entity.seed % 181) * 0.047) * 18;
    entity.vx += (flow.x - entity.vx) * responsiveness * worldScale;
    entity.vy += (flow.y + wobble - entity.vy) * responsiveness * worldScale;
    const speed = length(entity.vx, entity.vy);
    const maximum = 165 + Math.min(35, this.difficulty * 9);
    if (speed > maximum) {
      entity.vx = entity.vx / speed * maximum;
      entity.vy = entity.vy / speed * maximum;
    }
  }

  private updateVortex(entity: Entity) {
    if (entity.state < 0) {
      entity.state += 1;
      entity.dangerous = false;
      entity.alpha = Math.max(0.48, entity.alpha * 0.995);
    } else {
      entity.dangerous = entity.vulnerable && entity.age > 0.78;
      entity.alpha = Math.min(1, entity.alpha + 0.025);
    }
    entity.rotation += (entity.seed % 2 === 0 ? 1 : -1) * FIXED_STEP * 0.75;
  }

  private updateEchoEntity(entity: Entity) {
    if (this.echoPath.length < 2) {
      this.echoPath = this.makeFallbackEchoPath();
    }
    const pathLength = this.echoPath.length;
    const period = Math.max(2, (pathLength - 1) * 2);
    const offset = entity.seed % pathLength;
    const travel = (this.phaseTick * 0.62 + offset) % period;
    const reflected = travel <= pathLength - 1 ? travel : period - travel;
    const firstIndex = Math.floor(reflected);
    const secondIndex = Math.min(pathLength - 1, firstIndex + 1);
    const blend = reflected - firstIndex;
    const first = this.echoPath[firstIndex];
    const second = this.echoPath[secondIndex];
    const previousX = entity.x;
    const previousY = entity.y;
    entity.x = first.x + (second.x - first.x) * blend;
    entity.y = first.y + (second.y - first.y) * blend;
    entity.vx = (entity.x - previousX) / FIXED_STEP;
    entity.vy = (entity.y - previousY) / FIXED_STEP;
    this.clampEntityToArena(entity);

    if (entity.state < 0) {
      entity.state += 1;
      entity.dangerous = false;
    } else {
      const replayWindow = (this.phaseTick + entity.seed % 241) % 241;
      entity.dangerous = entity.age > 0.55 && replayWindow >= 62 && replayWindow <= 166;
    }
  }

  private updateSwarmEntity(entity: Entity, worldScale: number) {
    if (entity.state < 0) {
      entity.state += 1;
      entity.dangerous = false;
      entity.vx *= 0.982;
      entity.vy *= 0.982;
      return;
    }

    let separationX = 0;
    let separationY = 0;
    let alignmentX = 0;
    let alignmentY = 0;
    let cohesionX = 0;
    let cohesionY = 0;
    let neighbors = 0;
    for (const neighbor of this.swarmFrame) {
      if (neighbor.id === entity.id || neighbor.captured || neighbor.state < 0) {
        continue;
      }
      const offsetX = neighbor.x - entity.x;
      const offsetY = neighbor.y - entity.y;
      const distance = length(offsetX, offsetY);
      if (distance <= 0.001 || distance > 96) {
        continue;
      }
      neighbors += 1;
      alignmentX += neighbor.vx;
      alignmentY += neighbor.vy;
      cohesionX += neighbor.x;
      cohesionY += neighbor.y;
      if (distance < 30) {
        const strength = 1 - distance / 30;
        separationX -= offsetX / distance * strength;
        separationY -= offsetY / distance * strength;
      }
    }

    let accelerationX = separationX * 155;
    let accelerationY = separationY * 155;
    if (neighbors > 0) {
      const inverse = 1 / neighbors;
      accelerationX += (alignmentX * inverse - entity.vx) * 0.78;
      accelerationY += (alignmentY * inverse - entity.vy) * 0.78;
      accelerationX += (cohesionX * inverse - entity.x) * 0.3;
      accelerationY += (cohesionY * inverse - entity.y) * 0.3;
    }

    const prediction = 0.28 + Math.min(0.42, Math.max(0, this.difficulty - 1) * 0.18);
    const targetX = this.core.x + this.core.vx * prediction;
    const targetY = this.core.y + this.core.vy * prediction;
    const targetOffsetX = targetX - entity.x;
    const targetOffsetY = targetY - entity.y;
    const targetDistance = Math.max(1, length(targetOffsetX, targetOffsetY));
    const pursuit = 34 + this.difficulty * 12;
    accelerationX += targetOffsetX / targetDistance * pursuit;
    accelerationY += targetOffsetY / targetDistance * pursuit;

    entity.vx += accelerationX * FIXED_STEP * worldScale;
    entity.vy += accelerationY * FIXED_STEP * worldScale;
    const speed = length(entity.vx, entity.vy);
    const maximum = Math.min(195, 104 + this.difficulty * 22 + this.cycle * 7);
    if (speed > maximum) {
      entity.vx = entity.vx / speed * maximum;
      entity.vy = entity.vy / speed * maximum;
    }
    const diveTick = (this.phaseTick + entity.seed % 181) % 181;
    entity.dangerous = entity.age > 0.72 && diveTick >= 58 && diveTick <= 142;
  }

  private applyNovaCollapse(entity: Entity) {
    if (entity.kind === "gate") {
      return;
    }
    const offsetX = this.core.x - entity.x;
    const offsetY = this.core.y - entity.y;
    const distance = Math.max(1, length(offsetX, offsetY));
    const progress = clamp(this.phaseTick / PHASE_TICKS, 0, 1);
    const finale = progress > 0.5 ? (progress - 0.5) * 2 : 0;
    const stunnedScale = entity.state < 0 ? 0.28 : 1;
    const kindScale = entity.kind === "energy"
      ? 0.5
      : entity.kind === "fragment"
        ? 0.62
        : 1;
    const acceleration = (14 + progress * progress * 68 + finale * 28) * stunnedScale * kindScale;
    entity.vx += offsetX / distance * acceleration * FIXED_STEP;
    entity.vy += offsetY / distance * acceleration * FIXED_STEP;
  }

  private applyAttraction(entity: Entity) {
    if (entity.kind === "gate" || entity.kind === "vortex" || entity.kind === "crystal") {
      return;
    }

    const offsetX = this.core.x - entity.x;
    const offsetY = this.core.y - entity.y;
    const distance = Math.max(1, length(offsetX, offsetY));
    const range = entity.kind === "energy" ? 285 : 126 + this.core.charge * 86;
    if (distance > range) {
      return;
    }

    const falloff = 1 - distance / range;
    const acceleration = falloff * falloff * (260 + this.core.charge * 1_020) / Math.max(0.45, entity.mass);
    entity.vx += (offsetX / distance) * acceleration * FIXED_STEP;
    entity.vy += (offsetY / distance) * acceleration * FIXED_STEP;

    const capturable = entity.vulnerable && (
      entity.kind === "orbiter" ||
      entity.kind === "fragment" ||
      entity.kind === "droplet" ||
      entity.kind === "swarm"
    );
    if (capturable && distance < range * 0.92) {
      entity.captured = true;
      entity.captureAngle = Math.atan2(entity.y - this.core.y, entity.x - this.core.x);
      entity.captureRadius = Math.max(this.core.radius + entity.radius + 8, distance);
      entity.dangerous = false;
    }
  }

  private resolveCoreContacts(events: GameEvent[]) {
    for (const entity of this.entities) {
      if (entity.age >= entity.life || entity.health <= 0 || entity.captured) {
        continue;
      }

      const offsetX = entity.x - this.core.x;
      const offsetY = entity.y - this.core.y;
      const distance = entity.kind === "echo"
        ? pointSegmentDistance(
          this.core.x,
          this.core.y,
          entity.x - entity.vx * FIXED_STEP,
          entity.y - entity.vy * FIXED_STEP,
          entity.x,
          entity.y,
        )
        : length(offsetX, offsetY);

      if (entity.kind === "energy" && distance <= this.core.radius + entity.radius + 3) {
        entity.life = entity.age;
        this.metrics.energyCollected += 1;
        const awarded = this.awardFlux(entity.value, true);
        events.push({
          type: "collect",
          x: entity.x,
          y: entity.y,
          value: entity.value,
          awarded,
          combo: this.metrics.combo,
        });
        continue;
      }

      if (entity.kind === "gate" && distance <= this.core.radius + entity.radius) {
        entity.life = entity.age;
        const bankedBefore = this.metrics.bankedScore;
        this.awardFlux(entity.value, true);
        this.bankFlux();
        events.push({
          type: "gate",
          x: entity.x,
          y: entity.y,
          value: entity.value,
          banked: this.metrics.bankedScore - bankedBefore,
        });
        continue;
      }

      if (!entity.dangerous) {
        continue;
      }

      const collisionRadius = this.core.radius + entity.radius * 0.76;
      if (distance <= collisionRadius) {
        if (this.core.invulnerable <= 0 && !(this.cycle === 0 && this.tick < 300)) {
          this.hitCore(entity, events);
        }
        continue;
      }

      const relativeSpeed = length(entity.vx - this.core.vx, entity.vy - this.core.vy);
      const nearRadius = collisionRadius + clamp(relativeSpeed * 0.035, 13, 25);
      if (
        distance <= nearRadius &&
        relativeSpeed > 30 &&
        !this.nearMissed.has(entity.id)
      ) {
        this.nearMissed.add(entity.id);
        this.metrics.nearMisses += 1;
        const awarded = this.awardFlux(6, true);
        events.push({ type: "near-miss", x: entity.x, y: entity.y, awarded });
      }
    }
  }

  private hitCore(entity: Entity, events: GameEvent[]) {
    const lostFlux = this.metrics.unbankedFlux;
    this.core.stability = Math.max(0, this.core.stability - 1);
    this.core.invulnerable = 1.05;
    this.core.hitFlash = 0.34;
    this.metrics.collisions += 1;
    this.metrics.unbankedFlux = 0;
    this.metrics.combo = 0;
    this.metrics.score = this.metrics.bankedScore;
    this.comboTicks = 0;
    this.shake = Math.max(this.shake, this.reducedMotion ? 0.12 : 0.75);
    this.flash = Math.max(this.flash, 0.44);

    const offsetX = this.core.x - entity.x;
    const offsetY = this.core.y - entity.y;
    const distance = Math.max(1, length(offsetX, offsetY));
    this.core.vx += (offsetX / distance) * 115;
    this.core.vy += (offsetY / distance) * 115;
    entity.dangerous = false;
    entity.life = Math.min(entity.life, entity.age + 0.12);

    events.push({
      type: "hit",
      x: this.core.x,
      y: this.core.y,
      stability: this.core.stability,
      lostFlux,
    });

    if (this.core.stability <= 0) {
      this.finishAsGameOver("core destabilized", events);
    }
  }

  private resolveFragmentCrystalContact(fragment: Entity, events: GameEvent[]) {
    const speed = length(fragment.vx, fragment.vy);
    if (speed < 115) {
      return;
    }
    for (const crystal of this.entities) {
      if (
        crystal.kind !== "crystal" ||
        crystal.health <= 0 ||
        crystal.age >= crystal.life ||
        !crystal.vulnerable
      ) {
        continue;
      }
      if (length(fragment.x - crystal.x, fragment.y - crystal.y) <= fragment.radius + crystal.radius) {
        fragment.life = Math.min(fragment.life, fragment.age + 0.15);
        this.resolveFractures([crystal], clamp(speed / 420, 0.3, 1), events, 2);
        return;
      }
    }
  }

  private resolveFractures(
    initial: Entity[],
    strength: number,
    events: GameEvent[],
    startingChain: number,
  ) {
    const queue: Array<{ crystal: Entity; chain: number }> = initial.map((crystal) => ({
      crystal,
      chain: startingChain,
    }));
    const queued = new Set(initial.map((crystal) => crystal.id));
    let shattered = 0;
    let maximumChain = startingChain;

    while (queue.length > 0 && shattered < 14) {
      const item = queue.shift();
      if (!item) {
        break;
      }
      const crystal = item.crystal;
      if (crystal.health <= 0 || crystal.age >= crystal.life) {
        continue;
      }

      crystal.health = 0;
      crystal.life = crystal.age;
      crystal.dangerous = false;
      shattered += 1;
      maximumChain = Math.max(maximumChain, item.chain);
      this.spawnCrystalFragments(crystal, strength, item.chain);
      this.awardFlux(Math.round(crystal.value * (1 + item.chain * 0.16)), true);
      events.push({
        type: "fracture",
        x: crystal.x,
        y: crystal.y,
        chain: item.chain,
        strength,
      });

      const linkRadius = 78 + strength * 48 + Math.min(item.chain, 5) * 5;
      for (const candidate of this.entities) {
        if (
          candidate.kind !== "crystal" ||
          candidate.health <= 0 ||
          candidate.age >= candidate.life ||
          queued.has(candidate.id)
        ) {
          continue;
        }
        if (length(candidate.x - crystal.x, candidate.y - crystal.y) <= linkRadius) {
          queued.add(candidate.id);
          queue.push({ crystal: candidate, chain: item.chain + 1 });
        }
      }
    }

    if (shattered > 0) {
      this.lastChain = shattered;
      this.metrics.largestChain = Math.max(this.metrics.largestChain, shattered);
      this.flash = Math.max(this.flash, 0.34 + Math.min(shattered, 8) * 0.035);
      this.shake = Math.max(
        this.shake,
        this.reducedMotion ? 0.12 : 0.28 + Math.min(maximumChain, 6) * 0.08,
      );
    }
  }

  private resolveSwarmBreaks(initial: Entity[], strength: number, events: GameEvent[]) {
    const first = [...initial].sort((left, right) => (
      length(left.x - this.core.x, left.y - this.core.y) -
      length(right.x - this.core.x, right.y - this.core.y)
    ))[0];
    if (!first) {
      return;
    }

    const queue: Array<{ member: Entity; chain: number }> = [{ member: first, chain: 1 }];
    const queued = new Set<number>([first.id]);
    let broken = 0;
    let maximumChain = 1;

    while (queue.length > 0 && broken < 16) {
      const item = queue.shift();
      if (!item) {
        break;
      }
      const member = item.member;
      if (member.age >= member.life || member.health <= 0) {
        continue;
      }

      const offsetX = member.x - this.core.x;
      const offsetY = member.y - this.core.y;
      const distance = Math.max(1, length(offsetX, offsetY));
      member.captured = false;
      member.state = -Math.round(52 + strength * 68);
      member.dangerous = false;
      member.vx += offsetX / distance * (145 + strength * 240);
      member.vy += offsetY / distance * (145 + strength * 240);
      broken += 1;
      maximumChain = Math.max(maximumChain, item.chain);
      this.awardFlux(Math.round(member.value * (1 + item.chain * 0.1)), true);
      if (broken <= 6) {
        events.push({
          type: "fracture",
          x: member.x,
          y: member.y,
          chain: item.chain,
          strength,
        });
      }

      const linkRadius = 62 + strength * 26;
      for (const candidate of this.entities) {
        if (
          candidate.kind !== "swarm" ||
          candidate.health <= 0 ||
          candidate.age >= candidate.life ||
          candidate.state < 0 ||
          queued.has(candidate.id)
        ) {
          continue;
        }
        if (length(candidate.x - member.x, candidate.y - member.y) <= linkRadius) {
          queued.add(candidate.id);
          queue.push({ member: candidate, chain: item.chain + 1 });
        }
      }
    }

    if (broken > 0) {
      this.lastChain = broken;
      this.metrics.largestChain = Math.max(this.metrics.largestChain, broken);
      this.flash = Math.max(this.flash, 0.22 + Math.min(broken, 12) * 0.025);
      this.shake = Math.max(
        this.shake,
        this.reducedMotion ? 0.1 : 0.18 + Math.min(maximumChain, 7) * 0.045,
      );
    }
  }

  private spawnCrystalFragments(crystal: Entity, strength: number, chain: number) {
    const stream = new RandomStream(mixSeed(crystal.seed, chain * 0x85ebca6b));
    const count = clamp(stream.integer(4, 6), 4, 6);
    const baseDirection = Math.atan2(crystal.y - this.core.y, crystal.x - this.core.x);

    for (let index = 0; index < count; index += 1) {
      if (this.countKind("fragment") >= MAX_FRAGMENTS || this.entities.length >= MAX_ENTITIES) {
        break;
      }
      const spread = ((index + 0.5) / count - 0.5) * 1.7;
      const angle = baseDirection + spread + stream.range(-0.16, 0.16);
      const speed = stream.range(125, 215) + strength * 165 + chain * 12;
      const radius = clamp(crystal.radius * stream.range(0.32, 0.52), 5.5, 10.5);
      this.spawnFragment({
        x: crystal.x + Math.cos(angle) * crystal.radius * 0.3,
        y: crystal.y + Math.sin(angle) * crystal.radius * 0.3,
        vx: crystal.vx + Math.cos(angle) * speed,
        vy: crystal.vy + Math.sin(angle) * speed,
        radius,
        mass: Math.max(0.45, crystal.mass / count),
        rotation: stream.range(0, TAU),
        spin: stream.range(-7.5, 7.5),
        value: Math.max(2, Math.round(crystal.value / count)),
        seed: stream.uint(),
      });
    }
  }

  private updateFeedback() {
    this.core.invulnerable = Math.max(0, this.core.invulnerable - FIXED_STEP);
    this.core.hitFlash = Math.max(0, this.core.hitFlash - FIXED_STEP);
    this.core.novaAge += FIXED_STEP;
    this.core.recoilX *= 0.9;
    this.core.recoilY *= 0.9;
    this.shake *= this.reducedMotion ? 0.72 : 0.86;
    this.flash = Math.max(0, this.flash - FIXED_STEP * 1.9);
    this.timeScale = this.inputActive
      ? clamp(0.94 - this.core.charge * 0.1, 0.82, 0.94)
      : Math.min(1, this.timeScale + FIXED_STEP * 2.5);

    if (this.metrics.combo > 0) {
      this.comboTicks -= 1;
      if (this.comboTicks <= 0) {
        this.metrics.combo = 0;
      }
    }
  }

  private recordGameplayHistory() {
    this.gameplayHistory.push({
      x: this.core.x,
      y: this.core.y,
      tick: this.tick,
      charge: this.core.charge,
    });
    if (this.gameplayHistory.length > MAX_GAMEPLAY_HISTORY) {
      this.gameplayHistory.splice(0, this.gameplayHistory.length - MAX_GAMEPLAY_HISTORY);
    }
  }

  private prepareEchoPath() {
    if (this.gameplayHistory.length >= 120) {
      this.echoPath = this.gameplayHistory.map((point) => ({ ...point }));
    } else {
      this.echoPath = this.makeFallbackEchoPath();
    }
  }

  private makeFallbackEchoPath() {
    const stream = new RandomStream(mixSeed(
      this.seed,
      Math.imul(this.cycle + 1, 0x27d4eb2d) ^ 0xecc011,
    ));
    const count = 240;
    const centerX = this.width * 0.5;
    const centerY = this.height * 0.5;
    const radiusX = clamp(this.width * stream.range(0.2, 0.31), 48, this.width * 0.4);
    const radiusY = clamp(this.height * stream.range(0.16, 0.27), 42, this.height * 0.36);
    const phase = stream.range(0, TAU);
    const path: TrailPoint[] = [];
    for (let index = 0; index < count; index += 1) {
      const progress = index / count;
      const angle = progress * TAU + phase;
      path.push({
        x: clamp(centerX + Math.cos(angle) * radiusX, 18, this.width - 18),
        y: clamp(centerY + Math.sin(angle * 2 + phase * 0.4) * radiusY, 18, this.height - 18),
        tick: this.tick - count + index,
        charge: 0,
      });
    }
    return path;
  }

  private recordTrail() {
    if (this.tick % (this.reducedMotion ? 3 : 2) !== 0) {
      return;
    }
    this.trail.push({
      x: this.core.x,
      y: this.core.y,
      tick: this.tick,
      charge: this.core.charge,
    });
    const maximum = this.reducedMotion ? 48 : MAX_TRAIL;
    if (this.trail.length > maximum) {
      this.trail.splice(0, this.trail.length - maximum);
    }
  }

  private advanceClock(events: GameEvent[]) {
    this.tick += 1;
    this.phaseTick += 1;
    this.phaseTransition = Math.min(1, this.phaseTransition + FIXED_STEP / 0.72);
    this.difficulty = this.difficultyAt(this.tick, this.cycle);

    if (this.phaseTick < PHASE_TICKS) {
      return;
    }

    this.metrics.phaseCompleted[this.phaseIndex] = true;
    this.bankFlux();

    if (this.phaseIndex < PHASES.length - 1) {
      this.phaseIndex += 1;
      this.phaseTick = 0;
      this.beginPhase(this.phaseIndex);
      events.push({
        type: "phase",
        phase: PHASES[this.phaseIndex],
        phaseIndex: this.phaseIndex,
      });
      return;
    }

    if (this.mode === "endless") {
      this.cycle += 1;
      this.phaseIndex = 0;
      this.phaseTick = 0;
      this.difficulty = this.difficultyAt(this.tick, this.cycle);
      this.beginPhase(0);
      events.push({ type: "phase", phase: "ORBIT", phaseIndex: 0 });
      return;
    }

    this.runComplete = true;
    this.deathReason = null;
    this.status = "results";
    this.metrics.score = this.metrics.bankedScore + this.metrics.unbankedFlux;
    events.push({ type: "complete", score: this.metrics.score });
  }

  private beginPhase(index: number) {
    this.phaseTransition = 0;
    this.phaseRng = this.createPhaseStream(index, this.cycle);

    if (index === 0) {
      if (this.cycle === 0) {
        this.seedOpeningOrbit();
      } else {
        for (const entity of this.entities) {
          if (entity.kind !== "energy") {
            entity.dangerous = false;
            entity.life = Math.min(entity.life, entity.age + 0.85);
          }
        }
        this.spawnEnergy(false);
        this.spawnOrbiter(false);
      }
      return;
    }

    if (index === 1) {
      // Existing orbital matter changes material in place. Position, momentum,
      // charge, trail, and Core state all survive the law-change wave.
      for (const entity of this.entities) {
        if (entity.kind !== "orbiter" || entity.age >= entity.life) {
          continue;
        }
        entity.kind = "crystal";
        entity.radius = Math.max(9, entity.radius * 1.25);
        entity.mass *= 1.3;
        entity.vx *= 0.48;
        entity.vy *= 0.48;
        entity.spin *= 0.45;
        entity.vulnerable = true;
        entity.state = entity.dangerous ? 1 : 0;
        entity.dangerous = false;
        entity.phase = 1;
        entity.life = Math.max(entity.life, entity.age + 7);
      }
      this.spawnCrystalCluster(true);
      return;
    }

    if (index === 2) {
      let converted = 0;
      for (const entity of this.entities) {
        if (entity.kind === "fragment" && converted < 8) {
          entity.kind = "droplet";
          entity.radius = clamp(entity.radius, 5.5, 9.5);
          entity.mass = Math.max(0.7, entity.mass);
          entity.state = -40;
          entity.vulnerable = true;
          entity.dangerous = false;
          entity.phase = 2;
          entity.life = Math.max(entity.life, entity.age + 5.5);
          converted += 1;
        } else if (entity.kind !== "energy" && entity.kind !== "gate") {
          entity.life = Math.min(entity.life, entity.age + 1.35);
        }
      }
      this.spawnFlowRibbon(10, true);
      this.spawnVortex(true);
      this.spawnVortex(true);
      this.spawnEnergy(false);
      return;
    }

    if (index === 3) {
      this.prepareEchoPath();
      for (const entity of this.entities) {
        if (entity.kind !== "energy" && entity.kind !== "gate") {
          entity.life = Math.min(entity.life, entity.age + 1.45);
        }
      }
      this.spawnEchoHead(true);
      this.spawnEchoHead(true);
      this.spawnEnergy(false);
      return;
    }

    if (index === 4) {
      for (const entity of this.entities) {
        if (entity.kind !== "energy" && entity.kind !== "gate") {
          entity.life = Math.min(entity.life, entity.age + 1.2);
        }
      }
      this.spawnSwarmFormation(14, true);
      this.spawnEnergy(false);
      return;
    }

    let retainedSwarm = 0;
    let retainedEcho = 0;
    this.prepareEchoPath();
    const curatedEntities: Entity[] = [];
    for (const entity of this.entities) {
      const retain =
        (entity.kind === "swarm" && retainedSwarm++ < 7) ||
        (entity.kind === "echo" && retainedEcho++ < 1) ||
        entity.kind === "energy" ||
        entity.kind === "gate";
      if (retain) {
        entity.phase = 5;
        entity.life = Math.max(entity.life, entity.age + 7);
        curatedEntities.push(entity);
      } else {
        this.nearMissed.delete(entity.id);
        if (entity.kind === "fragment" && this.fragmentPool.length < MAX_FRAGMENTS) {
          this.fragmentPool.push(entity);
        }
      }
    }
    this.entities = curatedEntities;
    this.spawnNovaCuratedSet();
  }

  private difficultyAt(tick: number, cycle: number) {
    const atCycleEnd = tick > 0 && tick === (cycle + 1) * RUN_TICKS;
    const runTick = atCycleEnd ? RUN_TICKS : tick % RUN_TICKS;
    const seconds = runTick * FIXED_STEP;
    let pressure = 0;
    if (seconds <= 5) {
      pressure = 0;
    } else if (seconds <= 20) {
      pressure = (seconds - 5) / 15 * 0.4;
    } else if (seconds <= 40) {
      pressure = 0.4 + (seconds - 20) / 20 * 0.52;
    } else if (seconds <= 55) {
      pressure = 0.92 + (seconds - 40) / 15 * 0.46;
    } else {
      pressure = 1.38 + (seconds - 55) / 5 * 0.3;
    }
    return 1 + Math.max(0, pressure) + cycle * 0.42;
  }

  private createPhaseStream(index: number, cycle: number) {
    const phaseSalt = Math.imul(index + 1, 0x85ebca6b);
    const cycleSalt = Math.imul(cycle + 1, 0xc2b2ae35);
    return new RandomStream(mixSeed(this.seed, phaseSalt ^ cycleSalt));
  }

  private seedOpeningOrbit() {
    const side = this.width - this.core.x >= 105 ? 1 : -1;
    this.addEntity(this.makeEntity("energy", {
      x: this.core.x + side * Math.min(48, this.width * 0.18),
      y: this.core.y,
      vx: 0,
      vy: side * 3,
      radius: 5.5,
      mass: 0.42,
      life: 12,
      value: 10,
      vulnerable: false,
      dangerous: false,
    }));
    this.addEntity(this.makeEntity("orbiter", {
      x: this.core.x + side * Math.min(88, this.width * 0.31),
      y: this.core.y,
      vx: 0,
      vy: side * 72,
      radius: 8,
      mass: 1.2,
      life: 18,
      value: 12,
      vulnerable: true,
      dangerous: false,
    }));
  }

  private seedForcedPhase(index: number) {
    if (index === 0) {
      this.seedOpeningOrbit();
    } else if (index === 1) {
      this.spawnCrystalCluster(true);
      this.spawnEnergy(true);
    } else if (index === 2) {
      this.spawnFlowRibbon(12, true);
      this.spawnVortex(true);
      this.spawnVortex(true);
      this.spawnEnergy(true);
    } else if (index === 3) {
      this.prepareEchoPath();
      this.spawnEchoHead(true);
      this.spawnEchoHead(true);
      this.spawnEnergy(true);
    } else if (index === 4) {
      this.spawnSwarmFormation(16, true);
      this.spawnEnergy(true);
    } else {
      this.prepareEchoPath();
      this.spawnNovaCuratedSet();
    }
  }

  private spawnEnergy(nearCore: boolean) {
    if (this.countKind("energy") >= MAX_ENERGY) {
      return;
    }
    const minimum = Math.min(this.width, this.height);
    const angle = this.phaseRng.range(0, TAU);
    const distance = nearCore
      ? clamp(minimum * 0.13, 35, 72)
      : clamp(this.phaseRng.range(minimum * 0.2, minimum * 0.42), 54, 250);
    this.addEntity(this.makeEntity("energy", {
      x: this.core.x + Math.cos(angle) * distance,
      y: this.core.y + Math.sin(angle) * distance,
      vx: -Math.sin(angle) * this.phaseRng.range(5, 18),
      vy: Math.cos(angle) * this.phaseRng.range(5, 18),
      radius: this.phaseRng.range(4.5, 6.5),
      mass: 0.4,
      life: this.phaseRng.range(8, 13),
      value: this.phaseRng.integer(7, 13),
      vulnerable: false,
      dangerous: false,
    }));
  }

  private spawnOrbiter(safe: boolean) {
    const phaseLimit = this.phaseIndex === 5 ? NOVA_ORBITERS : MAX_ORBITERS;
    if (this.countKind("orbiter") >= phaseLimit) {
      return;
    }
    const minimum = Math.min(this.width, this.height);
    const angle = this.phaseRng.range(0, TAU);
    const distance = clamp(this.phaseRng.range(minimum * 0.25, minimum * 0.43), 82, 285);
    const speed = this.phaseRng.range(62, 112) * (1 + this.cycle * 0.08);
    this.addEntity(this.makeEntity("orbiter", {
      x: this.core.x + Math.cos(angle) * distance,
      y: this.core.y + Math.sin(angle) * distance,
      vx: -Math.sin(angle) * speed,
      vy: Math.cos(angle) * speed,
      radius: this.phaseRng.range(6.5, 10.5),
      mass: this.phaseRng.range(0.9, 1.8),
      life: this.phaseRng.range(11, 17),
      value: this.phaseRng.integer(9, 16),
      vulnerable: true,
      dangerous: !safe,
    }));
  }

  private spawnGate() {
    if (this.countKind("gate") >= MAX_GATES) {
      return;
    }
    const minimum = Math.min(this.width, this.height);
    const angle = this.phaseRng.range(0, TAU);
    const distance = clamp(this.phaseRng.range(minimum * 0.2, minimum * 0.36), 75, 225);
    this.addEntity(this.makeEntity("gate", {
      x: this.core.x + Math.cos(angle) * distance,
      y: this.core.y + Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      radius: this.phaseRng.range(22, 29),
      mass: 10,
      life: 7.5,
      value: this.phaseRng.integer(22, 34),
      vulnerable: false,
      dangerous: false,
    }));
  }

  private spawnCrystalCluster(opening: boolean) {
    const phaseLimit = this.phaseIndex === 5 ? NOVA_CRYSTALS : MAX_CRYSTALS;
    const available = Math.max(0, phaseLimit - this.countKind("crystal"));
    if (available <= 0) {
      return;
    }
    const minimum = Math.min(this.width, this.height);
    const baseAngle = opening ? 0.12 : this.phaseRng.range(0, TAU);
    const baseDistance = clamp(opening ? minimum * 0.23 : minimum * 0.34, 92, 235);
    const centerX = this.core.x + Math.cos(baseAngle) * baseDistance;
    const centerY = this.core.y + Math.sin(baseAngle) * baseDistance;
    const count = Math.min(available, opening ? 5 : this.phaseRng.integer(3, 5));

    for (let index = 0; index < count; index += 1) {
      const row = index - (count - 1) * 0.5;
      const along = row * 45;
      const across = Math.abs(row) % 2 * 16;
      const x = centerX - Math.sin(baseAngle) * along + Math.cos(baseAngle) * across;
      const y = centerY + Math.cos(baseAngle) * along + Math.sin(baseAngle) * across;
      this.addEntity(this.makeEntity("crystal", {
        x,
        y,
        vx: Math.cos(baseAngle + Math.PI) * this.phaseRng.range(1, 8),
        vy: Math.sin(baseAngle + Math.PI) * this.phaseRng.range(1, 8),
        radius: this.phaseRng.range(11, 16),
        mass: this.phaseRng.range(2.1, 3.8),
        life: this.phaseRng.range(8, 12),
        rotation: baseAngle + this.phaseRng.range(-0.4, 0.4),
        spin: this.phaseRng.range(-0.35, 0.35),
        state: 1,
        value: this.phaseRng.integer(18, 28),
        vulnerable: true,
        dangerous: false,
      }));
    }
  }

  private spawnFlowRibbon(requested: number, opening: boolean) {
    const phaseLimit = this.phaseIndex === 5 ? NOVA_DROPLETS : MAX_DROPLETS;
    const available = Math.max(0, phaseLimit - this.countKind("droplet"));
    const count = Math.min(requested, available);
    const direction = this.phaseRng.uint() % 2 === 0 ? 1 : -1;
    const baseY = clamp(
      this.core.y + this.phaseRng.range(-this.height * 0.18, this.height * 0.18),
      28,
      this.height - 28,
    );

    for (let index = 0; index < count; index += 1) {
      let x: number;
      let y: number;
      if (opening) {
        x = this.core.x + direction * (82 + (index % 4) * 28);
        y = baseY + (Math.floor(index / 4) - 1) * 31 + (index % 2) * 12;
      } else {
        x = direction > 0 ? 12 : this.width - 12;
        y = (index + 1) / (count + 1) * this.height + this.phaseRng.range(-14, 14);
      }
      x = clamp(x, 12, this.width - 12);
      y = clamp(y, 12, this.height - 12);
      const flow = this.sampleFlowField(x, y);
      this.addEntity(this.makeEntity("droplet", {
        x,
        y,
        vx: flow.x * this.phaseRng.range(0.72, 0.95),
        vy: flow.y * this.phaseRng.range(0.72, 0.95),
        radius: this.phaseRng.range(5.5, 9),
        mass: this.phaseRng.range(0.65, 1.05),
        life: this.phaseRng.range(7.5, 10.5),
        rotation: Math.atan2(flow.y, flow.x),
        spin: this.phaseRng.range(-0.8, 0.8),
        state: opening ? -46 : -26,
        value: this.phaseRng.integer(7, 13),
        vulnerable: true,
        dangerous: false,
      }));
    }
  }

  private spawnVortex(opening: boolean) {
    const phaseLimit = this.phaseIndex === 5 ? NOVA_VORTICES : MAX_VORTICES;
    const current = this.countKind("vortex");
    if (current >= phaseLimit) {
      return;
    }
    const minimum = Math.min(this.width, this.height);
    const authoredAngle = current === 0 ? -0.62 : 2.35;
    const angle = opening ? authoredAngle : this.phaseRng.range(0, TAU);
    const distance = clamp(
      opening ? minimum * (0.24 + current * 0.04) : this.phaseRng.range(minimum * 0.28, minimum * 0.43),
      92,
      245,
    );
    this.addEntity(this.makeEntity("vortex", {
      x: this.core.x + Math.cos(angle) * distance,
      y: this.core.y + Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      radius: this.phaseRng.range(23, 31),
      mass: 10,
      life: this.phaseRng.range(8.5, 11),
      rotation: angle,
      spin: this.phaseRng.range(0.5, 1.1),
      state: opening ? -52 : -32,
      value: this.phaseRng.integer(18, 26),
      vulnerable: true,
      dangerous: false,
    }));
  }

  private spawnEchoHead(opening: boolean) {
    const phaseLimit = this.phaseIndex === 5 ? NOVA_ECHOES : MAX_ECHOES;
    if (this.countKind("echo") >= phaseLimit) {
      return;
    }
    if (this.echoPath.length < 2) {
      this.prepareEchoPath();
    }
    const entity = this.makeEntity("echo", {
      radius: this.phaseRng.range(9, 12),
      mass: 2.4,
      life: this.phaseIndex === 5 ? 5.8 : 10.5,
      state: opening ? -48 : -30,
      value: this.phaseRng.integer(18, 25),
      vulnerable: false,
      dangerous: false,
    });
    const point = this.echoPath[entity.seed % this.echoPath.length];
    entity.x = point.x;
    entity.y = point.y;
    this.addEntity(entity);
  }

  private spawnSwarmFormation(requested: number, opening: boolean) {
    const phaseLimit = this.phaseIndex === 5 ? NOVA_SWARM : MAX_SWARM;
    const available = Math.max(0, phaseLimit - this.countKind("swarm"));
    const count = Math.min(requested, available);
    if (count <= 0) {
      return;
    }

    const minimum = Math.min(this.width, this.height);
    const baseAngle = this.phaseRng.range(0, TAU);
    const distance = clamp(opening ? minimum * 0.3 : minimum * 0.4, 118, 265);
    const centerX = this.core.x + Math.cos(baseAngle) * distance;
    const centerY = this.core.y + Math.sin(baseAngle) * distance;
    const heading = baseAngle + Math.PI + this.phaseRng.range(-0.18, 0.18);
    const speed = 78 + this.difficulty * 10;

    for (let index = 0; index < count; index += 1) {
      const column = index % 5;
      const row = Math.floor(index / 5);
      const lateral = (column - 2) * 17;
      const longitudinal = row * 21 + Math.abs(column - 2) * 5;
      const x = centerX + Math.cos(baseAngle) * longitudinal - Math.sin(baseAngle) * lateral;
      const y = centerY + Math.sin(baseAngle) * longitudinal + Math.cos(baseAngle) * lateral;
      this.addEntity(this.makeEntity("swarm", {
        x,
        y,
        vx: Math.cos(heading) * speed + this.phaseRng.range(-8, 8),
        vy: Math.sin(heading) * speed + this.phaseRng.range(-8, 8),
        radius: this.phaseRng.range(5.2, 7.1),
        mass: this.phaseRng.range(0.55, 0.9),
        life: this.phaseIndex === 5 ? 7.2 : 10.5,
        rotation: heading,
        state: opening ? -42 : -25,
        value: this.phaseRng.integer(7, 12),
        vulnerable: index % 3 === 0,
        dangerous: false,
      }));
    }
  }

  private spawnCollapseOrbiter() {
    const phaseLimit = this.phaseIndex === 5 ? NOVA_ORBITERS : MAX_ORBITERS;
    if (this.countKind("orbiter") >= phaseLimit) {
      return;
    }
    const side = this.phaseRng.integer(0, 3);
    const margin = 12;
    const x = side === 0
      ? margin
      : side === 1
        ? this.width - margin
        : this.phaseRng.range(margin, this.width - margin);
    const y = side === 2
      ? margin
      : side === 3
        ? this.height - margin
        : this.phaseRng.range(margin, this.height - margin);
    const offsetX = this.core.x - x;
    const offsetY = this.core.y - y;
    const distance = Math.max(1, length(offsetX, offsetY));
    const speed = this.phaseRng.range(68, 105);
    this.addEntity(this.makeEntity("orbiter", {
      x,
      y,
      vx: offsetX / distance * speed,
      vy: offsetY / distance * speed,
      radius: this.phaseRng.range(7.5, 11),
      mass: this.phaseRng.range(1.1, 2),
      life: this.phaseRng.range(6.5, 9),
      value: this.phaseRng.integer(12, 19),
      vulnerable: true,
      dangerous: true,
    }));
  }

  private spawnNovaCuratedSet() {
    this.spawnVortex(true);
    this.spawnFlowRibbon(6, true);
    this.spawnSwarmFormation(5, true);
    this.spawnCollapseOrbiter();
    this.spawnCollapseOrbiter();
    this.spawnCrystalCluster(false);
    this.spawnEchoHead(true);
    this.spawnEnergy(true);
  }

  private spawnFragment(values: Pick<Entity, "x" | "y" | "vx" | "vy" | "radius" | "mass" | "rotation" | "spin" | "value" | "seed">) {
    const fragment = this.fragmentPool.pop() ?? this.makeEntity("fragment", {});
    Object.assign(fragment, {
      id: this.nextEntityId,
      kind: "fragment" as const,
      x: values.x,
      y: values.y,
      vx: values.vx,
      vy: values.vy,
      radius: values.radius,
      mass: values.mass,
      age: 0,
      life: 3.8,
      rotation: values.rotation,
      spin: values.spin,
      state: 0,
      value: values.value,
      captured: false,
      captureAngle: 0,
      captureRadius: 0,
      vulnerable: true,
      dangerous: false,
      phase: this.phaseIndex,
      seed: values.seed,
      health: 1,
      alpha: 1,
    });
    this.nextEntityId += 1;
    this.addEntity(fragment);
  }

  private makeEntity(kind: EntityKind, values: Partial<Entity>): Entity {
    const entity: Entity = {
      id: this.nextEntityId,
      kind,
      x: this.core.x,
      y: this.core.y,
      vx: 0,
      vy: 0,
      radius: 8,
      mass: 1,
      age: 0,
      life: 10,
      rotation: 0,
      spin: 0,
      state: 0,
      value: 10,
      captured: false,
      captureAngle: 0,
      captureRadius: 0,
      vulnerable: false,
      dangerous: false,
      phase: this.phaseIndex,
      seed: this.phaseRng.uint(),
      health: 1,
      alpha: 1,
      ...values,
    };
    this.nextEntityId += 1;
    return entity;
  }

  private addEntity(entity: Entity) {
    if (this.entities.length >= MAX_ENTITIES) {
      if (entity.kind === "fragment" && this.fragmentPool.length < MAX_FRAGMENTS) {
        this.fragmentPool.push(entity);
      }
      return false;
    }
    if (entity.kind === "energy" && this.countKind("energy") >= MAX_ENERGY) {
      return false;
    }
    if (entity.kind === "gate" && this.countKind("gate") >= MAX_GATES) {
      return false;
    }
    if (entity.kind === "fragment" && this.countKind("fragment") >= MAX_FRAGMENTS) {
      if (this.fragmentPool.length < MAX_FRAGMENTS) {
        this.fragmentPool.push(entity);
      }
      return false;
    }
    const kindLimit = entity.kind === "droplet"
      ? (this.phaseIndex === 5 ? NOVA_DROPLETS : MAX_DROPLETS)
      : entity.kind === "vortex"
        ? (this.phaseIndex === 5 ? NOVA_VORTICES : MAX_VORTICES)
        : entity.kind === "echo"
          ? (this.phaseIndex === 5 ? NOVA_ECHOES : MAX_ECHOES)
          : entity.kind === "swarm"
            ? (this.phaseIndex === 5 ? NOVA_SWARM : MAX_SWARM)
            : entity.kind === "crystal"
              ? (this.phaseIndex === 5 ? NOVA_CRYSTALS : MAX_CRYSTALS)
              : entity.kind === "orbiter"
                ? (this.phaseIndex === 5 ? NOVA_ORBITERS : MAX_ORBITERS)
                : Number.POSITIVE_INFINITY;
    if (this.countKind(entity.kind) >= kindLimit) {
      return false;
    }
    this.clampEntityToArena(entity);
    this.entities.push(entity);
    return true;
  }

  private countKind(kind: EntityKind) {
    let count = 0;
    for (const entity of this.entities) {
      if (entity.kind === kind && entity.age < entity.life && entity.health > 0) {
        count += 1;
      }
    }
    return count;
  }

  private bounceEntity(entity: Entity) {
    const horizontalRadius = Math.min(entity.radius, this.width * 0.5);
    const verticalRadius = Math.min(entity.radius, this.height * 0.5);
    if (entity.x < horizontalRadius) {
      entity.x = horizontalRadius;
      entity.vx = Math.abs(entity.vx) * 0.72;
    } else if (entity.x > this.width - horizontalRadius) {
      entity.x = this.width - horizontalRadius;
      entity.vx = -Math.abs(entity.vx) * 0.72;
    }
    if (entity.y < verticalRadius) {
      entity.y = verticalRadius;
      entity.vy = Math.abs(entity.vy) * 0.72;
    } else if (entity.y > this.height - verticalRadius) {
      entity.y = this.height - verticalRadius;
      entity.vy = -Math.abs(entity.vy) * 0.72;
    }
  }

  private clampCoreToArena() {
    const horizontalRadius = Math.min(this.core.radius, this.width * 0.5);
    const verticalRadius = Math.min(this.core.radius, this.height * 0.5);
    const nextX = clamp(finite(this.core.x, this.width * 0.5), horizontalRadius, this.width - horizontalRadius);
    const nextY = clamp(finite(this.core.y, this.height * 0.5), verticalRadius, this.height - verticalRadius);
    if (nextX !== this.core.x) {
      this.core.vx *= -0.22;
    }
    if (nextY !== this.core.y) {
      this.core.vy *= -0.22;
    }
    this.core.x = nextX;
    this.core.y = nextY;
  }

  private clampEntityToArena(entity: Entity) {
    const horizontalRadius = Math.min(entity.radius, this.width * 0.5);
    const verticalRadius = Math.min(entity.radius, this.height * 0.5);
    entity.x = clamp(finite(entity.x, this.width * 0.5), horizontalRadius, this.width - horizontalRadius);
    entity.y = clamp(finite(entity.y, this.height * 0.5), verticalRadius, this.height - verticalRadius);
    entity.vx = finite(entity.vx, 0);
    entity.vy = finite(entity.vy, 0);
  }

  private removeExpiredEntities() {
    const active: Entity[] = [];
    for (const entity of this.entities) {
      if (entity.health > 0 && entity.age < entity.life && entity.alpha > 0) {
        active.push(entity);
        continue;
      }
      this.nearMissed.delete(entity.id);
      if (entity.kind === "fragment" && this.fragmentPool.length < MAX_FRAGMENTS) {
        this.fragmentPool.push(entity);
      }
    }
    this.entities = active;
  }

  private recycleAllEntities() {
    for (const entity of this.entities) {
      if (entity.kind === "fragment" && this.fragmentPool.length < MAX_FRAGMENTS) {
        this.fragmentPool.push(entity);
      }
    }
    this.entities = [];
  }

  private awardFlux(baseValue: number, increaseCombo: boolean) {
    if (baseValue <= 0 || !Number.isFinite(baseValue)) {
      return 0;
    }
    if (increaseCombo) {
      this.metrics.combo += 1;
      this.metrics.highestCombo = Math.max(this.metrics.highestCombo, this.metrics.combo);
      this.comboTicks = 210;
    }
    const multiplier = 1 + Math.min(2, Math.floor(Math.max(0, this.metrics.combo - 1) / 3) * 0.2);
    const earned = Math.max(1, Math.round(baseValue * multiplier));
    this.metrics.unbankedFlux += earned;
    this.metrics.score = this.metrics.bankedScore + this.metrics.unbankedFlux;
    this.metrics.phaseScores[this.phaseIndex] += earned;
    return earned;
  }

  private bankFlux() {
    if (this.metrics.unbankedFlux > 0) {
      this.metrics.bankedScore += this.metrics.unbankedFlux;
      this.metrics.unbankedFlux = 0;
    }
    this.metrics.score = this.metrics.bankedScore;
  }

  private finishAsGameOver(reason: string, events: GameEvent[]) {
    this.status = "results";
    this.runComplete = false;
    this.deathReason = reason;
    this.metrics.score = this.metrics.bankedScore + this.metrics.unbankedFlux;
    events.push({ type: "game-over", score: this.metrics.score, reason });
  }
}
