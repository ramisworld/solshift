import assert from "node:assert/strict";
import test from "node:test";

import {
  CHALLENGE_URL_VERSION,
  MAX_SCORE,
  PHASE_GRADE_TARGETS,
  RULESET_VERSION,
  RunHistory,
  SafeStorageAdapter,
  challengeFromResult,
  compactSeed,
  compareScore,
  createResultText,
  createRunResult,
  createShareText,
  decodeChallengeUrl,
  encodeChallengeUrl,
  finalScoreBreakdown,
  formatScoreDelta,
  formatShiftSignature,
  getDailyShift,
  gradePhaseScore,
  gradePhaseScores,
  parseChallengeUrl,
  parseShiftSignature,
  resultDeltas,
  selectArchetype,
  utcChallengeNumber,
  utcDailySeed,
  utcDateKey,
// @ts-expect-error Tests execute TypeScript source directly.
} from "../app/game/protocol.ts";
import {
  copyResultText,
  downloadResultCard,
  generateResultCardBlob,
  shareResult,
  type ResultCanvas,
// @ts-expect-error Tests execute TypeScript source directly.
} from "../app/game/resultCard.ts";
import type { GameMetrics } from "../app/game/types";

function metrics(overrides: Partial<GameMetrics> = {}): GameMetrics {
  return {
    score: 12_750,
    bankedScore: 10_000,
    unbankedFlux: 2_750,
    energyCollected: 21,
    largestChain: 5,
    combo: 3,
    highestCombo: 9,
    nearMisses: 4,
    novaCount: 7,
    collisions: 2,
    phaseScores: [900, 600, 1_500, 900, 2_200, 1_400],
    phaseCompleted: [true, true, true, true, false, false],
    ...overrides,
  };
}

function resultFixture() {
  return createRunResult({
    mode: "daily",
    seed: 313_133_085,
    survivalSeconds: 54.2,
    metrics: metrics(),
    challengeNumber: 20_644,
    attempt: 3,
    isPersonalBest: true,
    personalBest: 12_750,
    challengerTarget: 12_000,
  });
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  removed: string[] = [];

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.removed.push(key);
    this.values.delete(key);
  }
}

test("UTC Daily Shift is stable throughout a UTC date and versioned by ruleset", () => {
  const opening = new Date("2026-07-10T00:00:00.000Z");
  const closing = new Date("2026-07-10T23:59:59.999Z");
  const tomorrow = new Date("2026-07-11T00:00:00.000Z");

  assert.equal(utcDateKey(opening), "2026-07-10");
  assert.equal(utcDateKey(closing), "2026-07-10");
  assert.equal(utcDailySeed(opening), 313_133_085);
  assert.equal(utcDailySeed(closing), 313_133_085);
  assert.notEqual(utcDailySeed(tomorrow), utcDailySeed(opening));
  assert.notEqual(utcDailySeed(opening, RULESET_VERSION + 1), utcDailySeed(opening));
  assert.equal(utcChallengeNumber(opening), 20_644);
  assert.equal(utcChallengeNumber(tomorrow), 20_645);
  assert.deepEqual(getDailyShift(closing), {
    date: "2026-07-10",
    challengeNumber: 20_644,
    seed: 313_133_085,
    rulesetVersion: RULESET_VERSION,
  });
  assert.equal(compactSeed(0), "0000000");
  assert.equal(compactSeed(0xffff_ffff), "1Z141Z3");
  assert.throws(() => utcDateKey(new Date(Number.NaN)), RangeError);
  assert.throws(() => utcDailySeed(opening, 0), RangeError);
});

