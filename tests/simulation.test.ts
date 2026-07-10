import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node runs this test from source with native type stripping.
import { GameSimulation } from "../app/game/simulation.ts";
// @ts-expect-error Node runs this test from source with native type stripping.
import { creatorAutopilotInput } from "../app/game/autopilot.ts";
// @ts-expect-error Node runs this test from source with native type stripping.
import { FIXED_STEP, PHASE_TICKS, RUN_TICKS, type GameEvent, type InputState } from "../app/game/types.ts";

function input(overrides: Partial<InputState> = {}): InputState {
  return {
    target: { x: 480, y: 270 },
    keyboard: { x: 0, y: 0 },
    active: false,
    justPressed: false,
    justReleased: false,
    pointerType: "demo",
    ...overrides,
  };
}

function makeSimulation(seed = 0x51f7a11) {
  const simulation = new GameSimulation({
    width: 960,
    height: 540,
    mode: "daily",
    seed,
  });
  simulation.start("daily", seed);
  return simulation;
}

function advance(
  simulation: GameSimulation,
  ticks: number,
  inputForTick: (tick: number) => InputState = () => input(),
) {
  const events: GameEvent[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    events.push(...simulation.update(FIXED_STEP, inputForTick(tick)));
  }
  return events;
}

function skilledInput(tick: number): InputState {
  const chargeTick = tick % 120;
  return input({
    target: {
      x: 480 + Math.cos(tick * 0.014) * 285,
      y: 270 + Math.sin(tick * 0.014) * 175,
    },
    active: chargeTick < 110,
    justPressed: chargeTick === 0,
    justReleased: chargeTick === 110,
  });
}

function countsByKind(snapshot: ReturnType<GameSimulation["getSnapshot"]>) {
  const counts = new Map<string, number>();
  for (const entity of snapshot.entities) {
    counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
  }
  return counts;
}

function distanceToPolyline(
  x: number,
  y: number,
  points: ReadonlyArray<{ x: number; y: number }>,
) {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    const projection = lengthSquared <= 1e-9
      ? 0
      : Math.max(0, Math.min(1, (
        (x - start.x) * segmentX + (y - start.y) * segmentY
      ) / lengthSquared));
    closest = Math.min(
      closest,
      Math.hypot(
        x - (start.x + segmentX * projection),
        y - (start.y + segmentY * projection),
      ),
    );
  }
  return closest;
}

test("same seed and input stream reproduce the complete simulation state", () => {
  const first = makeSimulation(0x1234abcd);
  const second = makeSimulation(0x1234abcd);
  const otherSeed = makeSimulation(0x1234abce);

  const controls = (tick: number): InputState => {
    const angle = tick * 0.027;
    const active = tick >= 24 && tick < 92;
    return input({
      target: {
        x: 480 + Math.cos(angle) * 145,
        y: 270 + Math.sin(angle * 0.8) * 105,
      },
      active,
      justPressed: tick === 24,
      justReleased: tick === 92,
    });
  };

  advance(first, 420, controls);
  advance(second, 420, controls);
  advance(otherSeed, 420, controls);

  assert.deepEqual(first.getSnapshot(), second.getSnapshot());
  assert.notDeepEqual(
    first.getSnapshot().entities.map(({ id, seed, x, y }) => ({ id, seed, x, y })),
    otherSeed.getSnapshot().entities.map(({ id, seed, x, y }) => ({ id, seed, x, y })),
  );
});

test("render snapshots reuse live world storage while diagnostic snapshots stay detached", () => {
  const simulation = makeSimulation(0xabc123);
  advance(simulation, 12, skilledInput);

  const firstRender = simulation.getRenderSnapshot();
  const secondRender = simulation.getRenderSnapshot();
  const diagnostic = simulation.getSnapshot();

  assert.equal(firstRender.entities, secondRender.entities);
  assert.equal(firstRender.trail, secondRender.trail);
  assert.equal(firstRender.metrics, secondRender.metrics);
  assert.notEqual(diagnostic.entities, firstRender.entities);
  assert.notEqual(diagnostic.trail, firstRender.trail);
  assert.notEqual(diagnostic.metrics, firstRender.metrics);
  assert.notEqual(diagnostic.core, firstRender.core);
});

