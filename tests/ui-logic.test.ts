import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_RUN_RELEASE_CHARGE,
  FIRST_RUN_RELEASE_FALLBACK_SECONDS,
  PHASE_INSTRUCTIONS,
  formatElapsed,
  getFirstRunOnboardingStage,
  getPhaseInstruction,
  getResultRetryTip,
  resultStatus,
// @ts-expect-error Node runs this test from source with native type stripping.
} from "../app/game/uiLogic.ts";
import type { PhaseGrade, RunResult } from "../app/game/protocol.ts";

const BASE_RESULT: RunResult = {
  mode: "daily",
  seed: 1,
  score: 1_000,
  survivalSeconds: 42,
  archetype: "Orbit Architect",
  bestCombo: 4,
  phaseGrades: [1, 2, 3, 2, 1, 0],
  signature: "O1·F2·W3·E2·S1·N0",
  isPersonalBest: true,
  challengerTarget: 1_000,
};

test("Endless HUD time remains meaningful beyond the first minute", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(61.9), "01:01");
  assert.equal(formatElapsed(3_661), "61:01");
  assert.equal(formatElapsed(Number.NaN), "00:00");
});

test("challenge result status never hides the target outcome behind a PB", () => {
  assert.equal(
    resultStatus(BASE_RESULT, null),
    "CHALLENGE TIED · EXACT SIGNAL · NEW PERSONAL BEST",
  );
  assert.equal(
    resultStatus({ ...BASE_RESULT, score: 1_240 }, null),
    "CHALLENGE BEATEN · +240 · NEW PERSONAL BEST",
  );
  assert.equal(
    resultStatus({ ...BASE_RESULT, score: 780, isPersonalBest: false }, null),
    "CHALLENGER AHEAD · 220",
  );
});

test("first-run onboarding advances from pull through a completed Nova", () => {
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 0,
    inputActive: false,
    capturedCount: 0,
    charge: 0,
    novaCount: 0,
  }), "pull");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 0.5,
    inputActive: true,
    capturedCount: 0,
    charge: 0.1,
    novaCount: 0,
  }), "pull");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 0.75,
    inputActive: true,
    capturedCount: 1,
    charge: FIRST_RUN_RELEASE_CHARGE - 0.01,
    novaCount: 0,
  }), "captured");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 1,
    inputActive: true,
    capturedCount: 1,
    charge: FIRST_RUN_RELEASE_CHARGE,
    novaCount: 0,
    previousStage: "captured",
  }), "release");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 1.1,
    inputActive: false,
    capturedCount: 0,
    charge: 0,
    novaCount: 1,
    previousStage: "release",
  }), "complete");
});

test("first-run onboarding has deterministic fallbacks and never regresses", () => {
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: FIRST_RUN_RELEASE_FALLBACK_SECONDS,
    inputActive: true,
    capturedCount: 1,
    charge: 0,
    novaCount: 0,
  }), "release");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 1,
    inputActive: false,
    capturedCount: 1,
    charge: 0,
    novaCount: 0,
  }), "release");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 1,
    inputActive: true,
    capturedCount: 0,
    charge: 0.1,
    novaCount: 0,
    previousStage: "captured",
  }), "captured");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: 0,
    inputActive: false,
    capturedCount: 0,
    charge: 0,
    novaCount: 0,
    previousStage: "release",
  }), "release");
  assert.equal(getFirstRunOnboardingStage({
    elapsedSeconds: Number.NaN,
    inputActive: true,
    capturedCount: Number.NaN,
    charge: Number.POSITIVE_INFINITY,
    novaCount: Number.NaN,
  }), "pull");
});

test("all six phase instructions are actionable and imperfect indexes are clamped", () => {
  assert.deepEqual(PHASE_INSTRUCTIONS, [
    "PULL MATTER · RELEASE TO SLING",
    "NOVA CRACKS CRYSTALS · CHAIN SHARDS",
    "RELEASE DOWNSTREAM · CUT A CORRIDOR",
    "YOUR OLD PATH RETURNS · KEEP CLEAR",
    "NOVA THE LEAD EDGE · SPLIT THE FLOCK",
    "ALL LAWS COLLAPSE · KEEP MOVING",
  ]);
  PHASE_INSTRUCTIONS.forEach((instruction, index) => {
    assert.equal(getPhaseInstruction(index), instruction);
  });
  assert.equal(getPhaseInstruction(-20), PHASE_INSTRUCTIONS[0]);
  assert.equal(getPhaseInstruction(99), PHASE_INSTRUCTIONS[5]);
  assert.equal(getPhaseInstruction(Number.NaN), PHASE_INSTRUCTIONS[0]);
});

test("retry tips prioritize first interaction and Core-collapse coaching", () => {
  assert.equal(
    getResultRetryTip(null, "core destabilized"),
    "HOLD TO PULL MATTER · RELEASE TO NOVA",
  );
  assert.equal(
    getResultRetryTip({ ...BASE_RESULT, score: 0 }, "core destabilized"),
    "HOLD NEAR BLUE MATTER · RELEASE AFTER IT ORBITS",
  );
  assert.equal(
    getResultRetryTip(BASE_RESULT, "core destabilized"),
    "ORBIT · HOLD NEAR BLUE MATTER, THEN RELEASE · PROTECT CORE",
  );
});

test("retry tips select the weakest reached law and ignore future zero grades", () => {
  const phaseTips = [
    "ORBIT · HOLD NEAR BLUE MATTER, THEN RELEASE",
    "FRACTURE · NOVA THROUGH CRYSTAL CLUSTERS",
    "FLOW · RELEASE DOWNSTREAM TO CUT A CORRIDOR",
    "ECHO · KEEP CLEAR OF YOUR RETURNING PATH",
    "SWARM · NOVA THE LEAD EDGE OF THE FLOCK",
    "NOVA · KEEP MOVING AND RELEASE WITH CAPTURED MASS",
  ];
  for (let weakest = 0; weakest < 6; weakest += 1) {
    const grades: [PhaseGrade, PhaseGrade, PhaseGrade, PhaseGrade, PhaseGrade, PhaseGrade] = [
      5, 5, 5, 5, 5, 5,
    ];
    grades[weakest] = 1;
    assert.equal(
      getResultRetryTip({
        ...BASE_RESULT,
        survivalSeconds: 60,
        phaseGrades: grades,
      }, "core destabilized"),
      `${phaseTips[weakest]} · PROTECT CORE`,
    );
  }

  assert.equal(getResultRetryTip({
    ...BASE_RESULT,
    survivalSeconds: 15,
    phaseGrades: [4, 3, 0, 0, 0, 0],
  }, null), "FRACTURE · NOVA THROUGH CRYSTAL CLUSTERS");
});

test("strong reached grades coach combo growth before praising the signature", () => {
  assert.equal(getResultRetryTip({
    ...BASE_RESULT,
    survivalSeconds: 60,
    phaseGrades: [4, 4, 4, 4, 4, 4],
    bestCombo: 5,
  }, null), "CAPTURE MORE MASS · RELEASE INTO CLUSTERS FOR CHAINS");
  assert.equal(getResultRetryTip({
    ...BASE_RESULT,
    survivalSeconds: 60,
    phaseGrades: [5, 5, 5, 5, 5, 5],
    bestCombo: 12,
  }, null), "STRONG SIGNATURE · CHASE A LONGER COMBO");
});