test("challenge URLs round-trip canonically with fixed order and optional archetype", () => {
  const challenge = {
    mode: "daily" as const,
    seed: 313_133_085,
    target: 84_250,
    archetype: "Precision Pilot" as const,
  };
  const encoded = encodeChallengeUrl(
    challenge,
    "https://pilot:secret@EXAMPLE.com:443/play?discard=1#fragment",
  );
  assert.equal(
    encoded,
    "https://example.com/play?v=1&mode=daily&seed=313133085&target=84250&archetype=precision-pilot",
  );
  assert.deepEqual(decodeChallengeUrl(encoded), {
    version: CHALLENGE_URL_VERSION,
    ...challenge,
  });

  const reordered = "https://example.com/play?target=84250&seed=313133085&mode=daily&v=1&archetype=precision-pilot";
  const parsed = parseChallengeUrl(reordered);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.canonicalUrl, encoded);
    assert.deepEqual(parsed.challenge, { version: 1, ...challenge });
  }

  const noArchetype = encodeChallengeUrl({ mode: "endless", seed: 0, target: 0 }, "/arena");
  assert.equal(noArchetype, "https://solshift.game/arena?v=1&mode=endless&seed=0&target=0");
  assert.deepEqual(decodeChallengeUrl("?v=1&mode=endless&seed=0&target=0", "https://example.test/arena"), {
    version: 1,
    mode: "endless",
    seed: 0,
    target: 0,
  });
});

test("challenge parser rejects ambiguous, hostile, malformed, and unbounded values", () => {
  const base = "https://solshift.game/?v=1&mode=daily&seed=1&target=2";
  const hostile: Array<[string, string]> = [
    ["javascript:alert(1)?v=1&mode=daily&seed=1&target=2", "invalid-protocol"],
    ["https://solshift.game/?mode=daily&seed=1&target=2", "missing-parameter"],
    [base.replace("v=1", "v=999"), "unsupported-version"],
    [base.replace("daily", "Daily"), "invalid-mode"],
    [base.replace("seed=1", "seed=-1"), "invalid-seed"],
    [base.replace("seed=1", "seed=01"), "invalid-seed"],
    [base.replace("seed=1", "seed=1.5"), "invalid-seed"],
    [base.replace("seed=1", "seed=4294967296"), "invalid-seed"],
    [base.replace("target=2", "target=+2"), "invalid-target"],
    [base.replace("target=2", "target=%202"), "invalid-target"],
    [base.replace("target=2", `target=${MAX_SCORE}0`), "invalid-target"],
    [`${base}&seed=2`, "duplicate-parameter"],
    [`${base}&utm_source=trap`, "unknown-parameter"],
    [`${base}&archetype=<script>`, "invalid-archetype"],
    [`${base}&archetype=precision%00pilot`, "invalid-archetype"],
    [`https://solshift.game/${"x".repeat(2_100)}?v=1&mode=daily&seed=1&target=2`, "invalid-url"],
  ];

  for (const [url, expectedCode] of hostile) {
    const parsed = parseChallengeUrl(url);
    assert.equal(parsed.ok, false, url);
    if (!parsed.ok) assert.equal(parsed.code, expectedCode, url);
    assert.equal(decodeChallengeUrl(url), null, url);
  }

  assert.throws(
    () => encodeChallengeUrl({ mode: "daily", seed: -1, target: 1 } as never),
    RangeError,
  );
  assert.throws(
    () => encodeChallengeUrl({ mode: "void", seed: 1, target: 1 } as never),
    RangeError,
  );
  assert.throws(
    () => encodeChallengeUrl({ mode: "daily", seed: 1, target: 1 }, "data:text/plain,no"),
    TypeError,
  );
  assert.throws(
    () => encodeChallengeUrl(
      { mode: "daily", seed: 1, target: 1 },
      `https://solshift.game/${"x".repeat(2_100)}`,
    ),
    RangeError,
  );
});

