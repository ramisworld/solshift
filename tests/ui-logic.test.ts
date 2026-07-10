import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node runs this test from source with native type stripping.
import { formatElapsed, resultStatus } from "../app/game/uiLogic.ts";
import type { RunResult } from "../app/game/protocol.ts";

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
