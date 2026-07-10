import type { GameSnapshot, InputState } from "./types";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Deterministic recording assistant for Creator Mode. It only reads the same
 * visible world state as a player and produces ordinary pointer input; it does
 * not alter physics, stability, scoring, spawns, or collision rules.
 */
export function creatorAutopilotInput(
  snapshot: GameSnapshot,
  previous: InputState,
): InputState {
  const { core, width, height, tick, phaseIndex } = snapshot;
  const shortSide = Math.max(96, Math.min(width, height));
  const centreX = width * 0.5;
  const centreY = height * 0.5;
  const angle = tick * 0.018 + phaseIndex * 0.83;
  const orbitX = Math.min(width * 0.27, shortSide * 0.42);
  const orbitY = Math.min(height * 0.24, shortSide * 0.32);
  let desiredX = centreX + Math.cos(angle) * orbitX;
  let desiredY = centreY + Math.sin(angle * 1.19) * orbitY;

  let avoidX = 0;
  let avoidY = 0;
  let nearestDanger = Number.POSITIVE_INFINITY;
  let nearestEnergyDistance = Number.POSITIVE_INFINITY;
  let nearestEnergyX = centreX;
  let nearestEnergyY = centreY;

  for (const entity of snapshot.entities) {
    if (entity.kind === "energy" && !entity.captured) {
      const distance = Math.hypot(entity.x - core.x, entity.y - core.y);
      if (distance < nearestEnergyDistance) {
        nearestEnergyDistance = distance;
        nearestEnergyX = entity.x;
        nearestEnergyY = entity.y;
      }
    }
    if (!entity.dangerous || entity.captured) continue;

    const lookAhead = entity.kind === "echo" ? 0.12 : 0.34;
    const predictedX = entity.x + entity.vx * lookAhead;
    const predictedY = entity.y + entity.vy * lookAhead;
    const deltaX = core.x - predictedX;
    const deltaY = core.y - predictedY;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    const clearance = distance - core.radius - entity.radius * 0.8;
    nearestDanger = Math.min(nearestDanger, clearance);
    const reach = shortSide * (entity.kind === "vortex" ? 0.34 : 0.27);
    const pressure = clamp((reach - clearance) / reach, 0, 1) ** 2;
    const side = entity.id % 2 === 0 ? 1 : -1;
    avoidX += (deltaX / distance) * pressure + (-deltaY / distance) * pressure * 0.34 * side;
    avoidY += (deltaY / distance) * pressure + (deltaX / distance) * pressure * 0.34 * side;
  }

  const edgeMargin = Math.min(shortSide * 0.2, 120);
  avoidX += clamp((edgeMargin - core.x) / edgeMargin, 0, 1) ** 2;
  avoidX -= clamp((core.x - (width - edgeMargin)) / edgeMargin, 0, 1) ** 2;
  avoidY += clamp((edgeMargin - core.y) / edgeMargin, 0, 1) ** 2;
  avoidY -= clamp((core.y - (height - edgeMargin)) / edgeMargin, 0, 1) ** 2;

  const avoidance = Math.hypot(avoidX, avoidY);
  if (avoidance > 0.04) {
    const urgency = clamp(avoidance, 0, 1.6);
    desiredX = core.x + (avoidX / avoidance) * shortSide * (0.28 + urgency * 0.16);
    desiredY = core.y + (avoidY / avoidance) * shortSide * (0.28 + urgency * 0.16);
  } else if (nearestEnergyDistance < shortSide * 0.55) {
    desiredX = desiredX * 0.72 + nearestEnergyX * 0.28;
    desiredY = desiredY * 0.72 + nearestEnergyY * 0.28;
  }

  const cycleLength = phaseIndex === 5 ? 54 : 66;
  const chargeTicks = phaseIndex === 5 ? 43 : 53;
  const cycleTick = tick % cycleLength;
  let active = cycleTick < chargeTicks;
  if (nearestDanger < shortSide * 0.15 && core.charge > 0.12) active = false;
  if (core.charge > 0.82) active = false;

  return {
    target: {
      x: clamp(desiredX, core.radius, width - core.radius),
      y: clamp(desiredY, core.radius, height - core.radius),
    },
    keyboard: { x: 0, y: 0 },
    active,
    justPressed: active && !previous.active,
    justReleased: !active && previous.active,
    pointerType: "demo",
  };
}