test("Creator autopilot survives an authentic Daily run across recording viewports", () => {
  const showcaseSeed = 0x50_1a_7e_56;
  const viewports = [
    [1_920, 1_080],
    [1_600, 900],
    [390, 844],
    [320, 568],
  ] as const;

  for (const [width, height] of viewports) {
    const simulation = new GameSimulation({
      width,
      height,
      mode: "daily",
      seed: showcaseSeed,
    });
    simulation.start("daily", showcaseSeed);
    let previous = input({
      target: { x: width * 0.5, y: height * 0.5 },
      pointerType: "demo",
    });
    while (simulation.getStatus() === "playing") {
      const next = creatorAutopilotInput(simulation.getRenderSnapshot(), previous);
      simulation.update(FIXED_STEP, next);
      previous = { ...next, justPressed: false, justReleased: false };
    }
    const result = simulation.getSnapshot();
    assert.equal(result.tick, RUN_TICKS, `${width}×${height} ended early`);
    assert.equal(result.runComplete, true, `${width}×${height} did not complete`);
  }
});

test("Creator transition cue enters the next law through the normal phase boundary", () => {
  const simulation = makeSimulation(0x50_1a_7e_56);
  simulation.forcePhase(1, PHASE_TICKS - 2);
  assert.equal(simulation.getSnapshot().phase, "FRACTURE");
  assert.equal(simulation.getSnapshot().phaseTime, (PHASE_TICKS - 2) * FIXED_STEP);

  const events = advance(simulation, 2, skilledInput);
  const transitioned = simulation.getSnapshot();
  assert.equal(transitioned.phase, "FLOW");
  assert.equal(transitioned.phaseTime, 0);
  assert.equal(transitioned.phaseTransition, 0);
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "FLOW"));
});

test("phase boundaries are exactly 600 ticks and a Daily Shift is exactly 3600 ticks", () => {
  const simulation = makeSimulation(0xa11ce);
  const evadingInput = (tick: number) => skilledInput(tick);

  advance(simulation, PHASE_TICKS - 1, evadingInput);
  let snapshot = simulation.getSnapshot();
  assert.equal(snapshot.tick, 599);
  assert.equal(snapshot.phase, "ORBIT");
  assert.equal(snapshot.phaseTime, 599 / 60);

  const boundaryEvents = advance(simulation, 1, (tick) => evadingInput(tick + 599));
  snapshot = simulation.getSnapshot();
  assert.equal(snapshot.tick, 600);
  assert.equal(snapshot.phase, "FRACTURE");
  assert.equal(snapshot.phaseTime, 0);
  assert.ok(boundaryEvents.some((event) => event.type === "phase" && event.phase === "FRACTURE"));

  const completionEvents = advance(
    simulation,
    RUN_TICKS - PHASE_TICKS,
    (tick) => evadingInput(tick + PHASE_TICKS),
  );
  snapshot = simulation.getSnapshot();
  assert.equal(snapshot.status, "results");
  assert.equal(snapshot.tick, RUN_TICKS);
  assert.equal(snapshot.elapsed, 60);
  assert.equal(snapshot.phase, "NOVA");
  assert.equal(snapshot.phaseProgress, 1);
  assert.equal(snapshot.runComplete, true);
  assert.deepEqual(snapshot.metrics.phaseCompleted, [true, true, true, true, true, true]);
  assert.ok(completionEvents.some((event) => event.type === "complete"));
});

test("hold captures visible mass and release emits a scored configuration-dependent Nova", () => {
  const simulation = makeSimulation(0xcafef00d);
  const start = simulation.getSnapshot();
  const coreTarget = { x: start.core.x, y: start.core.y };

  const chargeEvents = advance(simulation, 54, (tick) => input({
    target: coreTarget,
    active: true,
    justPressed: tick === 0,
  }));
  const charged = simulation.getSnapshot();
  assert.equal(chargeEvents.filter((event) => event.type === "charge-start").length, 1);
  assert.ok(charged.core.charge > 0.2);
  assert.ok(charged.entities.some((entity) => entity.kind === "orbiter" && entity.captured));

  const releaseEvents = simulation.update(FIXED_STEP, input({
    target: coreTarget,
    active: false,
    justReleased: true,
  }));
  const nova = releaseEvents.find((event) => event.type === "nova");
  assert.ok(nova && nova.captured >= 1);

  const released = simulation.getSnapshot();
  assert.equal(released.metrics.novaCount, 1);
  assert.ok(released.metrics.score > 0);
  assert.ok(Math.hypot(released.core.recoilX, released.core.recoilY) > 0);
  assert.equal(released.core.charge, 0);
  assert.ok(released.entities.every((entity) => !entity.captured));
});

