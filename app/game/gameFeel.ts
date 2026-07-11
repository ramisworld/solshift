export type NovaFeedbackTier = "empty" | "charged" | "loaded";

export const CHARGED_NOVA_THRESHOLD = 0.55;

/** Shared audiovisual/UI classification for a Nova event. */
export function getNovaFeedbackTier(
  strength: number,
  captured: number,
): NovaFeedbackTier {
  const safeCaptured = Number.isFinite(captured) ? Math.max(0, captured) : 0;
  if (safeCaptured >= 1) return "loaded";
  const safeStrength = Number.isFinite(strength) ? Math.max(0, strength) : 0;
  return safeStrength >= CHARGED_NOVA_THRESHOLD ? "charged" : "empty";
}