test("safe storage works without localStorage and preserves writes after quota failure", () => {
  const disabled = new SafeStorageAdapter(null, "test-disabled");
  assert.equal(disabled.write("value", { alive: true }), false);
  assert.deepEqual(disabled.read("value"), { alive: true });

  const quota = {
    getItem: () => null,
    setItem: () => {
      throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    },
    removeItem: () => {
      throw new Error("disabled");
    },
  };
  const fallback = new SafeStorageAdapter(quota, "test-quota");
  assert.equal(fallback.write("pb", { score: 9001 }), false);
  assert.deepEqual(fallback.read("pb"), { score: 9001 });

  const denied = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("SecurityError"); },
  };
  const guarded = new SafeStorageAdapter(denied, "test-denied");
  assert.doesNotThrow(() => guarded.write("x", [1, 2, 3]));
  assert.deepEqual(guarded.read("x"), [1, 2, 3]);
  assert.equal(guarded.write("circular", (() => {
    const value: { self?: unknown } = {};
    value.self = value;
    return value;
  })()), false);
});

test("a quota-failed write shadows an older persistent value for the current session", () => {
  const stale = new MemoryStorage();
  stale.values.set("quota-shadow:pb", JSON.stringify({ score: 100 }));
  stale.setItem = () => {
    throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  };

  const adapter = new SafeStorageAdapter(stale, "quota-shadow");
  assert.deepEqual(adapter.read("pb"), { score: 100 });
  assert.equal(adapter.write("pb", { score: 250 }), false);
  assert.deepEqual(adapter.read("pb"), { score: 250 });
  assert.equal(stale.values.get("quota-shadow:pb"), JSON.stringify({ score: 100 }));
});

test("corrupt or schema-invalid storage records are discarded without escaping", () => {
  const raw = new MemoryStorage();
  raw.values.set("corrupt:json", "{definitely-not-json");
  const adapter = new SafeStorageAdapter(raw, "corrupt");
  assert.equal(adapter.read("json"), null);
  assert.deepEqual(raw.removed, ["corrupt:json"]);

  raw.values.set("history:runs:daily:99", JSON.stringify({
    attempts: -4,
    personalBest: "huge",
    lastScore: 1,
  }));
  const history = new RunHistory(new SafeStorageAdapter(raw, "history"));
  assert.deepEqual(history.get("daily", 99), {
    attempts: 0,
    personalBest: null,
    lastScore: null,
  });
  assert.ok(raw.removed.includes("history:runs:daily:99"));
});

test("attempts and PBs are isolated by mode and seed, with ties not reported as new", () => {
  const history = new RunHistory(new SafeStorageAdapter(new MemoryStorage(), "runs"));
  const first = history.record("daily", 7, 1_000);
  assert.deepEqual(first, {
    attempts: 1,
    attempt: 1,
    score: 1_000,
    personalBest: 1_000,
    lastScore: 1_000,
    previousPersonalBest: null,
    isPersonalBest: true,
    personalBestDelta: null,
    persisted: true,
  });

  const lower = history.record("daily", 7, 900);
  assert.equal(lower.attempt, 2);
  assert.equal(lower.personalBest, 1_000);
  assert.equal(lower.isPersonalBest, false);
  assert.equal(lower.personalBestDelta, -100);

  const tie = history.record("daily", 7, 1_000);
  assert.equal(tie.attempt, 3);
  assert.equal(tie.isPersonalBest, false);
  assert.equal(tie.personalBestDelta, 0);

  const better = history.record("daily", 7, 1_400);
  assert.equal(better.attempt, 4);
  assert.equal(better.personalBest, 1_400);
  assert.equal(better.isPersonalBest, true);
  assert.equal(better.personalBestDelta, 400);

  assert.equal(history.get("daily", 8).attempts, 0);
  assert.equal(history.get("endless", 7).attempts, 0);
  history.clear("daily", 7);
  assert.deepEqual(history.get("daily", 7), {
    attempts: 0,
    personalBest: null,
    lastScore: null,
  });
  assert.throws(() => history.record("daily", 7, Number.NaN), RangeError);
});

