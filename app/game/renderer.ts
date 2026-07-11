import type {
  Entity,
  GameEvent,
  GameSnapshot,
  RenderQuality,
} from "./types";
import { getNovaFeedbackTier } from "./gameFeel";

const TAU = Math.PI * 2;
const MAX_PARTICLES = 512;
const MAX_PULSES = 32;
const MAX_STARS = 220;
const MAX_BACKING_PIXELS = 3_200_000;
const CAPTURE_DASH = [5, 9];
const GATE_DASH = [2, 7];
const EMPTY_DASH: number[] = [];

const PHASE_ACCENTS = [
  "#79bcff",
  "#a6eeff",
  "#a58cff",
  "#ff8f84",
  "#f7d35c",
  "#fff1c6",
] as const;

const PHASE_RGB = [
  [0.35, 0.67, 1.0],
  [0.48, 0.92, 1.0],
  [0.57, 0.39, 1.0],
  [1.0, 0.38, 0.32],
  [1.0, 0.72, 0.18],
  [1.0, 0.82, 0.48],
] as const;

const PARTICLE_COLORS = [
  "#fff7dc",
  "#ffb54a",
  "#72bdff",
  "#9eefff",
  "#a992ff",
  "#ff8376",
  "#f8d45c",
] as const;

const COLLECTIBLE_CYAN = "#8fe9ff";
const COLLECTIBLE_WHITE = "#f4feff";
const DANGER_CORAL = "#ff746b";
const CAPTURE_AMBER = "#ffc35c";
const CAPTURE_WHITE = "#fff1c2";

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

varying vec2 v_uv;
uniform vec2 u_resolution;
uniform vec2 u_core;
uniform vec3 u_accent;
uniform float u_time;
uniform float u_charge;
uniform float u_nova;
uniform float u_novaAge;
uniform float u_phase;
uniform float u_transition;
uniform float u_flash;
uniform float u_quality;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float starLayer(vec2 p, float scale, float cutoff) {
  vec2 cell = floor(p * scale);
  vec2 local = fract(p * scale) - 0.5;
  float seed = hash21(cell);
  vec2 offset = vec2(hash21(cell + 7.1), hash21(cell + 19.7)) - 0.5;
  float radius = length(local - offset * 0.56);
  float point = 1.0 - smoothstep(0.0, 0.055, radius);
  float visible = smoothstep(cutoff, 1.0, seed);
  float pulse = 0.72 + 0.28 * sin(u_time * (0.45 + seed) + seed * 90.0);
  return point * visible * pulse;
}

