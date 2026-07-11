import assert from "node:assert/strict";
import test from "node:test";

import {
  CHARGED_NOVA_THRESHOLD,
  getNovaFeedbackTier,
// @ts-expect-error Node runs this test from source with native type stripping.
} from "../app/game/gameFeel.ts";

test("Nova feedback tiers distinguish empty charge from captured mass", () => {
  assert.equal(getNovaFeedbackTier(0.08, 0), "empty");
  assert.equal(getNovaFeedbackTier(CHARGED_NOVA_THRESHOLD - 0.001, 0), "empty");
  assert.equal(getNovaFeedbackTier(CHARGED_NOVA_THRESHOLD, 0), "charged");
  assert.equal(getNovaFeedbackTier(0.08, 1), "loaded");
  assert.equal(getNovaFeedbackTier(1.2, 6), "loaded");
  assert.equal(getNovaFeedbackTier(Number.NaN, Number.NaN), "empty");
});