test("input edges are latched between sub-step updates and active-state edges are inferred", () => {
  const simulation = makeSimulation(77);
  const center = simulation.getSnapshot().core;

  assert.deepEqual(
    simulation.update(FIXED_STEP * 0.4, input({
      target: center,
      active: true,
      justPressed: true,
    })).filter((event) => event.type === "charge-start"),
    [],
  );
  const pressEvents = simulation.update(FIXED_STEP * 0.6, input({ target: center, active: true }));
  assert.equal(pressEvents.filter((event) => event.type === "charge-start").length, 1);

  advance(simulation, 8, () => input({ target: center, active: true }));
  const releaseEvents = simulation.update(FIXED_STEP, input({ target: center, active: false }));
  assert.equal(releaseEvents.filter((event) => event.type === "nova").length, 1);
  assert.equal(simulation.getSnapshot().core.charge, 0);

  const inferredPress = simulation.update(FIXED_STEP, input({ target: center, active: true }));
  assert.equal(inferredPress.filter((event) => event.type === "charge-start").length, 1);
});

test("FRACTURE creates a bounded pool of large shards and chain-scored events", () => {
  const simulation = makeSimulation(0xdecafbad);
  simulation.forcePhase(1);
  const phaseStart = simulation.getSnapshot();
  const cluster = phaseStart.entities.filter((entity) => entity.kind === "crystal");
  assert.ok(cluster.length >= 4);

  const target = { x: phaseStart.core.x, y: phaseStart.core.y };
  advance(simulation, 90, (tick) => input({
    target,
    active: true,
    justPressed: tick === 0,
  }));
  const events = simulation.update(FIXED_STEP, input({
    target,
    active: false,
    justReleased: true,
  }));
  const snapshot = simulation.getSnapshot();
  const fractureEvents = events.filter((event) => event.type === "fracture");
  const fragments = snapshot.entities.filter((entity) => entity.kind === "fragment");

  assert.ok(fractureEvents.length >= 2);
  assert.ok(fractureEvents.some((event) => event.type === "fracture" && event.chain > 1));
  assert.ok(snapshot.metrics.largestChain >= 2);
  assert.ok(fragments.length > 0 && fragments.length <= 64);
  assert.ok(fragments.every((fragment) => fragment.radius >= 5.5));
  assert.ok(snapshot.entities.length <= 112);
});

test("resize scales and clamps live state without producing invalid coordinates", () => {
  const simulation = makeSimulation(8080);
  advance(simulation, 130, (tick) => input({
    target: { x: 820, y: 80 + tick },
    active: tick > 20 && tick < 75,
    justPressed: tick === 21,
    justReleased: tick === 75,
  }));

  simulation.resize(44, 38);
  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.width, 96);
  assert.equal(snapshot.height, 96);
  assert.ok(snapshot.core.x >= snapshot.core.radius && snapshot.core.x <= snapshot.width - snapshot.core.radius);
  assert.ok(snapshot.core.y >= snapshot.core.radius && snapshot.core.y <= snapshot.height - snapshot.core.radius);
  for (const entity of snapshot.entities) {
    assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.y));
    assert.ok(entity.x >= 0 && entity.x <= snapshot.width);
    assert.ok(entity.y >= 0 && entity.y <= snapshot.height);
  }

  simulation.resize(Number.NaN, Number.POSITIVE_INFINITY);
  const afterInvalidResize = simulation.getSnapshot();
  assert.equal(afterInvalidResize.width, 96);
  assert.equal(afterInvalidResize.height, 96);
});