test("final score breakdown reconciles exact displayed points and normalizes metrics", () => {
  const breakdown = finalScoreBreakdown(metrics(), 42.25);
  assert.deepEqual(breakdown, {
    finalScore: 12_750,
    bankedPoints: 10_000,
    liveFluxPoints: 2_750,
    survivalSeconds: 42.25,
    survivalRatio: 42.25 / 60,
    energyCollected: 21,
    largestChain: 5,
    highestCombo: 9,
    nearMisses: 4,
    novas: 7,
    collisions: 2,
    phasesCompleted: 4,
    phaseScores: [900, 600, 1_500, 900, 2_200, 1_400],
  });

  const fallback = finalScoreBreakdown(metrics({
    score: Number.NaN,
    bankedScore: 1_000.9,
    unbankedFlux: 250.8,
  }), 100);
  assert.equal(fallback.finalScore, 1_251);
  assert.equal(fallback.bankedPoints + fallback.liveFluxPoints, fallback.finalScore);
  assert.equal(fallback.survivalSeconds, 60);
  assert.equal(fallback.survivalRatio, 1);
});

test("phase grades are bounded 0–5 and Shift Signatures are strict and text-safe", () => {
  assert.equal(gradePhaseScore(-1, 100), 0);
  assert.equal(gradePhaseScore(1, 100), 1);
  assert.equal(gradePhaseScore(20, 100), 2);
  assert.equal(gradePhaseScore(40, 100), 3);
  assert.equal(gradePhaseScore(65, 100), 4);
  assert.equal(gradePhaseScore(100, 100), 5);
  assert.equal(gradePhaseScore(Number.POSITIVE_INFINITY, 100), 0);

  const grades = gradePhaseScores([
    0,
    1,
    PHASE_GRADE_TARGETS[2] * 0.2,
    PHASE_GRADE_TARGETS[3] * 0.4,
    PHASE_GRADE_TARGETS[4] * 0.65,
    PHASE_GRADE_TARGETS[5],
  ]);
  assert.deepEqual(grades, [0, 1, 2, 3, 4, 5]);
  const signature = formatShiftSignature(grades);
  assert.equal(signature, "O0·F1·W2·E3·S4·N5");
  assert.deepEqual(parseShiftSignature(signature), grades);
  assert.equal(parseShiftSignature("O0.F1.W2.E3.S4.N5"), null);
  assert.equal(parseShiftSignature("O0·F1·W2·E3·S4·N6"), null);
  assert.equal(parseShiftSignature("O0·F1·E3·W2·S4·N5"), null);
  assert.throws(() => formatShiftSignature([0, 1, 2] as never), RangeError);
});

test("archetypes use deterministic, playful run traits with stable precedence", () => {
  const base = {
    energyCollected: 0,
    largestChain: 0,
    highestCombo: 0,
    nearMisses: 0,
    novaCount: 0,
    collisions: 0,
    survivalSeconds: 20,
  };
  assert.equal(selectArchetype(base), "Orbit Architect");
  assert.equal(selectArchetype({ ...base, energyCollected: 28 }), "Gravity Gremlin");
  assert.equal(selectArchetype({ ...base, survivalSeconds: 40, novaCount: 4 }), "Patient Singularity");
  assert.equal(selectArchetype({ ...base, novaCount: 8 }), "Nova Addict");
  assert.equal(selectArchetype({ ...base, largestChain: 8 }), "Chaos Engineer");
  assert.equal(selectArchetype({ ...base, highestCombo: 15 }), "Chaos Engineer");
  assert.equal(selectArchetype({ ...base, nearMisses: 8, collisions: 1 }), "Precision Pilot");
  assert.equal(selectArchetype({
    ...base,
    nearMisses: 10,
    collisions: 0,
    largestChain: 20,
    novaCount: 30,
  }), "Precision Pilot");
});

