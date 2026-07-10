// @ts-expect-error Node's native TypeScript runner requires the source extension.
import { PHASES, type GameMetrics, type GameMode } from "./types.ts";

/**
 * Increment this only when a physics/scoring change makes old seeded challenges
 * incomparable. It is part of Daily seeds, challenge links, and local PB keys.
 */
export const RULESET_VERSION = 1 as const;
export const RULESET_ID = `sol-shift/${RULESET_VERSION}` as const;

// Challenge schema and deterministic physics advance together, so a link can
// never silently compare scores produced by incompatible rules.
export const CHALLENGE_URL_VERSION = RULESET_VERSION;
export const DEFAULT_CHALLENGE_BASE = "https://solshift.game/";
export const STORAGE_NAMESPACE = `sol-shift:${RULESET_VERSION}`;
export const MAX_SCORE = Number.MAX_SAFE_INTEGER;
export const MAX_CHALLENGE_URL_LENGTH = 2_048;

const DAY_MS = 86_400_000;
const UINT32_MAX = 0xffff_ffff;
const PHASE_CODES = ["O", "F", "W", "E", "S", "N"] as const;

/** A five-star phase is intentionally aspirational, not merely a completion mark. */
export const PHASE_GRADE_TARGETS = [900, 1_200, 1_500, 1_800, 2_200, 2_800] as const;

export const ARCHETYPES = [
  "Orbit Architect",
  "Chaos Engineer",
  "Patient Singularity",
  "Nova Addict",
  "Gravity Gremlin",
  "Precision Pilot",
] as const;

export type Archetype = (typeof ARCHETYPES)[number];
export type PhaseGrade = 0 | 1 | 2 | 3 | 4 | 5;
export type PhaseGrades = readonly [
  PhaseGrade,
  PhaseGrade,
  PhaseGrade,
  PhaseGrade,
  PhaseGrade,
  PhaseGrade,
];

export interface DailyShift {
  /** YYYY-MM-DD in UTC. */
  date: string;
  /** Days since the Unix epoch; useful as the human-facing challenge number. */
  challengeNumber: number;
  seed: number;
  rulesetVersion: typeof RULESET_VERSION;
}

export interface Challenge {
  version: typeof CHALLENGE_URL_VERSION;
  mode: GameMode;
  seed: number;
  target: number;
  archetype?: Archetype;
}

export type ChallengeParseErrorCode =
  | "invalid-url"
  | "invalid-protocol"
  | "unknown-parameter"
  | "duplicate-parameter"
  | "missing-parameter"
  | "unsupported-version"
  | "invalid-mode"
  | "invalid-seed"
  | "invalid-target"
  | "invalid-archetype";

export type ChallengeParseResult =
  | { ok: true; challenge: Challenge; canonicalUrl: string }
  | { ok: false; code: ChallengeParseErrorCode };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type StorageGuard<T> = (value: unknown) => value is T;

export interface RunProgress {
  attempts: number;
  personalBest: number | null;
  lastScore: number | null;
}

export interface RecordedAttempt extends RunProgress {
  attempt: number;
  score: number;
  previousPersonalBest: number | null;
  isPersonalBest: boolean;
  /** Score minus the PB that existed before this attempt. */
  personalBestDelta: number | null;
  persisted: boolean;
}

export interface FinalScoreBreakdown {
  finalScore: number;
  bankedPoints: number;
  liveFluxPoints: number;
  survivalSeconds: number;
  survivalRatio: number;
  energyCollected: number;
  largestChain: number;
  highestCombo: number;
  nearMisses: number;
  novas: number;
  collisions: number;
  phasesCompleted: number;
  phaseScores: readonly [number, number, number, number, number, number];
}

export interface ArchetypeMetrics {
  energyCollected: number;
  largestChain: number;
  highestCombo: number;
  nearMisses: number;
  novaCount: number;
  collisions: number;
  survivalSeconds?: number;
}

export interface RunResult {
  mode: GameMode;
  seed: number;
  score: number;
  survivalSeconds: number;
  archetype: Archetype;
  bestCombo: number;
  phaseGrades: PhaseGrades;
  signature: string;
  challengeNumber?: number;
  attempt?: number;
  isPersonalBest?: boolean;
  personalBest?: number | null;
  challengerTarget?: number | null;
}