test("endless mode rolls into a harder second cycle while Daily mode stops", () => {
  const simulation = new GameSimulation({
    width: 960,
    height: 540,
    mode: "endless",
    seed: 9,
  });
  simulation.start("endless", 9);
  const events = advance(simulation, RUN_TICKS, skilledInput);
  const snapshot = simulation.getSnapshot();

  assert.equal(snapshot.status, "playing");
  assert.equal(snapshot.tick, RUN_TICKS);
  assert.equal(snapshot.cycle, 1);
  assert.equal(snapshot.phase, "ORBIT");
  assert.ok(snapshot.difficulty > 1);
  assert.ok(events.some((event) => event.type === "phase" && event.phase === "ORBIT"));
});

test("FLOW follows deterministic analytic currents and Nova opens a suppressed corridor", () => {
  const simulation = makeSimulation(123);
  simulation.forcePhase(2);
  const opening = simulation.getSnapshot();
  const openingDroplets = new Map(
    opening.entities
      .filter((entity) => entity.kind === "droplet")
      .map((entity) => [entity.id, entity]),
  );
  assert.equal(opening.entities.filter((entity) => entity.kind === "vortex").length, 2);
  assert.equal(openingDroplets.size, 12);

  advance(simulation, 70, () => input());
  const flowing = simulation.getSnapshot();
  assert.ok(flowing.entities.some((entity) => {
    const before = openingDroplets.get(entity.id);
    return entity.kind === "droplet" && before && (
      Math.abs(entity.vx - before.vx) > 4 || Math.abs(entity.vy - before.vy) > 4
    );
  }));

  advance(simulation, 80, (tick) => input({
    active: true,
    justPressed: tick === 0,
  }));
  const events = simulation.update(FIXED_STEP, input({
    target: { x: 800, y: 270 },
    justReleased: true,
  }));
  const afterNova = simulation.getSnapshot();
  assert.ok(events.some((event) => event.type === "nova"));
  assert.ok(afterNova.entities.some((entity) => (
    (entity.kind === "droplet" || entity.kind === "vortex") &&
    entity.state < -50 &&
    !entity.dangerous
  )));
  assert.ok(afterNova.entities.filter((entity) => entity.kind === "droplet").length <= 24);
  assert.ok(afterNova.entities.filter((entity) => entity.kind === "vortex").length <= 4);
});

test("ECHO replays recorded gameplay history and forcePhase has a deterministic fallback", () => {
  const simulation = makeSimulation(0xecc011);
  const recorded: Array<{ x: number; y: number }> = [];
  for (let tick = 0; tick < 600; tick += 1) {
    simulation.update(FIXED_STEP, input({
      target: {
        x: 480 + Math.cos(tick * 0.018) * 175,
        y: 270 + Math.sin(tick * 0.023) * 105,
      },
    }));
    const core = simulation.getSnapshot().core;
    recorded.push({ x: core.x, y: core.y });
  }
  simulation.forcePhase(3);
  advance(simulation, 180, () => input());
  const replay = simulation.getSnapshot().entities.filter((entity) => entity.kind === "echo");
  assert.equal(replay.length, 2);
  assert.ok(replay.every((entity) => distanceToPolyline(entity.x, entity.y, recorded) < 1e-6));

  const firstFallback = makeSimulation(404);
  const secondFallback = makeSimulation(404);
  firstFallback.forcePhase(3);
  secondFallback.forcePhase(3);
  advance(firstFallback, 150, () => input());
  advance(secondFallback, 150, () => input());
  const echoProjection = (simulationToProject: GameSimulation) => simulationToProject
    .getSnapshot()
    .entities
    .filter((entity) => entity.kind === "echo")
    .map(({ id, x, y, vx, vy, state, dangerous, seed }) => ({
      id,
      x,
      y,
      vx,
      vy,
      state,
      dangerous,
      seed,
    }));
  assert.ok(echoProjection(firstFallback).length >= 1);
  assert.deepEqual(echoProjection(firstFallback), echoProjection(secondFallback));
});