void main() {
  float shortSide = max(1.0, min(u_resolution.x, u_resolution.y));
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / shortSide;
  vec2 core = (u_core - 0.5 * u_resolution) / shortSide;
  vec2 delta = p - core;
  float radius = length(delta);
  vec2 tangent = vec2(-delta.y, delta.x) / max(radius, 0.025);

  float gravity = exp(-radius * 3.2) * (0.006 + u_charge * 0.025);
  float novaPush = exp(-radius * 2.5) * u_nova * 0.013;
  vec2 warped = p + tangent * gravity / (radius + 0.10) + delta * novaPush;

  float nebulaA = valueNoise(warped * 3.4 + vec2(u_time * 0.018, -u_time * 0.012));
  float nebulaB = valueNoise(warped * 7.8 - vec2(u_time * 0.011, u_time * 0.017));
  float nebula = nebulaA * 0.68 + nebulaB * 0.32;

  float phaseAngle = atan(delta.y, delta.x);
  float field = sin(phaseAngle * (5.0 + mod(u_phase, 3.0)) - log(radius + 0.055) * 8.5 - u_time * 0.42);
  field = (1.0 - smoothstep(0.035, 0.12, abs(field))) * exp(-radius * 2.1);

  float stars = starLayer(warped + 2.7, 34.0, 0.90);
  if (u_quality > 0.35) {
    stars += starLayer(warped * 1.17 - 3.2, 58.0, 0.955) * 0.72;
  }
  if (u_quality > 0.75) {
    stars += starLayer(warped * 0.73 + 7.4, 91.0, 0.978) * 0.52;
  }

  vec3 color = vec3(0.006, 0.012, 0.025);
  color += u_accent * max(0.0, nebula - 0.49) * 0.105;
  color += u_accent * field * (0.018 + u_charge * 0.032);
  color += vec3(0.75, 0.86, 1.0) * stars;

  float coreMist = exp(-radius * 10.5) * (0.03 + u_charge * 0.12);
  color += mix(u_accent, vec3(1.0, 0.63, 0.22), 0.5) * coreMist;

  float novaRadius = 0.035 + u_novaAge * 0.72;
  float novaRing = 1.0 - smoothstep(0.0, 0.014 + u_novaAge * 0.018, abs(radius - novaRadius));
  novaRing *= max(0.0, 1.0 - u_novaAge * 1.1) * u_nova;
  color += vec3(1.0, 0.66, 0.27) * novaRing * 0.34;

  float transitionOn = step(0.002, u_transition) * (1.0 - step(0.998, u_transition));
  float transitionX = mix(-0.72, 0.72, u_transition);
  float transitionWave = 1.0 - smoothstep(0.0, 0.018, abs(p.x - transitionX + sin(p.y * 15.0 + u_time) * 0.009));
  color += u_accent * transitionWave * transitionOn * 0.24;

  vec2 screenUv = gl_FragCoord.xy / u_resolution;
  float vignette = 1.0 - smoothstep(0.24, 0.88, length((screenUv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0)));
  color *= 0.42 + vignette * 0.62;

  float grain = hash21(gl_FragCoord.xy + fract(u_time) * 137.0) - 0.5;
  color += grain * 0.011;
  color += vec3(1.0, 0.73, 0.42) * u_flash * 0.16;
  color = color / (color + vec3(0.92));
  gl_FragColor = vec4(color, 1.0);
}
`;

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  drag: number;
  color: number;
  shape: number;
  spin: number;
  rotation: number;
}

interface Pulse {
  active: boolean;
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  speed: number;
  strength: number;
  color: number;
  kind: number;
}

interface GlResources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  position: number;
  resolution: WebGLUniformLocation | null;
  core: WebGLUniformLocation | null;
  accent: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  charge: WebGLUniformLocation | null;
  nova: WebGLUniformLocation | null;
  novaAge: WebGLUniformLocation | null;
  phase: WebGLUniformLocation | null;
  transition: WebGLUniformLocation | null;
  flash: WebGLUniformLocation | null;
  quality: WebGLUniformLocation | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function phaseIndex(index: number): number {
  const safe = Number.isFinite(index) ? Math.floor(index) : 0;
  return ((safe % PHASE_ACCENTS.length) + PHASE_ACCENTS.length) % PHASE_ACCENTS.length;
}

function isCapturableMatter(entity: Entity): boolean {
  return entity.vulnerable && (
    entity.kind === "orbiter" ||
    entity.kind === "fragment" ||
    entity.kind === "droplet" ||
    entity.kind === "swarm"
  );
}

function qualityShaderLevel(level: RenderQuality["level"]): number {
  if (level === "high") return 1;
  if (level === "medium") return 0.62;
  return 0.2;
}

function qualityDprCap(level: RenderQuality["level"]): number {
  if (level === "high") return 2;
  if (level === "medium") return 1.5;
  return 1.15;
}

export class GameRenderer {
  private readonly host: HTMLElement;
  private readonly backgroundCanvas: HTMLCanvasElement;
  private readonly foregroundCanvas: HTMLCanvasElement;
  private readonly foreground: CanvasRenderingContext2D;
  private background2d: CanvasRenderingContext2D | null = null;
  private gl: WebGLRenderingContext | null = null;
  private glResources: GlResources | null = null;
  private contextLost = false;
  private disposed = false;

  private quality: RenderQuality;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private adaptiveScale = 1;
  private adaptiveTier = 0;
  private resizeObserver: ResizeObserver | null = null;

  private readonly particles: Particle[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly stars = new Float32Array(MAX_STARS * 4);
  private particleCursor = 0;
  private pulseCursor = 0;
  private randomState = 0x6d2b79f5;

  private visualTime = 0;
  private lastRenderTime = 0;
  private lastCoreX = 0;
  private lastCoreY = 0;
  private eventShake = 0;
  private transitionKick = 0;
  private currentPhaseIndex = 0;
  private lastNovaLoad = 0;
  private lastNovaCaptured = 0;
  private frameIntervalEma = 16.7;
  private frameSamples = 0;

  private readonly previousHostPosition: string;
  private readonly previousHostOverflow: string;
  private changedHostPosition = false;
  private changedHostOverflow = false;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.glResources = null;
    this.gl = null;
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    this.initializeWebGL();
    this.applyCanvasSize(true);
  };

  constructor(host: HTMLElement, quality: RenderQuality) {
    this.host = host;
    this.quality = this.sanitizeQuality(quality);
    this.previousHostPosition = host.style.position;
    this.previousHostOverflow = host.style.overflow;

    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
      this.changedHostPosition = true;
    }
    if (getComputedStyle(host).overflow === "visible") {
      host.style.overflow = "clip";
      this.changedHostOverflow = true;
    }

    this.backgroundCanvas = document.createElement("canvas");
    this.foregroundCanvas = document.createElement("canvas");
    this.configureCanvas(this.backgroundCanvas, "0");
    this.configureCanvas(this.foregroundCanvas, "1");
    this.backgroundCanvas.dataset.layer = "sol-shift-field";
    this.foregroundCanvas.dataset.layer = "sol-shift-world";

    const foreground = this.foregroundCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!foreground) {
      throw new Error("SOL//SHIFT requires Canvas 2D rendering support.");
    }
    this.foreground = foreground;

    this.seedStars();
    this.seedPools();
    host.append(this.backgroundCanvas, this.foregroundCanvas);

    this.backgroundCanvas.addEventListener("webglcontextlost", this.onContextLost);
    this.backgroundCanvas.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.initializeWebGL();

    const initialWidth = Math.max(1, host.clientWidth || 960);
    const initialHeight = Math.max(1, host.clientHeight || 540);
    this.resize(initialWidth, initialHeight);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || this.disposed) return;
        const nextWidth = Math.max(1, entry.contentRect.width);
        const nextHeight = Math.max(1, entry.contentRect.height);
        if (
          Math.abs(nextWidth - this.width) > 0.5 ||
          Math.abs(nextHeight - this.height) > 0.5
        ) {
          this.resize(nextWidth, nextHeight);
        }
      });
      this.resizeObserver.observe(host);
    }
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.width = Math.max(1, Number.isFinite(width) ? width : 1);
    this.height = Math.max(1, Number.isFinite(height) ? height : 1);
    if (this.lastCoreX === 0 && this.lastCoreY === 0) {
      this.lastCoreX = this.width * 0.5;
      this.lastCoreY = this.height * 0.5;
    }
    this.applyCanvasSize(false);
  }

  setQuality(quality: RenderQuality): void {
    if (this.disposed) return;
    this.quality = this.sanitizeQuality(quality);
    this.adaptiveScale = 1;
    this.adaptiveTier = 0;
    const budget = this.particleBudget();
    for (let index = budget; index < this.particles.length; index += 1) {
      this.particles[index].active = false;
    }
    this.applyCanvasSize(true);
  }

  handleEvents(events: readonly GameEvent[]): void {
    if (this.disposed) return;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      switch (event.type) {
        case "phase": {
          const color = phaseIndex(event.phaseIndex) + 1;
          this.currentPhaseIndex = phaseIndex(event.phaseIndex);
          this.transitionKick = 1;
          this.spawnPulse(
            this.width * 0.5,
            this.height * 0.5,
            Math.min(this.width, this.height) * 0.1,
            420,
            0.9,
            color,
            2,
            0.75,
          );
          this.spawnBurst(
            this.lastCoreX,
            this.lastCoreY,
            10,
            55,
            145,
            color,
            0,
            0.55,
          );
          break;
        }
        case "charge-start":
          this.spawnPulse(
            this.lastCoreX,
            this.lastCoreY,
            12,
            68,
            0.42,
            1,
            0,
            0.32,
          );
          break;
        case "nova": {
          const chargeLoad = clamp((event.strength - 0.08) / 1.12, 0, 1);
          const capturedLoad = clamp(event.captured / 6, 0, 1);
          const tier = getNovaFeedbackTier(event.strength, event.captured);
          const empty = tier === "empty";
          const charged = tier === "charged";
          const load = tier === "loaded"
            ? clamp(0.45 + capturedLoad * 0.35 + chargeLoad * 0.2, 0, 1)
            : charged
              ? clamp(0.24 + chargeLoad * 0.32, 0, 0.56)
              : chargeLoad * 0.2;
          this.lastNovaLoad = load;
          this.lastNovaCaptured = Math.max(0, event.captured);

          if (empty) {
            // A tap with no stored mass is useful feedback, not a false climax.
            this.spawnPulse(
              event.x,
              event.y,
              10,
              155 + chargeLoad * 80,
              0.34,
              0,
              0,
              0.34,
            );
            this.spawnBurst(event.x, event.y, 4, 38, 92, 0, 0, 0.26);
            this.eventShake = Math.min(1.15, this.eventShake + 0.12 + chargeLoad * 0.2);
            break;
          }

          if (charged) {
            // Charge alone creates a useful medium wave. Captured mass is what
            // unlocks the amber, screen-dominating release below.
            this.spawnPulse(
              event.x,
              event.y,
              11,
              220 + load * 180,
              0.42 + load * 0.16,
              2,
              1,
              0.38 + load * 0.3,
            );
            this.spawnBurst(
              event.x,
              event.y,
              5 + Math.round(load * 6),
              58,
              150 + load * 130,
              2,
              0,
              0.34 + load * 0.14,
            );
            this.eventShake = Math.min(1.55, this.eventShake + 0.25 + load * 0.55);
            break;
          }

          const pulsePower = clamp(0.42 + load * 0.68, 0, 1.1);
          this.spawnPulse(
            event.x,
            event.y,
            14 + capturedLoad * 4,
            310 + load * 285,
            0.5 + load * 0.26,
            1,
            3,
            pulsePower,
          );
          this.spawnPulse(
            event.x,
            event.y,
            10,
            235 + capturedLoad * 175,
            0.58 + capturedLoad * 0.22,
            0,
            2,
            0.36 + capturedLoad * 0.5,
          );
          this.spawnBurst(
            event.x,
            event.y,
            7 + Math.round(load * 13),
            82,
            245 + load * 205,
            event.captured > 0 ? 1 : 0,
            2,
            0.46 + load * 0.2,
          );
          this.eventShake = Math.min(3.1, this.eventShake + 0.38 + load * 1.35);
          break;
        }
        case "collect":
          this.spawnBurst(
            event.x,
            event.y,
            5 + Math.min(8, event.combo),
            24,
            105 + event.combo * 4,
            2,
            0,
            0.44,
          );
          this.spawnPulse(event.x, event.y, 5, 62, 0.28, 2, 0, 0.3);
          break;
        case "gate":
          this.spawnBurst(event.x, event.y, 15, 80, 220, 2, 2, 0.58);
          this.spawnPulse(event.x, event.y, 12, 210, 0.5, 2, 0, 0.7);
          this.eventShake = Math.min(4, this.eventShake + 0.8);
          break;
        case "fracture": {
          const chainPower = clamp((event.chain - 1) / 6, 0, 1);
          const impactColor = this.currentPhaseIndex === 4 ? 6 : 3;
          const count = 9 + Math.min(18, event.chain * 2);
          this.spawnBurst(
            event.x,
            event.y,
            count,
            70,
            290 + event.strength * 170,
            impactColor,
            1,
            0.72 + chainPower * 0.24,
          );
          this.spawnPulse(
            event.x,
            event.y,
            8,
            245 + chainPower * 115,
            0.46 + chainPower * 0.13,
            impactColor,
            1,
            0.62 + event.strength * 0.48 + chainPower * 0.42,
          );
          if (event.chain >= 3) {
            this.spawnPulse(
              event.x,
              event.y,
              5,
              190 + chainPower * 150,
              0.4 + chainPower * 0.16,
              0,
              0,
              0.24 + chainPower * 0.36,
            );
          }
          this.eventShake = Math.min(3.8, this.eventShake + 0.22 + chainPower * 0.52);
          break;
        }
        case "near-miss":
          this.spawnBurst(event.x, event.y, 7, 30, 95, 5, 2, 0.35);
          this.spawnPulse(event.x, event.y, 4, 95, 0.26, 5, 0, 0.36);
          break;
        case "hit":
          this.spawnBurst(event.x, event.y, 24, 95, 310, 5, 2, 0.72);
          this.spawnPulse(event.x, event.y, 8, 330, 0.46, 5, 0, 1.1);
          this.eventShake = Math.min(7, this.eventShake + 5.2);
          break;
        case "complete":
          this.spawnBurst(
            this.lastCoreX,
            this.lastCoreY,
            54,
            120,
            410,
            6,
            0,
            1.15,
          );
          this.spawnPulse(
            this.lastCoreX,
            this.lastCoreY,
            22,
            650,
            1.2,
            1,
            2,
            1.2,
          );
          break;
        case "game-over":
          this.spawnBurst(
            this.lastCoreX,
            this.lastCoreY,
            32,
            55,
            260,
            5,
            1,
            1.05,
          );
          this.spawnPulse(
            this.lastCoreX,
            this.lastCoreY,
            10,
            390,
            0.9,
            5,
            1,
            0.9,
          );
          this.eventShake = Math.min(7, this.eventShake + 4.5);
          break;
      }
    }
  }

  render(snapshot: GameSnapshot, alpha = 0): void {
    if (this.disposed) return;
    this.currentPhaseIndex = phaseIndex(snapshot.phaseIndex);
    if (
      Math.abs(snapshot.width - this.width) > 0.5 ||
      Math.abs(snapshot.height - this.height) > 0.5
    ) {
      this.resize(snapshot.width, snapshot.height);
    }

    const now = performance.now();
    const frameInterval = this.lastRenderTime > 0 ? now - this.lastRenderTime : 16.7;
    this.lastRenderTime = now;
    const dt = clamp(frameInterval / 1000, 0, 0.05);
    this.visualTime += dt * (this.quality.reducedMotion ? 0.32 : 1);
    this.updateAdaptiveQuality(frameInterval, snapshot.status === "playing");
    this.updateCosmetics(dt);

    const interpolation = clamp(Number.isFinite(alpha) ? alpha : 0, 0, 1);
    const coreX = snapshot.core.x + snapshot.core.vx * interpolation / 60;
    const coreY = snapshot.core.y + snapshot.core.vy * interpolation / 60;
    this.lastCoreX = coreX;
    this.lastCoreY = coreY;

    const backgroundRendered = this.renderBackground(snapshot, coreX, coreY);
    const ctx = this.foreground;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.foregroundCanvas.width, this.foregroundCanvas.height);
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    if (!backgroundRendered) {
      this.drawFallbackBackground(ctx, snapshot, coreX, coreY);
    }

    const requestedShake = clamp(snapshot.shake, 0, 1) * 5.5;
    const shakeStrength = this.quality.reducedMotion
      ? 0
      : Math.min(7, requestedShake + this.eventShake);
    const shakeX = Math.sin(this.visualTime * 71.3) * shakeStrength * 0.72;
    const shakeY = Math.cos(this.visualTime * 63.7) * shakeStrength * 0.58;

    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.drawTransition(ctx, snapshot);
    this.drawTrail(ctx, snapshot);
    this.drawFieldLines(ctx, snapshot, coreX, coreY);
    this.drawCaptureTension(ctx, snapshot, coreX, coreY, interpolation);
    this.drawEntities(ctx, snapshot, interpolation);
    this.drawPulses(ctx);
    this.drawParticles(ctx);
    this.drawCore(ctx, snapshot, coreX, coreY);
    ctx.restore();

    this.drawEdgeVignette(ctx, snapshot.flash);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.backgroundCanvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.backgroundCanvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.destroyGlResources();
    this.gl = null;
    this.background2d = null;
    this.backgroundCanvas.remove();
    this.foregroundCanvas.remove();
    if (this.changedHostPosition) {
      this.host.style.position = this.previousHostPosition;
    }
    if (this.changedHostOverflow) {
      this.host.style.overflow = this.previousHostOverflow;
    }
    for (let index = 0; index < this.particles.length; index += 1) {
      this.particles[index].active = false;
    }
    for (let index = 0; index < this.pulses.length; index += 1) {
      this.pulses[index].active = false;
    }
  }

  private configureCanvas(canvas: HTMLCanvasElement, zIndex: string): void {
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = zIndex;
  }

  private sanitizeQuality(quality: RenderQuality): RenderQuality {
    const level =
      quality.level === "low" || quality.level === "medium" || quality.level === "high"
        ? quality.level
        : "medium";
    const fallbackDpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    return {
      level,
      dpr: clamp(Number.isFinite(quality.dpr) ? quality.dpr : fallbackDpr, 0.75, 3),
      particles: Math.round(clamp(quality.particles || 96, 24, MAX_PARTICLES)),
      trailPoints: Math.round(clamp(quality.trailPoints || 32, 8, 180)),
      bloom: Boolean(quality.bloom),
      reducedMotion: Boolean(quality.reducedMotion),
    };
  }

  private particleBudget(): number {
    const motionScale = this.quality.reducedMotion ? 0.45 : 1;
    const adaptiveMultiplier = this.adaptiveTier === 0 ? 1 : this.adaptiveTier === 1 ? 0.68 : 0.44;
    return Math.max(16, Math.floor(this.quality.particles * motionScale * adaptiveMultiplier));
  }

  private bloomEnabled(): boolean {
    return this.quality.bloom && this.adaptiveTier === 0;
  }

  private novaVisualPower(strength: number): number {
    const chargePower = clamp((strength - 0.08) / 1.12, 0, 1);
    return clamp(Math.max(chargePower * 0.68, this.lastNovaLoad), 0.035, 1);
  }

  private trailPointBudget(): number {
    const base = this.quality.reducedMotion
      ? Math.min(12, this.quality.trailPoints)
      : this.quality.trailPoints;
    const multiplier = this.adaptiveTier === 0 ? 1 : this.adaptiveTier === 1 ? 0.68 : 0.45;
    return Math.max(8, Math.floor(base * multiplier));
  }

  private applyCanvasSize(force: boolean): void {
    const areaLimitedDpr = Math.sqrt(
      MAX_BACKING_PIXELS / Math.max(1, this.width * this.height),
    );
    const targetDpr = clamp(
      Math.min(
        this.quality.dpr,
        qualityDprCap(this.quality.level),
        areaLimitedDpr,
      ) * this.adaptiveScale,
      0.72,
      2,
    );
    const targetWidth = Math.max(1, Math.round(this.width * targetDpr));
    const targetHeight = Math.max(1, Math.round(this.height * targetDpr));
    if (
      !force &&
      targetWidth === this.foregroundCanvas.width &&
      targetHeight === this.foregroundCanvas.height
    ) {
      this.pixelRatio = targetDpr;
      return;
    }
    this.pixelRatio = targetDpr;
    this.backgroundCanvas.width = targetWidth;
    this.backgroundCanvas.height = targetHeight;
    this.foregroundCanvas.width = targetWidth;
    this.foregroundCanvas.height = targetHeight;
    if (this.gl) {
      this.gl.viewport(0, 0, targetWidth, targetHeight);
    }
  }

  private seedPools(): void {
    for (let index = 0; index < MAX_PARTICLES; index += 1) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        age: 0,
        life: 1,
        size: 1,
        drag: 0.96,
        color: 0,
        shape: 0,
        spin: 0,
        rotation: 0,
      });
    }
    for (let index = 0; index < MAX_PULSES; index += 1) {
      this.pulses.push({
        active: false,
        x: 0,
        y: 0,
        age: 0,
        life: 1,
        radius: 0,
        speed: 0,
        strength: 1,
        color: 0,
        kind: 0,
      });
    }
  }

  private seedStars(): void {
    let state = 0x9e3779b9;
    for (let index = 0; index < MAX_STARS; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      this.stars[index * 4] = (state >>> 0) / 4294967296;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      this.stars[index * 4 + 1] = (state >>> 0) / 4294967296;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      this.stars[index * 4 + 2] = 0.35 + ((state >>> 0) / 4294967296) * 1.25;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      this.stars[index * 4 + 3] = (state >>> 0) / 4294967296;
    }
  }

  private random(): number {
    let state = this.randomState | 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state | 0;
    return (state >>> 0) / 4294967296;
  }

  private spawnBurst(
    x: number,
    y: number,
    requestedCount: number,
    minSpeed: number,
    maxSpeed: number,
    color: number,
    shape: number,
    life: number,
  ): void {
    const levelScale = this.quality.level === "low" ? 0.48 : this.quality.level === "medium" ? 0.72 : 1;
    const adaptiveScale = this.adaptiveTier === 0 ? 1 : this.adaptiveTier === 1 ? 0.68 : 0.44;
    const motionScale = this.quality.reducedMotion ? 0.32 : 1;
    const count = Math.max(1, Math.round(requestedCount * levelScale * adaptiveScale * motionScale));
    const budget = this.particleBudget();
    for (let index = 0; index < count; index += 1) {
      const particle = this.particles[this.particleCursor % budget];
      this.particleCursor = (this.particleCursor + 1) % budget;
      const angle = this.random() * TAU;
      const speed = minSpeed + this.random() * (maxSpeed - minSpeed);
      particle.active = true;
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.age = 0;
      particle.life = life * (0.72 + this.random() * 0.56);
      particle.size = 1.2 + this.random() * (shape === 1 ? 5.8 : 3.2);
      particle.drag = 0.91 + this.random() * 0.065;
      particle.color = color % PARTICLE_COLORS.length;
      particle.shape = shape;
      particle.spin = (this.random() - 0.5) * 9;
      particle.rotation = angle;
    }
  }

  private spawnPulse(
    x: number,
    y: number,
    radius: number,
    speed: number,
    life: number,
    color: number,
    kind: number,
    strength: number,
  ): void {
    const pulse = this.pulses[this.pulseCursor % MAX_PULSES];
    this.pulseCursor = (this.pulseCursor + 1) % MAX_PULSES;
    pulse.active = true;
    pulse.x = x;
    pulse.y = y;
    pulse.age = 0;
    pulse.life = this.quality.reducedMotion ? Math.max(0.18, life * 0.65) : life;
    pulse.radius = radius;
    pulse.speed = this.quality.reducedMotion ? speed * 0.35 : speed;
    pulse.color = color % PARTICLE_COLORS.length;
    pulse.kind = kind;
    pulse.strength = strength;
  }

  private updateCosmetics(dt: number): void {
    const motionDt = this.quality.reducedMotion ? dt * 0.38 : dt;
    const dragScale = motionDt * 60;
    const budget = this.particleBudget();
    for (let index = 0; index < budget; index += 1) {
      const particle = this.particles[index];
      if (!particle.active) continue;
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.active = false;
        continue;
      }
      particle.x += particle.vx * motionDt;
      particle.y += particle.vy * motionDt;
      const drag = Math.pow(particle.drag, dragScale);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.rotation += particle.spin * motionDt;
    }
    for (let index = 0; index < this.pulses.length; index += 1) {
      const pulse = this.pulses[index];
      if (!pulse.active) continue;
      pulse.age += dt;
      if (pulse.age >= pulse.life) {
        pulse.active = false;
        continue;
      }
      pulse.radius += pulse.speed * motionDt;
    }
    this.eventShake = Math.max(0, this.eventShake - dt * 15);
    this.transitionKick = Math.max(0, this.transitionKick - dt * 1.7);
  }

  private updateAdaptiveQuality(frameInterval: number, playing: boolean): void {
    if (!playing || document.hidden) return;
    this.frameIntervalEma += (clamp(frameInterval, 5, 80) - this.frameIntervalEma) * 0.035;
    this.frameSamples += 1;
    const sampleTarget = this.frameIntervalEma > 22 ? 75 : 300;
    if (this.frameSamples < sampleTarget) return;
    this.frameSamples = 0;
    if (this.frameIntervalEma > 22 && (this.adaptiveScale > 0.66 || this.adaptiveTier < 2)) {
      this.adaptiveTier = Math.min(2, this.adaptiveTier + 1);
      this.adaptiveScale = Math.max(0.66, this.adaptiveScale - 0.14);
      const budget = this.particleBudget();
      for (let index = budget; index < this.particles.length; index += 1) {
        this.particles[index].active = false;
      }
      this.applyCanvasSize(true);
    } else if (this.frameIntervalEma < 17.5 && (this.adaptiveScale < 1 || this.adaptiveTier > 0)) {
      this.adaptiveTier = Math.max(0, this.adaptiveTier - 1);
      this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.08);
      this.applyCanvasSize(true);
    }
  }

  private initializeWebGL(): void {
    if (this.disposed || this.contextLost) return;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = this.backgroundCanvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      });
    } catch {
      gl = null;
    }

    if (!gl) {
      this.gl = null;
      this.glResources = null;
      try {
        this.background2d = this.backgroundCanvas.getContext("2d", {
          alpha: false,
          desynchronized: true,
        });
      } catch {
        this.background2d = null;
      }
      return;
    }

    this.gl = gl;
    this.background2d = null;
    const vertex = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      this.glResources = null;
      return;
    }

    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) {
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      this.glResources = null;
      return;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      this.glResources = null;
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    this.glResources = {
      program,
      buffer,
      position: gl.getAttribLocation(program, "a_position"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      core: gl.getUniformLocation(program, "u_core"),
      accent: gl.getUniformLocation(program, "u_accent"),
      time: gl.getUniformLocation(program, "u_time"),
      charge: gl.getUniformLocation(program, "u_charge"),
      nova: gl.getUniformLocation(program, "u_nova"),
      novaAge: gl.getUniformLocation(program, "u_novaAge"),
      phase: gl.getUniformLocation(program, "u_phase"),
      transition: gl.getUniformLocation(program, "u_transition"),
      flash: gl.getUniformLocation(program, "u_flash"),
      quality: gl.getUniformLocation(program, "u_quality"),
    };
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.backgroundCanvas.width, this.backgroundCanvas.height);
  }

  private compileShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private destroyGlResources(): void {
    if (!this.gl || !this.glResources || this.contextLost) {
      this.glResources = null;
      return;
    }
    this.gl.deleteBuffer(this.glResources.buffer);
    this.gl.deleteProgram(this.glResources.program);
    this.glResources = null;
  }

  private renderBackground(
    snapshot: GameSnapshot,
    coreX: number,
    coreY: number,
  ): boolean {
    const gl = this.gl;
    const resources = this.glResources;
    if (gl && resources && !this.contextLost) {
      const colorIndex = phaseIndex(snapshot.phaseIndex);
      const accent = PHASE_RGB[colorIndex];
      gl.viewport(0, 0, this.backgroundCanvas.width, this.backgroundCanvas.height);
      gl.useProgram(resources.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
      gl.enableVertexAttribArray(resources.position);
      gl.vertexAttribPointer(resources.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(
        resources.resolution,
        this.backgroundCanvas.width,
        this.backgroundCanvas.height,
      );
      gl.uniform2f(
        resources.core,
        coreX * this.pixelRatio,
        (this.height - coreY) * this.pixelRatio,
      );
      gl.uniform3f(resources.accent, accent[0], accent[1], accent[2]);
      gl.uniform1f(resources.time, this.visualTime);
      gl.uniform1f(resources.charge, clamp(snapshot.core.charge, 0, 1));
      gl.uniform1f(
        resources.nova,
        snapshot.core.novaStrength > 0
          ? this.novaVisualPower(snapshot.core.novaStrength)
          : 0,
      );
      gl.uniform1f(resources.novaAge, clamp(snapshot.core.novaAge, 0, 2));
      gl.uniform1f(resources.phase, colorIndex);
      gl.uniform1f(
        resources.transition,
        this.transitionProgress(snapshot),
      );
      gl.uniform1f(resources.flash, clamp(snapshot.flash, 0, 1));
      gl.uniform1f(
        resources.quality,
        Math.max(
          0.2,
          qualityShaderLevel(this.quality.level) - this.adaptiveTier * 0.35,
        ),
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }

    if (this.background2d) {
      this.background2d.setTransform(1, 0, 0, 1, 0, 0);
      this.background2d.clearRect(
        0,
        0,
        this.backgroundCanvas.width,
        this.backgroundCanvas.height,
      );
      this.background2d.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      this.drawFallbackBackground(this.background2d, snapshot, coreX, coreY);
      return true;
    }
    return false;
  }

  private drawFallbackBackground(
    ctx: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    coreX: number,
    coreY: number,
  ): void {
    const accent = PHASE_ACCENTS[phaseIndex(snapshot.phaseIndex)];
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#03060d";
    ctx.fillRect(0, 0, this.width, this.height);

    const atmosphere = ctx.createRadialGradient(
      coreX,
      coreY,
      0,
      coreX,
      coreY,
      Math.max(this.width, this.height) * 0.76,
    );
    atmosphere.addColorStop(0, "rgba(32, 51, 76, 0.32)");
    atmosphere.addColorStop(0.3, "rgba(12, 23, 43, 0.2)");
    atmosphere.addColorStop(1, "rgba(1, 3, 8, 0)");
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, this.width, this.height);

    const baseStarCount =
      this.quality.level === "high" ? 190 : this.quality.level === "medium" ? 125 : 72;
    const starScale =
      this.adaptiveTier === 0 ? 1 : this.adaptiveTier === 1 ? 0.68 : 0.42;
    const starCount = Math.max(36, Math.floor(baseStarCount * starScale));
    ctx.fillStyle = "#dcecff";
    for (let index = 0; index < starCount; index += 1) {
      const x = this.stars[index * 4] * this.width;
      const y = this.stars[index * 4 + 1] * this.height;
      const size = this.stars[index * 4 + 2];
      const phase = this.stars[index * 4 + 3];
      ctx.globalAlpha = 0.18 + (0.34 + Math.sin(this.visualTime * 0.7 + phase * 20) * 0.16) * phase;
      ctx.fillRect(x, y, size, size);
    }

    ctx.globalAlpha = 0.08 + clamp(snapshot.core.charge, 0, 1) * 0.08;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    const baseRingCount = this.quality.level === "low" ? 3 : 6;
    const ringCount = Math.max(2, baseRingCount - this.adaptiveTier * 2);
    for (let ring = 0; ring < ringCount; ring += 1) {
      const radius = 65 + ring * 44 + Math.sin(this.visualTime * 0.35 + ring) * 6;
      ctx.beginPath();
      ctx.ellipse(coreX, coreY, radius * 1.32, radius, ring * 0.21, 0.3, 5.75);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const vignette = ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.46,
      Math.min(this.width, this.height) * 0.12,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.16)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.68)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawTrail(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    const trail = snapshot.trail;
    if (trail.length < 2) return;
    const pointLimit = this.trailPointBudget();
    const start = Math.max(0, trail.length - pointLimit);
    const accent = PHASE_ACCENTS[phaseIndex(snapshot.phaseIndex)];
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(trail[start].x, trail[start].y);
    for (let index = start + 1; index < trail.length; index += 1) {
      ctx.lineTo(trail[index].x, trail[index].y);
    }
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    if (this.bloomEnabled()) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 12;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.52;
    ctx.strokeStyle = "#fff0bd";
    ctx.lineWidth = 1.35;
    ctx.stroke();

    if (snapshot.phase === "ECHO") {
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = "#ff766e";
      ctx.lineWidth = 3;
      ctx.translate(10, -7);
      ctx.stroke();
      ctx.translate(-19, 13);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFieldLines(
    ctx: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    coreX: number,
    coreY: number,
  ): void {
    const phase = phaseIndex(snapshot.phaseIndex);
    const accent = PHASE_ACCENTS[phase];
    const charge = clamp(snapshot.core.charge, 0, 1);
    const baseLineCount =
      this.quality.level === "low" ? 3 : this.quality.level === "medium" ? 5 : 7;
    const lineCount = Math.max(2, baseLineCount - this.adaptiveTier * 2);
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = 0.055 + charge * 0.055;

    if (snapshot.phase === "FRACTURE") {
      const spacing = Math.max(70, Math.min(this.width, this.height) / 7);
      for (let index = -2; index < lineCount + 3; index += 1) {
        const offset = index * spacing + (this.visualTime * 9) % spacing;
        ctx.beginPath();
        ctx.moveTo(offset - this.height * 0.35, 0);
        ctx.lineTo(offset + this.height * 0.35, this.height);
        ctx.stroke();
      }
    } else if (snapshot.phase === "FLOW") {
      for (let index = 0; index < lineCount; index += 1) {
        const y = ((index + 0.5) / lineCount) * this.height;
        const bend = Math.sin(this.visualTime * 0.45 + index * 1.7) * 42;
        ctx.beginPath();
        ctx.moveTo(-20, y);
        ctx.bezierCurveTo(
          this.width * 0.3,
          y + bend,
          coreX - 90,
          coreY - bend,
          coreX,
          coreY,
        );
        ctx.bezierCurveTo(
          coreX + 90,
          coreY + bend,
          this.width * 0.72,
          y - bend,
          this.width + 20,
          y,
        );
        ctx.stroke();
      }
    } else {
      for (let index = 0; index < lineCount; index += 1) {
        const radius = 50 + index * (28 + charge * 12);
        const squash = 0.7 + ((index + phase) % 3) * 0.09;
        ctx.beginPath();
        ctx.ellipse(
          coreX,
          coreY,
          radius * (1.12 + charge * 0.18),
          radius * squash,
          index * 0.34 + this.visualTime * 0.025,
          0.12 + index * 0.08,
          5.5 - index * 0.04,
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private transitionProgress(snapshot: GameSnapshot): number {
    const eventProgress = this.transitionKick > 0 ? 1 - this.transitionKick : 0;
    return clamp(Math.max(snapshot.phaseTransition, eventProgress), 0, 1);
  }

  private drawTransition(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    const transition = this.transitionProgress(snapshot);
    if (transition <= 0.002 || transition >= 0.998) return;
    const x = -35 + (this.width + 70) * transition;
    const accent = PHASE_ACCENTS[phaseIndex(snapshot.phaseIndex)];
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = Math.sin(transition * Math.PI) * 0.7;
    if (this.bloomEnabled()) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 12;
    }
    ctx.beginPath();
    ctx.moveTo(x, -20);
    const segments = this.quality.reducedMotion ? 8 : 18;
    for (let index = 1; index <= segments; index += 1) {
      const y = (index / segments) * (this.height + 40) - 20;
      const wave = Math.sin(index * 1.35 + this.visualTime * 3.1) * 8;
      ctx.lineTo(x + wave, y);
    }
    ctx.stroke();
    ctx.lineWidth = 18;
    ctx.globalAlpha *= 0.06;
    ctx.stroke();
    ctx.restore();
  }

  private drawCaptureTension(
    ctx: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    coreX: number,
    coreY: number,
    interpolation: number,
  ): void {
    const charge = clamp(snapshot.core.charge, 0, 1);
    let capturedCount = 0;
    let distanceTotal = 0;
    for (let index = 0; index < snapshot.entities.length; index += 1) {
      const entity = snapshot.entities[index];
      if (!entity.captured) continue;
      const x = entity.x + entity.vx * interpolation / 60;
      const y = entity.y + entity.vy * interpolation / 60;
      capturedCount += 1;
      distanceTotal += Math.hypot(x - coreX, y - coreY);
    }
    if (capturedCount === 0) return;

    const density = clamp(capturedCount / 7, 0, 1);
    const shortSide = Math.min(this.width, this.height);
    const orbitRadius = clamp(
      distanceTotal / capturedCount,
      snapshot.core.radius * 1.85,
      shortSide * 0.38,
    );
    ctx.save();
    ctx.strokeStyle = CAPTURE_AMBER;
    ctx.setLineDash(CAPTURE_DASH);
    ctx.lineDashOffset = -this.visualTime * (10 + charge * 18);
    ctx.lineWidth = 0.9 + charge * 1.05 + density * 0.35;
    ctx.globalAlpha = 0.2 + charge * 0.28 + density * 0.08;
    if (this.bloomEnabled()) {
      ctx.shadowColor = CAPTURE_AMBER;
      ctx.shadowBlur = 5 + charge * 5;
    }
    ctx.beginPath();
    ctx.ellipse(
      coreX,
      coreY,
      orbitRadius,
      orbitRadius * 0.8,
      this.visualTime * 0.08,
      0.18,
      5.86,
    );
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash(EMPTY_DASH);
    ctx.lineWidth = 0.85 + charge * 0.65;
    for (let index = 0; index < snapshot.entities.length; index += 1) {
      const entity = snapshot.entities[index];
      if (!entity.captured) continue;
      const x = entity.x + entity.vx * interpolation / 60;
      const y = entity.y + entity.vy * interpolation / 60;
      const dx = x - coreX;
      const dy = y - coreY;
      ctx.globalAlpha =
        (0.22 + charge * 0.4) /
        Math.max(1, Math.sqrt(capturedCount) * 0.72);
      ctx.beginPath();
      ctx.moveTo(coreX + dx * 0.28, coreY + dy * 0.28);
      ctx.quadraticCurveTo(
        coreX + dx * 0.58 - dy * (0.05 + charge * 0.04),
        coreY + dy * 0.58 + dx * (0.05 + charge * 0.04),
        x,
        y,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEntities(
    ctx: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    interpolation: number,
  ): void {
    const accent = PHASE_ACCENTS[phaseIndex(snapshot.phaseIndex)];
    for (let index = 0; index < snapshot.entities.length; index += 1) {
      const entity = snapshot.entities[index];
      const padding = entity.radius * 3 + 20;
      const x = entity.x + entity.vx * interpolation / 60;
      const y = entity.y + entity.vy * interpolation / 60;
      if (
        x < -padding ||
        y < -padding ||
        x > this.width + padding ||
        y > this.height + padding
      ) {
        continue;
      }
      const alpha = clamp(entity.alpha, 0, 1);
      if (alpha <= 0.001) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(entity.rotation);
      ctx.globalAlpha = alpha;
      if (
        this.bloomEnabled() &&
        (entity.kind === "energy" || entity.kind === "gate" || entity.captured)
      ) {
        ctx.shadowColor = entity.captured
          ? CAPTURE_AMBER
          : entity.kind === "energy"
            ? COLLECTIBLE_CYAN
            : accent;
        ctx.shadowBlur = 8;
      }
      switch (entity.kind) {
        case "energy":
          this.drawEnergy(ctx, entity);
          break;
        case "orbiter":
          this.drawOrbiter(ctx, entity, accent);
          break;
        case "gate":
          this.drawGate(ctx, entity, accent);
          break;
        case "crystal":
          this.drawCrystal(ctx, entity, false);
          break;
        case "fragment":
          this.drawCrystal(ctx, entity, true);
          break;
        case "droplet":
          this.drawDroplet(ctx, entity, accent);
          break;
        case "vortex":
          this.drawVortex(ctx, entity, accent);
          break;
        case "echo":
          this.drawEcho(ctx, entity);
          break;
        case "swarm":
          this.drawSwarm(ctx, entity);
          break;
      }
      ctx.shadowBlur = 0;
      // Material shading may attenuate alpha internally; state grammar must stay
      // equally legible across every entity kind.
      ctx.globalAlpha = alpha;
      if (entity.captured) {
        this.drawCapturedState(ctx, entity);
      } else if (entity.dangerous) {
        this.drawThreatSilhouette(ctx, entity);
      } else if (entity.kind === "energy" || isCapturableMatter(entity)) {
        this.drawCollectibleState(ctx, entity);
      }
      if (entity.vulnerable && !entity.dangerous && !entity.captured) {
        this.drawVulnerableNotch(ctx, entity.radius);
      }
      ctx.restore();
    }
  }

  private drawEnergy(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
  ): void {
    const radius = Math.max(3, entity.radius);
    ctx.fillStyle = COLLECTIBLE_CYAN;
    ctx.globalAlpha *= 0.34;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.85, 0, TAU);
    ctx.fill();
    ctx.globalAlpha *= 2.5;
    ctx.fillStyle = COLLECTIBLE_WHITE;
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius * 0.72, 0);
    ctx.lineTo(0, radius);
    ctx.lineTo(-radius * 0.72, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLLECTIBLE_CYAN;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.38, this.visualTime, this.visualTime + 3.8);
    ctx.stroke();
  }

  private drawOrbiter(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    accent: string,
  ): void {
    const radius = Math.max(5, entity.radius);
    ctx.fillStyle = entity.captured
      ? "#342510"
      : entity.dangerous
        ? "#2b171a"
        : "#12283a";
    ctx.strokeStyle = entity.captured
      ? CAPTURE_AMBER
      : entity.dangerous
        ? DANGER_CORAL
        : entity.vulnerable
          ? COLLECTIBLE_CYAN
          : accent;
    ctx.lineWidth = entity.captured ? 1.8 : entity.dangerous ? 1.35 : 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha *= 0.44;
    ctx.fillStyle = "#b9d7eb";
    ctx.beginPath();
    ctx.arc(-radius * 0.28, -radius * 0.32, radius * 0.43, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#07101d";
    ctx.lineWidth = Math.max(1, radius * 0.12);
    ctx.beginPath();
    ctx.arc(radius * 0.1, radius * 0.16, radius * 0.68, 3.55, 5.75);
    ctx.stroke();
  }

  private drawGate(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    accent: string,
  ): void {
    const radius = Math.max(13, entity.radius);
    ctx.strokeStyle = accent;
    ctx.lineCap = "round";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.72, radius * 1.45, 0, 0.24, Math.PI - 0.24);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.72, radius * 1.45, 0, Math.PI + 0.24, TAU - 0.24);
    ctx.stroke();
    ctx.globalAlpha *= 0.38;
    ctx.lineWidth = 7;
    ctx.setLineDash(GATE_DASH);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.9, radius * 1.67, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(EMPTY_DASH);
    ctx.globalAlpha *= 2.2;
    ctx.fillStyle = "#fff5d1";
    ctx.fillRect(-1.4, -radius * 1.58, 2.8, 7);
    ctx.fillRect(-1.4, radius * 1.58 - 7, 2.8, 7);
  }

  private drawCrystal(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    fragment: boolean,
  ): void {
    const radius = Math.max(fragment ? 3 : 8, entity.radius);
    const points = fragment ? 4 : 6;
    ctx.fillStyle = entity.captured
      ? "#35260f"
      : fragment
        ? "#294350"
        : "#163746";
    ctx.strokeStyle = entity.captured
      ? CAPTURE_AMBER
      : fragment
        ? "#b8f5ff"
        : "#8aeaff";
    ctx.lineWidth = entity.captured ? 1.55 : fragment ? 1 : 1.35;
    ctx.beginPath();
    for (let point = 0; point < points; point += 1) {
      const angle = (point / points) * TAU - Math.PI * 0.5;
      const variance = 0.72 + (((entity.seed + point * 17) % 23) / 23) * 0.44;
      const stretch = point % 2 === 0 ? 1.18 : 0.88;
      const x = Math.cos(angle) * radius * variance;
      const y = Math.sin(angle) * radius * variance * stretch;
      if (point === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha *= 0.44;
    ctx.fillStyle = entity.captured ? CAPTURE_WHITE : "#e6fcff";
    ctx.beginPath();
    ctx.moveTo(-radius * 0.12, -radius * 0.78);
    ctx.lineTo(radius * 0.48, radius * 0.1);
    ctx.lineTo(-radius * 0.2, radius * 0.48);
    ctx.closePath();
    ctx.fill();
    if (!fragment && entity.health > 0) {
      ctx.strokeStyle = "#d9fbff";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.78);
      ctx.lineTo(-radius * 0.12, -radius * 0.08);
      ctx.lineTo(radius * 0.2, radius * 0.2);
      ctx.lineTo(radius * 0.05, radius * 0.72);
      ctx.stroke();
    }
  }

  private drawDroplet(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    accent: string,
  ): void {
    const radius = Math.max(5, entity.radius);
    ctx.fillStyle = entity.captured
      ? "#342711"
      : entity.dangerous
        ? "#291921"
        : "#142b43";
    ctx.strokeStyle = entity.captured
      ? CAPTURE_AMBER
      : entity.dangerous
        ? DANGER_CORAL
        : entity.vulnerable
          ? COLLECTIBLE_CYAN
          : accent;
    ctx.lineWidth = entity.captured ? 1.65 : 1.1;
    ctx.beginPath();
    ctx.moveTo(radius * 1.25, 0);
    ctx.bezierCurveTo(radius * 0.34, -radius, -radius * 0.9, -radius * 0.72, -radius, 0);
    ctx.bezierCurveTo(-radius * 0.9, radius * 0.72, radius * 0.34, radius, radius * 1.25, 0);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha *= 0.52;
    ctx.fillStyle = "#e0f3ff";
    ctx.beginPath();
    ctx.ellipse(-radius * 0.25, -radius * 0.3, radius * 0.22, radius * 0.36, -0.6, 0, TAU);
    ctx.fill();
  }

  private drawVortex(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    accent: string,
  ): void {
    const radius = Math.max(9, entity.radius);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const baseSegments = this.quality.level === "low" ? 18 : 32;
    const segments = Math.max(12, baseSegments - this.adaptiveTier * 8);
    for (let point = 0; point <= segments; point += 1) {
      const progress = point / segments;
      const angle = progress * TAU * 2.3 + this.visualTime * 1.1;
      const r = radius * progress;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r * 0.74;
      if (point === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha *= 0.4;
    ctx.fillStyle = "#050913";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.3, 0, TAU);
    ctx.fill();
  }

  private drawEcho(ctx: CanvasRenderingContext2D, entity: Entity): void {
    const radius = Math.max(7, entity.radius);
    ctx.fillStyle = "#481d25";
    ctx.strokeStyle = "#ff8379";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.75, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha *= 0.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.25, radius * 0.55, 0.4, 0.1, 4.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.95, radius * 1.35, -0.55, 3.4, 5.5);
    ctx.stroke();
  }

  private drawSwarm(ctx: CanvasRenderingContext2D, entity: Entity): void {
    const radius = Math.max(4, entity.radius);
    const velocityAngle = Math.atan2(entity.vy, entity.vx) - entity.rotation;
    ctx.rotate(velocityAngle);
    ctx.fillStyle = entity.captured
      ? "#3b2a0c"
      : entity.vulnerable && !entity.dangerous
        ? "#1a5363"
        : entity.dangerous
          ? "#e6af3d"
          : "#9c863e";
    ctx.strokeStyle = entity.captured
      ? CAPTURE_AMBER
      : entity.vulnerable && !entity.dangerous
        ? COLLECTIBLE_WHITE
        : "#fff0a6";
    ctx.lineWidth = entity.captured ? 1.25 : 0.8;
    ctx.beginPath();
    ctx.moveTo(radius * 1.4, 0);
    ctx.lineTo(-radius * 0.75, -radius * 0.68);
    ctx.lineTo(-radius * 0.35, 0);
    ctx.lineTo(-radius * 0.75, radius * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0c0d0e";
    ctx.beginPath();
    ctx.arc(radius * 0.35, 0, Math.max(1, radius * 0.16), 0, TAU);
    ctx.fill();
  }

  private drawCapturedState(ctx: CanvasRenderingContext2D, entity: Entity): void {
    const radius = Math.max(6, entity.radius);
    const pulse = this.quality.reducedMotion
      ? 0.5
      : 0.5 + Math.sin(this.visualTime * 4.2 + entity.seed * 0.001) * 0.5;
    const r = radius * (1.32 + pulse * 0.06);
    ctx.save();
    ctx.strokeStyle = CAPTURE_AMBER;
    ctx.fillStyle = CAPTURE_WHITE;
    ctx.lineWidth = 1.3;
    ctx.globalAlpha *= 0.68 + pulse * 0.16;
    if (this.bloomEnabled()) {
      ctx.shadowColor = CAPTURE_AMBER;
      ctx.shadowBlur = 7;
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, -0.95, 0.82);
    ctx.moveTo(-r * 0.58, r * 0.82);
    ctx.arc(0, 0, r, 2.2, 4.02);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(r * 0.72, -r * 0.63, 1.15 + pulse * 0.45, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawCollectibleState(ctx: CanvasRenderingContext2D, entity: Entity): void {
    const radius = Math.max(6, entity.radius);
    const pulse = this.quality.reducedMotion
      ? 0.5
      : 0.5 + Math.sin(this.visualTime * 3 + entity.seed * 0.0007) * 0.5;
    const r = radius * (1.28 + pulse * 0.05);
    ctx.save();
    ctx.strokeStyle = COLLECTIBLE_CYAN;
    ctx.lineWidth = 1;
    ctx.globalAlpha *= entity.kind === "energy" ? 0.68 : 0.42 + pulse * 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, r, -0.72, 0.15);
    ctx.moveTo(-r * 0.75, r * 0.3);
    ctx.arc(0, 0, r, 2.34, 3.15);
    ctx.stroke();
    ctx.restore();
  }

  private drawThreatSilhouette(ctx: CanvasRenderingContext2D, entity: Entity): void {
    const pulse = this.quality.reducedMotion
      ? 0.5
      : 0.5 + Math.sin(this.visualTime * 5.4 + entity.seed * 0.0009) * 0.5;
    const r = Math.max(6, entity.radius * (1.23 + pulse * 0.12));
    ctx.strokeStyle = DANGER_CORAL;
    ctx.lineWidth = 1.05 + pulse * 0.35;
    ctx.globalAlpha *= 0.54 + pulse * 0.26;
    ctx.beginPath();
    ctx.arc(0, 0, r, -0.72, 0.72);
    ctx.moveTo(-r * 0.75, -r * 0.42);
    ctx.arc(0, 0, r, 2.42, 3.86);
    ctx.stroke();
  }

  private drawVulnerableNotch(
    ctx: CanvasRenderingContext2D,
    radius: number,
  ): void {
    const r = Math.max(7, radius * 1.05);
    ctx.strokeStyle = COLLECTIBLE_WHITE;
    ctx.lineWidth = 2;
    ctx.globalAlpha *= 0.8;
    ctx.beginPath();
    ctx.moveTo(r * 0.65, -r * 0.82);
    ctx.lineTo(r * 0.9, -r * 0.52);
    ctx.lineTo(r * 0.56, -r * 0.3);
    ctx.stroke();
  }

  private drawPulses(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.lineCap = "round";
    for (let index = 0; index < this.pulses.length; index += 1) {
      const pulse = this.pulses[index];
      if (!pulse.active) continue;
      const progress = clamp(pulse.age / pulse.life, 0, 1);
      const alpha = (1 - progress) * (1 - progress) * pulse.strength;
      ctx.globalAlpha = clamp(alpha, 0, 0.9);
      ctx.strokeStyle = PARTICLE_COLORS[pulse.color];
      ctx.lineWidth = pulse.kind === 1
        ? 2.4
        : pulse.kind === 3
          ? 1.8 + (1 - progress) * 2.5
          : 1.5 + (1 - progress) * 1.8;
      if (this.bloomEnabled() && pulse.kind !== 1) {
        ctx.shadowColor = PARTICLE_COLORS[pulse.color];
        ctx.shadowBlur = 10;
      }
      ctx.beginPath();
      if (pulse.kind === 1) {
        const points = 9;
        for (let point = 0; point <= points; point += 1) {
          const angle = (point / points) * TAU;
          const jag = 0.86 + (((point * 17 + index * 11) % 7) / 7) * 0.25;
          const x = pulse.x + Math.cos(angle) * pulse.radius * jag;
          const y = pulse.y + Math.sin(angle) * pulse.radius * jag;
          if (point === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else if (pulse.kind === 2) {
        ctx.ellipse(
          pulse.x,
          pulse.y,
          pulse.radius * 1.3,
          pulse.radius * 0.74,
          progress * 0.28,
          0,
          TAU,
        );
      } else if (pulse.kind === 3) {
        // Loaded Nova: one coherent front plus a tighter trailing ring. The
        // paired geometry reads as stored mass releasing, without more sprites.
        ctx.arc(pulse.x, pulse.y, pulse.radius, 0, TAU);
        ctx.moveTo(pulse.x + pulse.radius * 0.72, pulse.y);
        ctx.arc(pulse.x, pulse.y, pulse.radius * 0.72, 0, TAU);
      } else {
        ctx.arc(pulse.x, pulse.y, pulse.radius, 0, TAU);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    const budget = this.particleBudget();
    for (let index = 0; index < budget; index += 1) {
      const particle = this.particles[index];
      if (!particle.active) continue;
      const progress = clamp(particle.age / particle.life, 0, 1);
      ctx.globalAlpha = (1 - progress) * (particle.shape === 1 ? 0.85 : 0.72);
      ctx.fillStyle = PARTICLE_COLORS[particle.color];
      if (particle.shape === 1) {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.beginPath();
        ctx.moveTo(particle.size * 1.5, 0);
        ctx.lineTo(-particle.size * 0.7, -particle.size * 0.42);
        ctx.lineTo(-particle.size * 0.3, particle.size * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (particle.shape === 2) {
        const speed = Math.hypot(particle.vx, particle.vy);
        const inv = speed > 0.001 ? 1 / speed : 0;
        ctx.strokeStyle = PARTICLE_COLORS[particle.color];
        ctx.lineWidth = particle.size * 0.6;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(
          particle.x - particle.vx * inv * particle.size * 3.2,
          particle.y - particle.vy * inv * particle.size * 3.2,
        );
        ctx.stroke();
      } else {
        ctx.fillRect(
          particle.x - particle.size * 0.5,
          particle.y - particle.size * 0.5,
          particle.size,
          particle.size,
        );
      }
    }
    ctx.restore();
  }

  private drawCore(
    ctx: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    x: number,
    y: number,
  ): void {
    const core = snapshot.core;
    const radius = Math.max(9, core.radius);
    const charge = clamp(core.charge, 0, 1);
    let capturedCount = 0;
    for (let index = 0; index < snapshot.entities.length; index += 1) {
      if (snapshot.entities[index].captured) capturedCount += 1;
    }
    const massLoad = clamp(capturedCount / 6, 0, 1);
    const hit = clamp(core.hitFlash, 0, 1);
    const blink =
      core.invulnerable > 0 && Math.sin(this.visualTime * 32) < -0.35
        ? 0.48
        : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = blink;

    if (charge > 0.01 || capturedCount > 0) {
      const haloReach = radius * (3.2 + charge * 2.8 + massLoad * 0.65);
      const halo = ctx.createRadialGradient(0, 0, radius, 0, 0, haloReach);
      halo.addColorStop(
        0,
        `rgba(255, 177, 63, ${0.14 + charge * 0.11 + massLoad * 0.04})`,
      );
      halo.addColorStop(
        0.36,
        `rgba(255, 133, 40, ${charge * 0.055 + massLoad * 0.025})`,
      );
      halo.addColorStop(1, "rgba(255, 110, 20, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloReach, 0, TAU);
      ctx.fill();
    }

    ctx.rotate(this.visualTime * 0.16);
    ctx.fillStyle = "rgba(255, 153, 48, 0.16)";
    ctx.beginPath();
    const coronaPoints = this.quality.reducedMotion ? 12 : 18;
    for (let point = 0; point < coronaPoints; point += 1) {
      const angle = (point / coronaPoints) * TAU;
      const flicker = this.quality.reducedMotion
        ? 1
        : 0.9 + Math.sin(point * 5.3 + this.visualTime * 8.4) * 0.09;
      const outer = point % 2 === 0 ? 1.72 + charge * 0.34 : 1.32;
      const px = Math.cos(angle) * radius * outer * flicker;
      const py = Math.sin(angle) * radius * outer * flicker;
      if (point === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-this.visualTime * 0.16);

    if (this.bloomEnabled()) {
      ctx.shadowColor = "#ff9d34";
      ctx.shadowBlur = 13 + charge * 7;
    }
    const outer = ctx.createRadialGradient(
      -radius * 0.28,
      -radius * 0.34,
      radius * 0.1,
      0,
      0,
      radius * 1.28,
    );
    outer.addColorStop(0, "#fffef2");
    outer.addColorStop(0.34, "#fff1af");
    outer.addColorStop(0.72, "#ffae3d");
    outer.addColorStop(1, "rgba(196, 58, 12, 0.12)");
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.24, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#fff4b5";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.84, 0, TAU);
    ctx.fill();
    ctx.fillStyle = hit > 0 ? "#ffffff" : "#fffef2";
    ctx.beginPath();
    ctx.arc(-radius * 0.12, -radius * 0.14, radius * 0.53, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "#ffae45";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.2, radius * 0.11);
    ctx.globalAlpha *= 0.95;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.78, radius * 0.68, -0.37, 2.48, 5.8);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, radius * 0.075);
    ctx.strokeStyle = "#fff1b0";
    ctx.globalAlpha *= 0.72;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.12, radius * 1.62, 0.68, 3.75, 5.7);
    ctx.stroke();

    if (capturedCount > 0) {
      const segments = Math.min(8, capturedCount);
      const segmentRadius = radius * (2.02 + charge * 0.16);
      const gap = 0.13;
      ctx.save();
      ctx.strokeStyle = CAPTURE_AMBER;
      ctx.lineWidth = 1.7 + massLoad * 0.7;
      ctx.globalAlpha = blink * (0.55 + charge * 0.28);
      if (this.bloomEnabled()) {
        ctx.shadowColor = CAPTURE_AMBER;
        ctx.shadowBlur = 7;
      }
      for (let segment = 0; segment < segments; segment += 1) {
        const start = -Math.PI * 0.5 + (segment / segments) * TAU + gap;
        const end = -Math.PI * 0.5 + ((segment + 1) / segments) * TAU - gap;
        ctx.beginPath();
        ctx.arc(0, 0, segmentRadius, start, end);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (charge > 0.04) {
      ctx.strokeStyle = "#ffd078";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.22 + charge * 0.52;
      const orbitCount = charge > 0.65 ? 3 : 2;
      for (let orbit = 0; orbit < orbitCount; orbit += 1) {
        const r = radius * (1.62 + orbit * 0.5 - charge * 0.12);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          r,
          r * (0.55 + orbit * 0.12),
          orbit * 0.8 - this.visualTime * (0.25 + orbit * 0.08),
          0.1,
          5.55,
        );
        ctx.stroke();
      }
      const satelliteAngle = this.visualTime * (2.6 + charge * 3.8);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(
        Math.cos(satelliteAngle) * radius * 1.85,
        Math.sin(satelliteAngle) * radius * 1.05,
        1.4 + charge,
        0,
        TAU,
      );
      ctx.fill();
    }

    if (hit > 0) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 + hit * 3;
      ctx.globalAlpha = hit;
      ctx.beginPath();
      ctx.arc(0, 0, radius * (1.5 + hit * 0.7), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    if (core.novaAge > 0 && core.novaStrength > 0) {
      const visualPower = this.novaVisualPower(core.novaStrength);
      const tier = getNovaFeedbackTier(core.novaStrength, this.lastNovaCaptured);
      const loaded = tier === "loaded";
      const charged = tier === "charged";
      const duration = loaded
        ? 0.68 + visualPower * 0.34
        : charged
          ? 0.5 + visualPower * 0.22
          : 0.38 + visualPower * 0.14;
      const progress = clamp(core.novaAge / duration, 0, 1);
      if (progress >= 1) return;
      const shortSide = Math.min(this.width, this.height);
      const travel = loaded
        ? shortSide * (0.28 + visualPower * 0.3)
        : charged
          ? shortSide * (0.15 + visualPower * 0.15)
          : shortSide * (0.085 + visualPower * 0.08);
      ctx.save();
      ctx.strokeStyle = loaded
        ? CAPTURE_AMBER
        : charged
          ? COLLECTIBLE_CYAN
          : CAPTURE_WHITE;
      ctx.lineWidth = loaded
        ? 1.5 + (1 - progress) * (2.2 + visualPower * 2.1)
        : charged
          ? 1.2 + (1 - progress) * (1.4 + visualPower * 0.7)
          : 1 + (1 - progress) * 1.1;
      ctx.globalAlpha = (1 - progress) * (
        loaded
          ? 0.34 + visualPower * 0.4
          : charged
            ? 0.25 + visualPower * 0.24
            : 0.18 + visualPower * 0.14
      );
      if (this.bloomEnabled() && loaded) {
        ctx.shadowColor = CAPTURE_AMBER;
        ctx.shadowBlur = 7 + visualPower * 7;
      }
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.2 + progress * travel, 0, TAU);
      ctx.stroke();
      if (loaded && visualPower > 0.42) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha *= 0.42;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.2 + progress * travel * 0.76, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawEdgeVignette(ctx: CanvasRenderingContext2D, flash: number): void {
    ctx.save();
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    const edge = Math.max(28, Math.min(this.width, this.height) * 0.08);
    const gradient = ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.5,
      Math.min(this.width, this.height) * 0.28,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.7,
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.76, "rgba(0,0,0,0.03)");
    gradient.addColorStop(1, "rgba(0,0,0,0.36)");
    ctx.fillStyle = gradient;
    ctx.fillRect(-edge, -edge, this.width + edge * 2, this.height + edge * 2);
    const flashAmount = clamp(flash, 0, 1);
    if (flashAmount > 0.002) {
      ctx.globalAlpha = flashAmount * 0.1;
      ctx.fillStyle = "#fff0c8";
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.restore();
  }
}