export interface RunResultInput {
  mode: GameMode;
  seed: number;
  survivalSeconds: number;
  metrics: GameMetrics;
  challengeNumber?: number;
  attempt?: number;
  isPersonalBest?: boolean;
  personalBest?: number | null;
  challengerTarget?: number | null;
}

export type ScoreDeltaState = "ahead" | "tied" | "behind";

export interface ScoreDelta {
  score: number;
  reference: number;
  delta: number;
  state: ScoreDeltaState;
}

export interface ResultDeltas {
  challenger: ScoreDelta | null;
  personalBest: ScoreDelta | null;
}

function finiteNonNegative(value: number, maximum = MAX_SCORE): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, value));
}

function wholeNonNegative(value: number, maximum = MAX_SCORE): number {
  return Math.floor(finiteNonNegative(value, maximum));
}

function assertMode(mode: unknown): asserts mode is GameMode {
  if (mode !== "daily" && mode !== "endless") {
    throw new RangeError("mode must be daily or endless");
  }
}

function assertSeed(seed: unknown): asserts seed is number {
  if (!Number.isSafeInteger(seed) || Number(seed) < 0 || Number(seed) > UINT32_MAX) {
    throw new RangeError("seed must be an unsigned 32-bit integer");
  }
}

function assertScore(score: unknown): asserts score is number {
  if (!Number.isSafeInteger(score) || Number(score) < 0 || Number(score) > MAX_SCORE) {
    throw new RangeError("score must be a non-negative safe integer");
  }
}

function isArchetype(value: unknown): value is Archetype {
  return typeof value === "string" && (ARCHETYPES as readonly string[]).includes(value);
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function validDate(date: Date): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError("date must be valid");
  }
  return date;
}

export function utcDateKey(date = new Date()): string {
  return validDate(date).toISOString().slice(0, 10);
}

export function utcChallengeNumber(date = new Date()): number {
  const value = validDate(date);
  return Math.floor(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ) / DAY_MS);
}

export function utcDailySeed(
  date = new Date(),
  rulesetVersion: number = RULESET_VERSION,
): number {
  if (!Number.isSafeInteger(rulesetVersion) || rulesetVersion < 1 || rulesetVersion > 0xffff) {
    throw new RangeError("rulesetVersion must be an integer from 1 to 65535");
  }
  const key = `${utcDateKey(date)}|sol-shift|ruleset:${rulesetVersion}`;
  return mix32(fnv1a(key) ^ Math.imul(rulesetVersion, 0x9e3779b9));
}

export function getDailyShift(date = new Date()): DailyShift {
  return {
    date: utcDateKey(date),
    challengeNumber: utcChallengeNumber(date),
    seed: utcDailySeed(date),
    rulesetVersion: RULESET_VERSION,
  };
}

export function compactSeed(seed: number): string {
  assertSeed(seed);
  return seed.toString(36).toUpperCase().padStart(7, "0");
}

const ARCHETYPE_TO_SLUG: Record<Archetype, string> = {
  "Orbit Architect": "orbit-architect",
  "Chaos Engineer": "chaos-engineer",
  "Patient Singularity": "patient-singularity",
  "Nova Addict": "nova-addict",
  "Gravity Gremlin": "gravity-gremlin",
  "Precision Pilot": "precision-pilot",
};

const SLUG_TO_ARCHETYPE = Object.fromEntries(
  Object.entries(ARCHETYPE_TO_SLUG).map(([name, slug]) => [slug, name]),
) as Record<string, Archetype>;

const CHALLENGE_PARAMS = ["v", "mode", "seed", "target", "archetype"] as const;
const REQUIRED_CHALLENGE_PARAMS = ["v", "mode", "seed", "target"] as const;

function browserLocation(): string | undefined {
  try {
    return typeof globalThis.location?.href === "string" ? globalThis.location.href : undefined;
  } catch {
    return undefined;
  }
}

function challengeBase(input?: string | URL): URL {
  const fallback = browserLocation() ?? DEFAULT_CHALLENGE_BASE;
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input ?? fallback, fallback);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("challenge URLs require http or https");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url;
}