test("reduced motion changes cosmetics but not Daily gameplay or ECHO history", () => {
  const normal = new GameSimulation({
    width: 960,
    height: 540,
    mode: "daily",
    seed: 0xa11ce,
    reducedMotion: false,
  });
  const reduced = new GameSimulation({
    width: 960,
    height: 540,
    mode: "daily",
    seed: 0xa11ce,
    reducedMotion: true,
  });
  normal.start("daily", 0xa11ce);
  reduced.start("daily", 0xa11ce);
  advance(normal, RUN_TICKS, skilledInput);
  advance(reduced, RUN_TICKS, skilledInput);

  const gameplayProjection = (simulationToProject: GameSimulation) => {
    const snapshot = simulationToProject.getSnapshot();
    return {
      status: snapshot.status,
      tick: snapshot.tick,
      phase: snapshot.phase,
      core: snapshot.core,
      entities: snapshot.entities,
      metrics: snapshot.metrics,
      lastChain: snapshot.lastChain,
      runComplete: snapshot.runComplete,
      deathReason: snapshot.deathReason,
    };
  };
  assert.deepEqual(gameplayProjection(normal), gameplayProjection(reduced));
});

test("SWARM steers coherently, remains bounded, and Nova breaks a connected formation", () => {
  const simulation = makeSimulation(0x51f7a11);
  simulation.forcePhase(4);
  const openingSwarm = simulation.getSnapshot().entities.filter((entity) => entity.kind === "swarm");
  assert.equal(openingSwarm.length, 16);
  const meanHeading = openingSwarm.reduce((mean, entity) => {
    const speed = Math.max(1, Math.hypot(entity.vx, entity.vy));
    mean.x += entity.vx / speed;
    mean.y += entity.vy / speed;
    return mean;
  }, { x: 0, y: 0 });
  assert.ok(Math.hypot(meanHeading.x, meanHeading.y) / openingSwarm.length > 0.8);

  advance(simulation, 60, (tick) => input({
    active: true,
    justPressed: tick === 0,
  }));
  const events = simulation.update(FIXED_STEP, input({ justReleased: true }));
  const nova = events.find((event) => event.type === "nova");
  const breakEvents = events.filter((event) => event.type === "fracture");
  const snapshot = simulation.getSnapshot();
  const swarm = snapshot.entities.filter((entity) => entity.kind === "swarm");

  assert.ok(nova && nova.captured >= 1);
  assert.ok(breakEvents.length >= 1 && breakEvents.length <= 6);
  assert.ok(snapshot.lastChain >= 2);
  assert.ok(swarm.filter((entity) => entity.state < 0).length >= snapshot.lastChain);
  assert.ok(swarm.length <= 30);
  assert.ok(swarm.every((entity) => (
    Number.isFinite(entity.x) &&
    Number.isFinite(entity.y) &&
    entity.x >= 0 &&
    entity.x <= snapshot.width &&
    entity.y >= 0 &&
    entity.y <= snapshot.height
  )));
});

test("NOVA curates every earlier law, ramps collapse pressure, and remains survivable", () => {
  const simulation = makeSimulation(0xa11ce);
  advance(simulation, 3_000, skilledInput);
  const opening = simulation.getSnapshot();
  const counts = countsByKind(opening);
  assert.equal(opening.phase, "NOVA");
  for (const kind of ["droplet", "vortex", "echo", "swarm", "crystal", "orbiter"]) {
    assert.ok((counts.get(kind) ?? 0) >= 1, `${kind} should be represented`);
  }
  assert.ok((counts.get("droplet") ?? 0) <= 8);
  assert.ok((counts.get("vortex") ?? 0) <= 1);
  assert.ok((counts.get("echo") ?? 0) <= 2);
  assert.ok((counts.get("swarm") ?? 0) <= 12);
  assert.ok((counts.get("crystal") ?? 0) <= 6);
  assert.ok((counts.get("orbiter") ?? 0) <= 6);
  assert.ok(opening.entities.length <= 112);

  const openingDifficulty = opening.difficulty;
  advance(simulation, 301, (tick) => skilledInput(tick + 3_000));
  const climax = simulation.getSnapshot();
  assert.ok(climax.difficulty > openingDifficulty);
  assert.ok(climax.entities.some((entity) => {
    if (entity.kind === "echo" || entity.kind === "gate") return false;
    const inwardX = climax.core.x - entity.x;
    const inwardY = climax.core.y - entity.y;
    return inwardX * entity.vx + inwardY * entity.vy > 0;
  }));

  advance(simulation, RUN_TICKS - 3_301, (tick) => skilledInput(tick + 3_301));
  const result = simulation.getSnapshot();
  assert.equal(result.tick, RUN_TICKS);
  assert.equal(result.runComplete, true);
  assert.equal(result.status, "results");
});