test("run summaries, result/share text, and challenge payloads stay mutually consistent", () => {
  const result = createRunResult({
    mode: "daily",
    seed: 313_133_085,
    survivalSeconds: 60,
    metrics: metrics({ nearMisses: 9, collisions: 1 }),
    challengeNumber: 20_644,
    attempt: 3,
    isPersonalBest: true,
    personalBest: 12_750,
    challengerTarget: 12_000,
  });
  assert.equal(result.score, 12_750);
  assert.equal(result.archetype, "Precision Pilot");
  assert.equal(result.signature, formatShiftSignature(result.phaseGrades));
  assert.deepEqual(challengeFromResult(result), {
    version: 1,
    mode: "daily",
    seed: 313_133_085,
    target: 12_750,
    archetype: "Precision Pilot",
  });

  const resultText = createResultText(result);
  assert.equal(resultText, [
    "SOL//SHIFT 12,750",
    "60.0s SURVIVED · Precision Pilot",
    `${result.signature} · DAILY SHIFT #20644`,
    "NEW PB · ATTEMPT 3 · CHALLENGER +750",
  ].join("\n"));

  const url = encodeChallengeUrl(challengeFromResult(result), "https://example.com/play");
  const shared = createShareText(result, url);
  assert.ok(shared.includes("Can you survive the same universe?"));
  assert.ok(shared.endsWith(url));
  assert.ok(shared.length < 280);
});

test("Endless survival stays uncapped while Daily completion remains a 60-second result", () => {
  const endless = createRunResult({
    mode: "endless",
    seed: 42,
    survivalSeconds: 125.7,
    metrics: metrics(),
  });
  assert.equal(endless.survivalSeconds, 125.7);
  assert.ok(createResultText(endless).includes("125.7s SURVIVAL"));
  assert.ok(createShareText(endless).includes("125.7s SURVIVAL"));

  const daily = createRunResult({
    mode: "daily",
    seed: 42,
    survivalSeconds: 125.7,
    metrics: metrics(),
  });
  assert.equal(daily.survivalSeconds, 60);
  assert.ok(createResultText(daily).includes("60.0s SURVIVED"));
  assert.ok(!createResultText(daily).includes("125.7"));
});

test("challenger and previous-PB deltas distinguish ahead, tied, behind, and absent", () => {
  assert.deepEqual(compareScore(1_200, 1_000), {
    score: 1_200,
    reference: 1_000,
    delta: 200,
    state: "ahead",
  });
  assert.equal(formatScoreDelta(compareScore(1_200, 1_000)), "+200");
  assert.equal(formatScoreDelta(compareScore(1_000, 1_000)), "TIED");
  assert.equal(formatScoreDelta(compareScore(750, 1_000)), "−250");
  assert.deepEqual(resultDeltas(1_200, 1_000, 1_500), {
    challenger: { score: 1_200, reference: 1_000, delta: 200, state: "ahead" },
    personalBest: { score: 1_200, reference: 1_500, delta: -300, state: "behind" },
  });
  assert.deepEqual(resultDeltas(1_200, null, undefined), {
    challenger: null,
    personalBest: null,
  });
});