function canonicalChallenge(challenge: Challenge, base?: string | URL): string {
  const url = challengeBase(base);
  url.searchParams.set("v", String(challenge.version));
  url.searchParams.set("mode", challenge.mode);
  url.searchParams.set("seed", String(challenge.seed));
  url.searchParams.set("target", String(challenge.target));
  if (challenge.archetype) {
    url.searchParams.set("archetype", ARCHETYPE_TO_SLUG[challenge.archetype]);
  }
  const encoded = url.toString();
  if (encoded.length > MAX_CHALLENGE_URL_LENGTH) {
    throw new RangeError("challenge URL is too long");
  }
  return encoded;
}

export function encodeChallengeUrl(
  challenge: Omit<Challenge, "version"> & { version?: typeof CHALLENGE_URL_VERSION },
  base?: string | URL,
): string {
  const version = challenge.version ?? CHALLENGE_URL_VERSION;
  if (version !== CHALLENGE_URL_VERSION) {
    throw new RangeError(`unsupported challenge URL version: ${String(version)}`);
  }
  assertMode(challenge.mode);
  assertSeed(challenge.seed);
  assertScore(challenge.target);
  if (challenge.archetype !== undefined && !isArchetype(challenge.archetype)) {
    throw new RangeError("unknown archetype");
  }
  return canonicalChallenge({ ...challenge, version }, base);
}