test("difficulty is staged, idling normally fails, and a terminal run cannot also complete", () => {
  const curve = makeSimulation(88);
  assert.equal(curve.getSnapshot().difficulty, 1);
  advance(curve, 300, () => input());
  assert.equal(curve.getSnapshot().difficulty, 1);
  advance(curve, 1, () => input());
  assert.ok(curve.getSnapshot().difficulty > 1);
  curve.forcePhase(2);
  const flowDifficulty = curve.getSnapshot().difficulty;
  curve.forcePhase(5);
  assert.ok(curve.getSnapshot().difficulty > flowDifficulty);

  const idle = makeSimulation(0);
  const idleEvents: GameEvent[] = [];
  while (idle.getSnapshot().status === "playing" && idle.getSnapshot().tick < RUN_TICKS) {
    idleEvents.push(...idle.update(FIXED_STEP, input()));
  }
  const failure = idle.getSnapshot();
  assert.equal(failure.runComplete, false);
  assert.ok(failure.tick > 300 && failure.tick < RUN_TICKS);
  assert.ok(idleEvents.some((event) => event.type === "game-over"));
  assert.ok(!idleEvents.some((event) => event.type === "complete"));

  const terminal = makeSimulation(91);
  terminal.forcePhase(5);
  advance(terminal, PHASE_TICKS - 1, (tick) => skilledInput(tick + 3_000));
  assert.equal(terminal.getSnapshot().tick, RUN_TICKS - 1);
  terminal.end("test terminal");
  const terminalEvents = terminal.update(FIXED_STEP, input());
  assert.equal(terminal.getSnapshot().tick, RUN_TICKS - 1);
  assert.equal(terminal.getSnapshot().runComplete, false);
  assert.ok(terminalEvents.some((event) => event.type === "game-over"));
  assert.ok(!terminalEvents.some((event) => event.type === "complete"));
});

test("100 deterministic runs preserve all global and final-law budgets", { timeout: 20_000 }, () => {
  let completed = 0;
  let maximumEntities = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    const simulation = makeSimulation(seed);
    for (let tick = 0; tick < RUN_TICKS; tick += 1) {
      if (simulation.getSnapshot().status !== "playing") {
        break;
      }
      simulation.update(FIXED_STEP, skilledInput(tick));
      if (tick % 45 !== 0 && tick !== RUN_TICKS - 1) {
        continue;
      }
      const snapshot = simulation.getSnapshot();
      const counts = countsByKind(snapshot);
      maximumEntities = Math.max(maximumEntities, snapshot.entities.length);
      assert.ok(snapshot.entities.length <= 112);
      assert.ok((counts.get("fragment") ?? 0) <= 64);
      assert.ok((counts.get("energy") ?? 0) <= 20);
      assert.ok((counts.get("gate") ?? 0) <= 4);
      assert.ok((counts.get("droplet") ?? 0) <= 24);
      assert.ok((counts.get("vortex") ?? 0) <= 4);
      assert.ok((counts.get("echo") ?? 0) <= 3);
      assert.ok((counts.get("swarm") ?? 0) <= 30);
      assert.ok((counts.get("crystal") ?? 0) <= 22);
      assert.ok((counts.get("orbiter") ?? 0) <= 16);
      if (snapshot.phase === "NOVA") {
        assert.ok((counts.get("droplet") ?? 0) <= 8);
        assert.ok((counts.get("vortex") ?? 0) <= 1);
        assert.ok((counts.get("echo") ?? 0) <= 2);
        assert.ok((counts.get("swarm") ?? 0) <= 12);
        assert.ok((counts.get("crystal") ?? 0) <= 6);
        assert.ok((counts.get("orbiter") ?? 0) <= 6);
      }
      for (const entity of snapshot.entities) {
        assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.y));
        assert.ok(Number.isFinite(entity.vx) && Number.isFinite(entity.vy));
        assert.ok(entity.x >= 0 && entity.x <= snapshot.width);
        assert.ok(entity.y >= 0 && entity.y <= snapshot.height);
      }
    }
    if (simulation.getSnapshot().runComplete) {
      completed += 1;
    }
  }
  assert.ok(maximumEntities > 30 && maximumEntities <= 112);
  assert.ok(completed >= 35, `expected skilled survival to be plausible, got ${completed}/100`);
});