test("result card renders through an injected Canvas at the exact social-card size", async () => {
  const gradients = { addColorStop() {} };
  const target: Record<PropertyKey, unknown> = {
    createLinearGradient: () => gradients,
    createRadialGradient: () => gradients,
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  const context = new Proxy(target, {
    get(object, key) {
      return Reflect.get(object, key) ?? (() => undefined);
    },
  });
  let dimensions: [number, number] | null = null;
  const canvasFactory = (width: number, height: number): ResultCanvas => {
    dimensions = [width, height];
    return {
      width,
      height,
      getContext: () => context as unknown as CanvasRenderingContext2D,
      toBlob: (callback, type) => callback(new Blob(["procedural-card"], { type })),
    };
  };

  const blob = await generateResultCardBlob(resultFixture(), { canvasFactory });
  assert.deepEqual(dimensions, [1_200, 630]);
  assert.equal(blob.type, "image/png");
  assert.equal(await blob.text(), "procedural-card");
});

test("result card renders an Endless survival time beyond 60 seconds", async () => {
  const renderedText: string[] = [];
  const gradients = { addColorStop() {} };
  const target: Record<PropertyKey, unknown> = {
    createLinearGradient: () => gradients,
    createRadialGradient: () => gradients,
    measureText: (text: string) => ({ width: text.length * 8 }),
    fillText: (text: string) => { renderedText.push(text); },
  };
  const context = new Proxy(target, {
    get(object, key) {
      return Reflect.get(object, key) ?? (() => undefined);
    },
  });
  const result = createRunResult({
    mode: "endless",
    seed: 99,
    survivalSeconds: 125.7,
    metrics: metrics(),
  });

  await generateResultCardBlob(result, {
    canvasFactory: (width, height) => ({
      width,
      height,
      getContext: () => context as unknown as CanvasRenderingContext2D,
      toBlob: (callback, type) => callback(new Blob(["card"], { type })),
    }),
  });

  assert.ok(renderedText.some((text) => text.includes("125.7s SURVIVAL")));
});

test("copy fallback removes its textarea even when execCommand throws", async () => {
  let removed = 0;
  const textarea = {
    value: "",
    readOnly: false,
    style: {},
    setAttribute() {},
    select() {},
    remove() { removed += 1; },
  };
  const documentMock = {
    body: { appendChild() {} },
    createElement: () => textarea,
    execCommand: () => { throw new Error("copy blocked"); },
  };

  const copied = await copyResultText("SOL//SHIFT", {
    navigator: null,
    document: documentMock as unknown as Document,
  });
  assert.equal(copied, false);
  assert.equal(removed, 1);
});

test("download fallback removes its anchor and revokes its URL when click throws", () => {
  let removed = 0;
  const revoked: string[] = [];
  const anchor = {
    href: "",
    download: "",
    rel: "",
    style: {},
    click() { throw new Error("download blocked"); },
    remove() { removed += 1; },
  };
  const documentMock = {
    body: { appendChild() {} },
    createElement: () => anchor,
  };

  const downloaded = downloadResultCard(new Blob(["card"], { type: "image/png" }), undefined, {
    document: documentMock as unknown as Document,
    urlFactory: {
      createObjectURL: () => "blob:sol-shift-result",
      revokeObjectURL: (url) => { revoked.push(url); },
    },
  });
  assert.equal(downloaded, false);
  assert.equal(removed, 1);
  assert.deepEqual(revoked, ["blob:sol-shift-result"]);
});

test("share progression uses file share only after canShare and copies the complete URL on failure", async () => {
  const result = resultFixture();
  const challengeUrl = "https://example.com/play?v=1&mode=daily&seed=313133085&target=12750";
  const image = new Blob(["png"], { type: "image/png" });
  let nativePayload: ShareData | null = null;
  let copied = "";
  const outcome = await shareResult({
    result,
    challengeUrl,
    image,
    environment: {
      navigator: {
        canShare: () => false,
        share: async (payload) => {
          nativePayload = payload;
          throw new Error("native target unavailable");
        },
        clipboard: {
          writeText: async (text) => { copied = text; },
        },
      },
      document: null,
      FileConstructor: null,
    },
  });

  assert.equal(outcome, "copied");
  const attemptedShare = nativePayload as ShareData | null;
  assert.equal(attemptedShare?.url, challengeUrl);
  assert.ok(!attemptedShare?.text?.includes(challengeUrl));
  assert.ok(copied.endsWith(challengeUrl));
  assert.equal(copied.split(challengeUrl).length - 1, 1);
});

test("share progression attaches the card only when Web Share confirms file support", async () => {
  class MockFile extends Blob {
    readonly name: string;
    readonly lastModified = 0;

    constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
      super(bits, options);
      this.name = name;
    }
  }

  let shared: ShareData | null = null;
  const outcome = await shareResult({
    result: resultFixture(),
    image: new Blob(["image"], { type: "image/png" }),
    environment: {
      FileConstructor: MockFile as unknown as typeof File,
      navigator: {
        canShare: (payload) => payload.files?.length === 1,
        share: async (payload) => { shared = payload; },
      },
    },
  });

  assert.equal(outcome, "shared-image");
  const sharedPayload = shared as ShareData | null;
  assert.equal(sharedPayload?.files?.length, 1);
  assert.equal(sharedPayload?.files?.[0]?.name, "sol-shift-result.png");
});