function strictDecimal(
  value: string | null,
  maximum: number,
): number | null {
  if (value === null || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

export function parseChallengeUrl(
  input: string | URL,
  relativeTo?: string | URL,
): ChallengeParseResult {
  let url: URL;
  try {
    if (input.toString().length > MAX_CHALLENGE_URL_LENGTH) {
      return { ok: false, code: "invalid-url" };
    }
    const fallback = relativeTo?.toString() ?? browserLocation() ?? DEFAULT_CHALLENGE_BASE;
    url = input instanceof URL ? new URL(input.toString()) : new URL(input, fallback);
  } catch {
    return { ok: false, code: "invalid-url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, code: "invalid-protocol" };
  }

  for (const key of url.searchParams.keys()) {
    if (!(CHALLENGE_PARAMS as readonly string[]).includes(key)) {
      return { ok: false, code: "unknown-parameter" };
    }
    if (url.searchParams.getAll(key).length !== 1) {
      return { ok: false, code: "duplicate-parameter" };
    }
  }

  for (const key of REQUIRED_CHALLENGE_PARAMS) {
    if (!url.searchParams.has(key)) return { ok: false, code: "missing-parameter" };
  }

  if (url.searchParams.get("v") !== String(CHALLENGE_URL_VERSION)) {
    return { ok: false, code: "unsupported-version" };
  }

  const mode = url.searchParams.get("mode");
  if (mode !== "daily" && mode !== "endless") {
    return { ok: false, code: "invalid-mode" };
  }

  const seed = strictDecimal(url.searchParams.get("seed"), UINT32_MAX);
  if (seed === null) return { ok: false, code: "invalid-seed" };

  const target = strictDecimal(url.searchParams.get("target"), MAX_SCORE);
  if (target === null) return { ok: false, code: "invalid-target" };

  const archetypeSlug = url.searchParams.get("archetype");
  const archetype = archetypeSlug === null ? undefined : SLUG_TO_ARCHETYPE[archetypeSlug];
  if (archetypeSlug !== null && !archetype) {
    return { ok: false, code: "invalid-archetype" };
  }

  const challenge: Challenge = {
    version: CHALLENGE_URL_VERSION,
    mode,
    seed,
    target,
    ...(archetype ? { archetype } : {}),
  };
  return {
    ok: true,
    challenge,
    canonicalUrl: canonicalChallenge(challenge, `${url.origin}${url.pathname}`),
  };
}

export function decodeChallengeUrl(
  input: string | URL,
  relativeTo?: string | URL,
): Challenge | null {
  const result = parseChallengeUrl(input, relativeTo);
  return result.ok ? result.challenge : null;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A JSON adapter which never lets storage policy, quota, or corrupt data break a
 * result screen. Successful writes are mirrored in memory; failed writes remain
 * usable for the current page session.
 */
export class SafeStorageAdapter {
  readonly namespace: string;
  private readonly storage: StorageLike | null;
  private readonly memory = new Map<string, string>();
  /** Keys whose newest value could not be committed and must win this session. */
  private readonly memoryAuthoritative = new Set<string>();

  constructor(storage?: StorageLike | null, namespace = STORAGE_NAMESPACE) {
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.namespace = namespace.replace(/:+$/u, "");
  }

  private namespaced(key: string): string {
    return `${this.namespace}:${key}`;
  }

  read<T>(key: string, guard?: StorageGuard<T>): T | null {
    const namespaced = this.namespaced(key);
    let raw = this.memoryAuthoritative.has(namespaced)
      ? this.memory.get(namespaced) ?? null
      : null;
    if (raw === null) {
      try {
        raw = this.storage?.getItem(namespaced) ?? null;
      } catch {
        raw = null;
      }
      raw ??= this.memory.get(namespaced) ?? null;
    }
    if (raw === null) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (guard && !guard(parsed)) throw new TypeError("invalid stored value");
      this.memory.set(namespaced, raw);
      return parsed as T;
    } catch {
      this.memory.delete(namespaced);
      this.memoryAuthoritative.delete(namespaced);
      try {
        this.storage?.removeItem?.(namespaced);
      } catch {
        // A disabled store is equivalent to no persistent store.
      }
      return null;
    }
  }

  /** Returns whether the value reached persistent storage. */
  write(key: string, value: unknown): boolean {
    let raw: string;
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return false;
      raw = serialized;
    } catch {
      return false;
    }

    const namespaced = this.namespaced(key);
    this.memory.set(namespaced, raw);
    try {
      if (!this.storage) {
        this.memoryAuthoritative.add(namespaced);
        return false;
      }
      this.storage.setItem(namespaced, raw);
      this.memoryAuthoritative.delete(namespaced);
      return true;
    } catch {
      this.memoryAuthoritative.add(namespaced);
      return false;
    }
  }

  remove(key: string): void {
    const namespaced = this.namespaced(key);
    this.memory.delete(namespaced);
    this.memoryAuthoritative.delete(namespaced);
    try {
      this.storage?.removeItem?.(namespaced);
    } catch {
      // Best effort by design.
    }
  }
}

function isRunProgress(value: unknown): value is RunProgress {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RunProgress>;
  const optionalScore = (score: unknown) => score === null
    || (Number.isSafeInteger(score) && Number(score) >= 0 && Number(score) <= MAX_SCORE);
  return Number.isSafeInteger(item.attempts)
    && Number(item.attempts) >= 0
    && optionalScore(item.personalBest)
    && optionalScore(item.lastScore);
}

function emptyProgress(): RunProgress {
  return { attempts: 0, personalBest: null, lastScore: null };
}

export class RunHistory {
  private readonly adapter: SafeStorageAdapter;

  constructor(adapter = new SafeStorageAdapter()) {
    this.adapter = adapter;
  }

  private key(mode: GameMode, seed: number): string {
    assertMode(mode);
    assertSeed(seed);
    return `runs:${mode}:${seed}`;
  }

  get(mode: GameMode, seed: number): RunProgress {
    return this.adapter.read(this.key(mode, seed), isRunProgress) ?? emptyProgress();
  }

  /** Atomically counts a completed attempt and updates its per-mode/per-seed PB. */
  record(mode: GameMode, seed: number, score: number): RecordedAttempt {
    assertScore(score);
    const key = this.key(mode, seed);
    const previous = this.adapter.read(key, isRunProgress) ?? emptyProgress();
    const isPersonalBest = previous.personalBest === null || score > previous.personalBest;
    const personalBest = isPersonalBest ? score : previous.personalBest;
    const next: RunProgress = {
      attempts: Math.min(Number.MAX_SAFE_INTEGER, previous.attempts + 1),
      personalBest,
      lastScore: score,
    };
    const persisted = this.adapter.write(key, next);
    return {
      ...next,
      attempt: next.attempts,
      score,
      previousPersonalBest: previous.personalBest,
      isPersonalBest,
      personalBestDelta: previous.personalBest === null ? null : score - previous.personalBest,
      persisted,
    };
  }

  clear(mode: GameMode, seed: number): void {
    this.adapter.remove(this.key(mode, seed));
  }
}

function metric(value: number): number {
  return wholeNonNegative(value);
}

export function finalScoreBreakdown(
  metrics: GameMetrics,
  survivalSeconds: number,
  mode: GameMode = "daily",
): FinalScoreBreakdown {
  assertMode(mode);
  const explicitScore = finiteNonNegative(metrics.score);
  const accounted = finiteNonNegative(metrics.bankedScore) + finiteNonNegative(metrics.unbankedFlux);
  const finalScore = Math.floor(explicitScore || accounted);
  const bankedPoints = Math.min(finalScore, Math.floor(finiteNonNegative(metrics.bankedScore)));
  const phaseScores = PHASES.map((_, index) => metric(metrics.phaseScores[index] ?? 0)) as unknown as FinalScoreBreakdown["phaseScores"];
  const normalizedSurvival = finiteNonNegative(
    survivalSeconds,
    mode === "daily" ? 60 : MAX_SCORE,
  );
  return {
    finalScore,
    bankedPoints,
    liveFluxPoints: finalScore - bankedPoints,
    survivalSeconds: normalizedSurvival,
    survivalRatio: Math.min(1, normalizedSurvival / 60),
    energyCollected: metric(metrics.energyCollected),
    largestChain: metric(metrics.largestChain),
    highestCombo: metric(metrics.highestCombo),
    nearMisses: metric(metrics.nearMisses),
    novas: metric(metrics.novaCount),
    collisions: metric(metrics.collisions),
    phasesCompleted: metrics.phaseCompleted.slice(0, PHASES.length).filter(Boolean).length,
    phaseScores,
  };
}

export function finalScoreFromMetrics(metrics: GameMetrics): number {
  return finalScoreBreakdown(metrics, 0).finalScore;
}

export function gradePhaseScore(score: number, target: number): PhaseGrade {
  const points = finiteNonNegative(score);
  const goal = Math.max(1, finiteNonNegative(target, MAX_SCORE));
  if (points <= 0) return 0;
  const ratio = points / goal;
  if (ratio < 0.2) return 1;
  if (ratio < 0.4) return 2;
  if (ratio < 0.65) return 3;
  if (ratio < 1) return 4;
  return 5;
}

export function gradePhaseScores(scores: readonly number[]): PhaseGrades {
  return PHASES.map((_, index) => gradePhaseScore(
    scores[index] ?? 0,
    PHASE_GRADE_TARGETS[index],
  )) as unknown as PhaseGrades;
}

export function phaseGradesFromMetrics(metrics: Pick<GameMetrics, "phaseScores">): PhaseGrades {
  return gradePhaseScores(metrics.phaseScores);
}

function validGrades(grades: readonly number[]): grades is PhaseGrades {
  return grades.length === PHASES.length
    && grades.every((grade) => Number.isInteger(grade) && grade >= 0 && grade <= 5);
}

export function formatShiftSignature(grades: PhaseGrades): string {
  if (!validGrades(grades)) throw new RangeError("Shift Signature requires six grades from 0 to 5");
  return PHASE_CODES.map((code, index) => `${code}${grades[index]}`).join("·");
}

export function parseShiftSignature(signature: string): PhaseGrades | null {
  const match = /^O([0-5])·F([0-5])·W([0-5])·E([0-5])·S([0-5])·N([0-5])$/.exec(signature);
  if (!match) return null;
  return match.slice(1).map(Number) as unknown as PhaseGrades;
}

/** Deterministic, intentionally legible archetype rules for socially comparable runs. */
export function selectArchetype(metrics: ArchetypeMetrics): Archetype {
  const survival = finiteNonNegative(metrics.survivalSeconds ?? 0, 60);
  const nearMisses = metric(metrics.nearMisses);
  const collisions = metric(metrics.collisions);
  const largestChain = metric(metrics.largestChain);
  const combo = metric(metrics.highestCombo);
  const novas = metric(metrics.novaCount);
  const energy = metric(metrics.energyCollected);

  if (nearMisses >= 8 && collisions <= 1) return "Precision Pilot";
  if (largestChain >= 8 || combo >= 15) return "Chaos Engineer";
  if (novas >= Math.max(8, Math.ceil(survival / 4))) return "Nova Addict";
  if (survival >= 40 && novas <= 4) return "Patient Singularity";
  if (energy >= 28) return "Gravity Gremlin";
  return "Orbit Architect";
}

export function createRunResult(input: RunResultInput): RunResult {
  assertMode(input.mode);
  assertSeed(input.seed);
  const breakdown = finalScoreBreakdown(input.metrics, input.survivalSeconds, input.mode);
  const phaseGrades = phaseGradesFromMetrics(input.metrics);
  const survivalSeconds = breakdown.survivalSeconds;
  const archetype = selectArchetype({
    ...input.metrics,
    survivalSeconds,
  });
  return {
    mode: input.mode,
    seed: input.seed,
    score: breakdown.finalScore,
    survivalSeconds,
    archetype,
    bestCombo: breakdown.highestCombo,
    phaseGrades,
    signature: formatShiftSignature(phaseGrades),
    ...(input.challengeNumber === undefined ? {} : { challengeNumber: wholeNonNegative(input.challengeNumber) }),
    ...(input.attempt === undefined ? {} : { attempt: wholeNonNegative(input.attempt) }),
    ...(input.isPersonalBest === undefined ? {} : { isPersonalBest: input.isPersonalBest }),
    ...(input.personalBest === undefined ? {} : { personalBest: input.personalBest === null ? null : wholeNonNegative(input.personalBest) }),
    ...(input.challengerTarget === undefined ? {} : { challengerTarget: input.challengerTarget === null ? null : wholeNonNegative(input.challengerTarget) }),
  };
}

export function compareScore(score: number, reference: number): ScoreDelta {
  assertScore(score);
  assertScore(reference);
  const delta = score - reference;
  return {
    score,
    reference,
    delta,
    state: delta > 0 ? "ahead" : delta < 0 ? "behind" : "tied",
  };
}

export function resultDeltas(
  score: number,
  challengerTarget?: number | null,
  previousPersonalBest?: number | null,
): ResultDeltas {
  assertScore(score);
  return {
    challenger: challengerTarget === null || challengerTarget === undefined
      ? null
      : compareScore(score, challengerTarget),
    personalBest: previousPersonalBest === null || previousPersonalBest === undefined
      ? null
      : compareScore(score, previousPersonalBest),
  };
}

export function formatScoreDelta(delta: ScoreDelta): string {
  if (delta.state === "tied") return "TIED";
  const sign = delta.delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(delta.delta).toLocaleString("en-US")}`;
}

function resultModeLabel(result: RunResult): string {
  if (result.mode === "endless") return "ENDLESS SHIFT";
  return result.challengeNumber === undefined
    ? "DAILY SHIFT"
    : `DAILY SHIFT #${result.challengeNumber}`;
}

function survivalLabel(seconds: number, mode: GameMode): string {
  const safe = finiteNonNegative(seconds, mode === "daily" ? 60 : MAX_SCORE);
  return mode === "daily" && safe >= 60
    ? "60.0s SURVIVED"
    : `${safe.toFixed(1)}s SURVIVAL`;
}

export function createResultText(result: RunResult): string {
  const lines = [
    `SOL//SHIFT ${wholeNonNegative(result.score).toLocaleString("en-US")}`,
    `${survivalLabel(result.survivalSeconds, result.mode)} · ${result.archetype}`,
    `${result.signature} · ${resultModeLabel(result)}`,
  ];

  const status: string[] = [];
  if (result.isPersonalBest) status.push("NEW PB");
  if (result.attempt !== undefined) status.push(`ATTEMPT ${wholeNonNegative(result.attempt)}`);
  if (result.challengerTarget !== null && result.challengerTarget !== undefined) {
    const challenger = compareScore(wholeNonNegative(result.score), wholeNonNegative(result.challengerTarget));
    status.push(`CHALLENGER ${formatScoreDelta(challenger)}`);
  }
  if (status.length) lines.push(status.join(" · "));
  return lines.join("\n");
}

export function createShareText(result: RunResult, challengeUrl?: string): string {
  const text = `${createResultText(result)}\nCan you survive the same universe?`;
  return challengeUrl ? `${text}\n${challengeUrl}` : text;
}

export function challengeFromResult(result: RunResult): Challenge {
  assertMode(result.mode);
  assertSeed(result.seed);
  const target = wholeNonNegative(result.score);
  assertScore(target);
  if (!isArchetype(result.archetype)) throw new RangeError("unknown archetype");
  return {
    version: CHALLENGE_URL_VERSION,
    mode: result.mode,
    seed: result.seed,
    target,
    archetype: result.archetype,
  };
}
