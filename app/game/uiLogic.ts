import type { RunResult } from "./protocol";

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
