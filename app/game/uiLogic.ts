import type { RunResult } from "./protocol";

export type FirstRunOnboardingStage =
  | "pull"
  | "captured"
  | "release"
  | "complete";

export interface FirstRunOnboardingSnapshot {
  /** Active seconds since the first captured mass, excluding pauses. */
  elapsedSeconds: number;
  inputActive: boolean;
  capturedCount: number;
  /** Normalized Core charge, normally from 0 to 1. */
  charge: number;
  novaCount: number;
  /** Supplying this makes progress monotonic across transient world states. */
  previousStage?: FirstRunOnboardingStage;
}

export const FIRST_RUN_RELEASE_CHARGE = 0.35;
export const FIRST_RUN_RELEASE_FALLBACK_SECONDS = 4;

const ONBOARDING_STAGE_ORDER: readonly FirstRunOnboardingStage[] = [
  "pull",
  "captured",
  "release",
  "complete",
];

export const PHASE_INSTRUCTIONS = [
  "PULL MATTER · RELEASE TO SLING",
  "NOVA CRACKS CRYSTALS · CHAIN SHARDS",
  "RELEASE DOWNSTREAM · CUT A CORRIDOR",
  "YOUR OLD PATH RETURNS · KEEP CLEAR",
  "NOVA THE LEAD EDGE · SPLIT THE FLOCK",
  "ALL LAWS COLLAPSE · KEEP MOVING",
] as const;

export type PhaseInstruction = (typeof PHASE_INSTRUCTIONS)[number];

const PHASE_RETRY_TIPS = [
  "ORBIT · HOLD NEAR BLUE MATTER, THEN RELEASE",
  "FRACTURE · NOVA THROUGH CRYSTAL CLUSTERS",
  "FLOW · RELEASE DOWNSTREAM TO CUT A CORRIDOR",
  "ECHO · KEEP CLEAR OF YOUR RETURNING PATH",
  "SWARM · NOVA THE LEAD EDGE OF THE FLOCK",
  "NOVA · KEEP MOVING AND RELEASE WITH CAPTURED MASS",
] as const;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function stageRank(stage: FirstRunOnboardingStage): number {
  return ONBOARDING_STAGE_ORDER.indexOf(stage);
}

/**
 * Advances the first-run capture loop without depending on render cadence.
 * A remembered previous stage prevents a short-lived capture from making the
 * prompt regress while the player is still learning the gesture.
 */
export function getFirstRunOnboardingStage(
  snapshot: FirstRunOnboardingSnapshot,
): FirstRunOnboardingStage {
  const previous = snapshot.previousStage ?? "pull";
  if (previous === "complete" || finiteNonNegative(snapshot.novaCount) >= 1) {
    return "complete";
  }

  const previousRank = stageRank(previous);
  const hasCaptured = finiteNonNegative(snapshot.capturedCount) >= 1
    || previousRank >= stageRank("captured");
  if (!hasCaptured) return "pull";
  if (previousRank >= stageRank("release")) return "release";

  const elapsed = finiteNonNegative(snapshot.elapsedSeconds);
  const charge = Math.min(1, finiteNonNegative(snapshot.charge));
  if (
    !snapshot.inputActive
    || charge >= FIRST_RUN_RELEASE_CHARGE
    || elapsed >= FIRST_RUN_RELEASE_FALLBACK_SECONDS
  ) {
    return "release";
  }
  return "captured";
}

/** Returns the action copy for a law, safely clamping imperfect UI input. */
export function getPhaseInstruction(phaseIndex: number): PhaseInstruction {
  const finiteIndex = Number.isFinite(phaseIndex) ? Math.floor(phaseIndex) : 0;
  const safeIndex = Math.max(0, Math.min(PHASE_INSTRUCTIONS.length - 1, finiteIndex));
  return PHASE_INSTRUCTIONS[safeIndex];
}

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function resultStatus(result: RunResult | null, fallback: string | null): string {
  if (!result) return fallback ?? "The field recorded your Shift Signature.";
  const messages: string[] = [];
  if (result.challengerTarget !== null && result.challengerTarget !== undefined) {
    const delta = result.score - result.challengerTarget;
    messages.push(delta > 0
      ? `CHALLENGE BEATEN · +${delta.toLocaleString("en-US")}`
      : delta === 0
        ? "CHALLENGE TIED · EXACT SIGNAL"
        : `CHALLENGER AHEAD · ${Math.abs(delta).toLocaleString("en-US")}`);
  }
  if (result.isPersonalBest) messages.push("NEW PERSONAL BEST");
  return messages.length
    ? messages.join(" · ")
    : fallback ?? "The field recorded your Shift Signature.";
}

/**
 * Produces one short, actionable coaching line. Future, unplayed law grades are
 * deliberately ignored so an early failure never recommends a phase the
 * player has not encountered yet.
 */
export function getResultRetryTip(
  result: RunResult | null,
  deathReason: string | null,
): string {
  if (!result) return "HOLD TO PULL MATTER · RELEASE TO NOVA";
  if (result.score <= 0) {
    return "HOLD NEAR BLUE MATTER · RELEASE AFTER IT ORBITS";
  }

  const survival = finiteNonNegative(result.survivalSeconds);
  const lastReachedPhase = Math.max(0, Math.min(
    PHASE_RETRY_TIPS.length - 1,
    Math.floor(survival / 10),
  ));
  let weakestPhase = 0;
  let weakestGrade = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= lastReachedPhase; index += 1) {
    const rawGrade = result.phaseGrades[index];
    const grade = Number.isFinite(rawGrade) ? Math.max(0, Math.min(5, rawGrade)) : 0;
    if (grade < weakestGrade) {
      weakestGrade = grade;
      weakestPhase = index;
    }
  }

  const coreCollapsed = Boolean(
    deathReason && /core|destabili|collaps|collision|impact|\bhit\b/iu.test(deathReason),
  );
  if (weakestGrade < 4) {
    const phaseTip = PHASE_RETRY_TIPS[weakestPhase];
    return coreCollapsed ? `${phaseTip} · PROTECT CORE` : phaseTip;
  }
  if (coreCollapsed) return "KEEP MOVING · RED THREATS COST CORE STABILITY";
  if (finiteNonNegative(result.bestCombo) < 6) {
    return "CAPTURE MORE MASS · RELEASE INTO CLUSTERS FOR CHAINS";
  }
  return "STRONG SIGNATURE · CHASE A LONGER COMBO";
}
