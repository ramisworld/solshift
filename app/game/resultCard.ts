import {
  compactSeed,
  createShareText,
  formatScoreDelta,
  resultDeltas,
  type RunResult,
// @ts-expect-error Node's native TypeScript runner requires the source extension.
} from "./protocol.ts";

export const RESULT_CARD_WIDTH = 1_200;
export const RESULT_CARD_HEIGHT = 630;
export const RESULT_CARD_MIME = "image/png";

type CardContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface ResultCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): CardContext | null;
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
}

export interface ResultCardOptions {
  /** Primarily for deterministic unit tests and non-DOM canvas hosts. */
  canvasFactory?: (width: number, height: number) => ResultCanvas;
  mimeType?: string;
  quality?: number;
}

export type ShareOutcome =
  | "shared-image"
  | "shared-text"
  | "copied"
  | "downloaded"
  | "cancelled"
  | "unavailable";

interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

interface UrlFactory {
  createObjectURL(value: Blob): string;
  revokeObjectURL(value: string): void;
}

export interface ResultShareEnvironment {
  navigator?: ShareNavigator | null;
  document?: Document | null;
  urlFactory?: UrlFactory | null;
  FileConstructor?: typeof File | null;
}

export interface ShareResultOptions {
  result: RunResult;
  challengeUrl?: string;
  image?: Blob | null;
  filename?: string;
  environment?: ResultShareEnvironment;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundRect(
  context: CardContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function font(size: number, weight = 600, trackingFace = false): string {
  const face = trackingFace
    ? '"Arial Narrow", "Helvetica Neue", Arial, sans-serif'
    : 'Inter, "Helvetica Neue", Arial, sans-serif';
  return `${weight} ${size}px ${face}`;
}

function fitText(context: CardContext, text: string, maximumWidth: number): string {
  if (context.measureText(text).width <= maximumWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maximumWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}…`;
}

function drawPhaseGlyph(context: CardContext, phase: number, x: number, y: number): void {
  context.save();
  context.translate(x, y);
  context.strokeStyle = phase === 5 ? "#ffd596" : "#aeeaff";
  context.fillStyle = phase === 5 ? "#fff0c7" : "#c9f4ff";
  context.lineWidth = 2;
  context.globalAlpha = 0.95;

  if (phase === 0) {
    context.beginPath();
    context.arc(0, 0, 10, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(8, -6, 2.5, 0, Math.PI * 2);
    context.fill();
  } else if (phase === 1) {
    context.beginPath();
    context.moveTo(0, -12);
    context.lineTo(10, -3);
    context.lineTo(4, 12);
    context.lineTo(-10, 4);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.moveTo(-4, -7);
    context.lineTo(3, 3);
    context.lineTo(-1, 11);
    context.stroke();
  } else if (phase === 2) {
    context.beginPath();
    for (let point = -14; point <= 14; point += 2) {
      const wave = Math.sin(point * 0.32) * 7;
      if (point === -14) context.moveTo(point, wave);
      else context.lineTo(point, wave);
    }
    context.stroke();
  } else if (phase === 3) {
    for (let echo = 0; echo < 3; echo += 1) {
      context.globalAlpha = 0.95 - echo * 0.24;
      context.beginPath();
      context.arc(-5 + echo * 5, 0, 7, -1.1, 1.1);
      context.stroke();
    }
  } else if (phase === 4) {
    for (let dot = 0; dot < 7; dot += 1) {
      const angle = dot * 2.4;
      const radius = 4 + dot * 1.1;
      context.beginPath();
      context.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, 1.8, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.beginPath();
    for (let point = 0; point < 16; point += 1) {
      const radius = point % 2 === 0 ? 13 : 4.5;
      const angle = point * Math.PI / 8 - Math.PI / 2;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (point === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.stroke();
  }
  context.restore();
}

function drawBackdrop(context: CardContext, seed: number): void {
  const background = context.createLinearGradient(0, 0, RESULT_CARD_WIDTH, RESULT_CARD_HEIGHT);
  background.addColorStop(0, "#03070b");
  background.addColorStop(0.52, "#071017");
  background.addColorStop(1, "#030609");
  context.fillStyle = background;
  context.fillRect(0, 0, RESULT_CARD_WIDTH, RESULT_CARD_HEIGHT);

  const cold = context.createRadialGradient(130, 570, 0, 130, 570, 520);
  cold.addColorStop(0, "rgba(67, 197, 255, .14)");
  cold.addColorStop(0.42, "rgba(26, 94, 126, .07)");
  cold.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = cold;
  context.fillRect(0, 0, RESULT_CARD_WIDTH, RESULT_CARD_HEIGHT);

  const random = seededRandom(seed ^ 0xc01dcafe);
  for (let index = 0; index < 190; index += 1) {
    const x = random() * RESULT_CARD_WIDTH;
    const y = random() * RESULT_CARD_HEIGHT;
    const alpha = 0.04 + random() * 0.13;
    context.fillStyle = `rgba(204, 239, 255, ${alpha})`;
    const radius = random() > 0.92 ? 1.2 : 0.55;
    context.fillRect(x, y, radius, radius);
  }

  context.strokeStyle = "rgba(142, 222, 255, .07)";
  context.lineWidth = 1;
  for (let line = 0; line < 5; line += 1) {
    context.beginPath();
    context.arc(935, 308, 138 + line * 30, Math.PI * 0.69, Math.PI * 1.56);
    context.stroke();
  }
}

function drawCore(context: CardContext): void {
  const x = 952;
  const y = 300;
  const field = context.createRadialGradient(x, y, 15, x, y, 216);
  field.addColorStop(0, "rgba(255, 248, 215, .33)");
  field.addColorStop(0.27, "rgba(255, 170, 58, .14)");
  field.addColorStop(0.68, "rgba(255, 118, 20, .025)");
  field.addColorStop(1, "rgba(255, 118, 20, 0)");
  context.fillStyle = field;
  context.beginPath();
  context.arc(x, y, 216, 0, Math.PI * 2);
  context.fill();

  const orb = context.createRadialGradient(x - 24, y - 28, 3, x, y, 79);
  orb.addColorStop(0, "#ffffff");
  orb.addColorStop(0.28, "#fff9d8");
  orb.addColorStop(0.66, "#ffd071");
  orb.addColorStop(0.89, "#fa8a22");
  orb.addColorStop(1, "rgba(245, 102, 20, 0)");
  context.fillStyle = orb;
  context.beginPath();
  context.arc(x, y, 80, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.translate(x, y);
  context.rotate(-0.24);
  context.strokeStyle = "rgba(103, 45, 18, .48)";
  context.lineWidth = 7;
  context.beginPath();
  context.arc(-4, -2, 49, 0.2, 2.2);
  context.stroke();
  context.rotate(1.72);
  context.lineWidth = 4;
  context.beginPath();
  context.arc(3, 7, 58, 0.4, 1.85);
  context.stroke();
  context.restore();

  context.strokeStyle = "rgba(255, 211, 130, .55)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(x, y, 105, -0.35, Math.PI * 1.4);
  context.stroke();
  context.beginPath();
  context.arc(x, y, 135, Math.PI * 0.72, Math.PI * 1.93);
  context.stroke();
}

function pill(context: CardContext, label: string, x: number, y: number, accent: boolean): number {
  context.font = font(13, 700, true);
  const width = context.measureText(label).width + 28;
  roundRect(context, x, y, width, 31, 15.5);
  context.fillStyle = accent ? "rgba(255, 183, 79, .14)" : "rgba(112, 211, 255, .09)";
  context.fill();
  context.strokeStyle = accent ? "rgba(255, 200, 123, .48)" : "rgba(134, 224, 255, .26)";
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = accent ? "#ffd49a" : "#bdeeff";
  context.textBaseline = "middle";
  context.fillText(label, x + 14, y + 16);
  return width;
}

function drawResult(context: CardContext, result: RunResult): void {
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  context.fillStyle = "#f7fbff";
  context.font = font(29, 800, true);
  context.fillText("SOL", 60, 69);
  context.fillStyle = "#ffbd69";
  context.fillText("//", 113, 69);
  context.fillStyle = "#f7fbff";
  context.fillText("SHIFT", 143, 69);

  context.fillStyle = "rgba(196, 228, 239, .58)";
  context.font = font(12, 700, true);
  const mode = result.mode === "daily"
    ? `DAILY SHIFT${result.challengeNumber === undefined ? "" : ` #${result.challengeNumber}`}`
    : "ENDLESS SHIFT";
  context.fillText(`${mode}  //  SEED ${compactSeed(result.seed)}`, 60, 100);

  context.fillStyle = "rgba(177, 217, 232, .62)";
  context.font = font(13, 700, true);
  context.fillText("FINAL SCORE", 60, 161);
  context.fillStyle = "#f7fbff";
  context.font = font(78, 760, true);
  context.fillText(result.score.toLocaleString("en-US"), 55, 234);

  context.fillStyle = "#ffcb83";
  context.font = font(24, 750, true);
  context.fillText(fitText(context, result.archetype.toUpperCase(), 510), 60, 282);
  context.fillStyle = "rgba(198, 231, 241, .72)";
  context.font = font(15, 600, true);
  const survivalMaximum = result.mode === "daily" ? 60 : Number.MAX_SAFE_INTEGER;
  const survival = clamp(
    Number.isFinite(result.survivalSeconds) ? result.survivalSeconds : 0,
    0,
    survivalMaximum,
  ).toFixed(1);
  context.fillText(`${survival}s SURVIVAL   ·   BEST COMBO ×${Math.max(0, Math.floor(result.bestCombo))}`, 60, 314);

  let pillX = 60;
  const pillY = 344;
  if (result.isPersonalBest) {
    pillX += pill(context, "NEW PERSONAL BEST", pillX, pillY, true) + 10;
  } else if (result.personalBest !== null && result.personalBest !== undefined) {
    pillX += pill(context, `PB ${result.personalBest.toLocaleString("en-US")}`, pillX, pillY, false) + 10;
  }

  const challenger = resultDeltas(result.score, result.challengerTarget).challenger;
  if (challenger) {
    const prefix = challenger.state === "ahead"
      ? "CHALLENGER BEAT"
      : challenger.state === "tied"
        ? "CHALLENGER TIED"
        : "CHALLENGER";
    pillX += pill(context, `${prefix} ${formatScoreDelta(challenger)}`, pillX, pillY, challenger.state === "ahead") + 10;
  }
  if (result.attempt !== undefined && pillX < 510) {
    pill(context, `ATTEMPT ${Math.max(0, Math.floor(result.attempt))}`, pillX, pillY, false);
  }

  context.strokeStyle = "rgba(163, 218, 239, .14)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(60, 415);
  context.lineTo(1_140, 415);
  context.stroke();

  context.fillStyle = "rgba(185, 224, 239, .55)";
  context.font = font(11, 700, true);
  context.fillText("SHIFT SIGNATURE  //  SIX LAWS RECORDED", 60, 447);

  const cellWidth = 168;
  const gap = 12;
  const y = 470;
  const phaseLabels = ["ORBIT", "FRACTURE", "FLOW", "ECHO", "SWARM", "NOVA"];
  for (let phase = 0; phase < 6; phase += 1) {
    const x = 60 + phase * (cellWidth + gap);
    roundRect(context, x, y, cellWidth, 105, 8);
    context.fillStyle = phase === 5 ? "rgba(255, 172, 69, .075)" : "rgba(112, 207, 244, .045)";
    context.fill();
    context.strokeStyle = phase === 5 ? "rgba(255, 201, 128, .28)" : "rgba(146, 220, 245, .16)";
    context.stroke();
    drawPhaseGlyph(context, phase, x + 31, y + 37);
    context.fillStyle = "rgba(200, 232, 241, .58)";
    context.font = font(10, 700, true);
    context.fillText(phaseLabels[phase], x + 55, y + 28);
    context.fillStyle = phase === 5 ? "#ffd49b" : "#e7f7fc";
    context.font = font(30, 760, true);
    context.fillText(String(result.phaseGrades[phase]), x + 55, y + 61);
    context.fillStyle = "rgba(169, 210, 225, .45)";
    context.font = font(10, 700, true);
    context.fillText("/ 5", x + 80, y + 59);
    const filled = result.phaseGrades[phase];
    for (let mark = 0; mark < 5; mark += 1) {
      context.fillStyle = mark < filled
        ? (phase === 5 ? "#ffc36f" : "#9fe7ff")
        : "rgba(148, 195, 212, .15)";
      context.fillRect(x + 18 + mark * 28, y + 83, 20, 2);
    }
  }

  context.fillStyle = "rgba(203, 232, 241, .48)";
  context.font = font(10, 650, true);
  context.textAlign = "right";
  context.fillText("SURVIVE 60 SECONDS WHILE THE LAWS OF PHYSICS MUTATE", 1_140, 608);
}

function makeCanvas(options: ResultCardOptions): ResultCanvas {
  if (options.canvasFactory) {
    return options.canvasFactory(RESULT_CARD_WIDTH, RESULT_CARD_HEIGHT);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = RESULT_CARD_WIDTH;
    canvas.height = RESULT_CARD_HEIGHT;
    return canvas as ResultCanvas;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(RESULT_CARD_WIDTH, RESULT_CARD_HEIGHT) as ResultCanvas;
  }
  throw new Error("Result-card Canvas is unavailable in this environment");
}

function canvasBlob(canvas: ResultCanvas, type: string, quality?: number): Promise<Blob> {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  if (canvas.toBlob) {
    return new Promise((resolve, reject) => {
      canvas.toBlob?.((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas could not encode the result card"));
      }, type, quality);
    });
  }
  return Promise.reject(new Error("Canvas Blob export is unavailable"));
}

/** Produces a 1200x630, fully procedural, network-free result image. */
export async function generateResultCardBlob(
  result: RunResult,
  options: ResultCardOptions = {},
): Promise<Blob> {
  const canvas = makeCanvas(options);
  canvas.width = RESULT_CARD_WIDTH;
  canvas.height = RESULT_CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  drawBackdrop(context, result.seed);
  drawCore(context);
  drawResult(context, result);
  return canvasBlob(canvas, options.mimeType ?? RESULT_CARD_MIME, options.quality);
}

export const generateResultCard = generateResultCardBlob;

function defaultNavigator(): ShareNavigator | null {
  try {
    return typeof navigator === "undefined" ? null : navigator;
  } catch {
    return null;
  }
}

function defaultDocument(): Document | null {
  try {
    return typeof document === "undefined" ? null : document;
  } catch {
    return null;
  }
}

function defaultUrlFactory(): UrlFactory | null {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null;
}

function defaultFileConstructor(): typeof File | null {
  try {
    return typeof File === "undefined" ? null : File;
  } catch {
    return null;
  }
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error
    && (error as { name?: unknown }).name === "AbortError");
}

export async function copyResultText(
  text: string,
  environment: ResultShareEnvironment = {},
): Promise<boolean> {
  const nav = environment.navigator === undefined ? defaultNavigator() : environment.navigator;
  try {
    if (nav?.clipboard?.writeText) {
      const wrote = await Promise.race([
        nav.clipboard.writeText(text).then(() => true, () => false),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 350)),
      ]);
      if (wrote) return true;
    }
  } catch {
    // Fall through to the short-lived textarea technique.
  }

  const doc = environment.document === undefined ? defaultDocument() : environment.document;
  if (!doc?.body || typeof doc.execCommand !== "function") return false;
  let input: HTMLTextAreaElement | null = null;
  try {
    input = doc.createElement("textarea");
    input.value = text;
    input.readOnly = true;
    input.setAttribute("aria-hidden", "true");
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    doc.body.appendChild(input);
    input.select();
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    try {
      input?.remove();
    } catch {
      // Cleanup must not turn a best-effort copy into an application error.
    }
  }
}

export function downloadResultCard(
  image: Blob,
  filename = "sol-shift-result.png",
  environment: ResultShareEnvironment = {},
): boolean {
  const doc = environment.document === undefined ? defaultDocument() : environment.document;
  const urls = environment.urlFactory === undefined ? defaultUrlFactory() : environment.urlFactory;
  if (!doc?.body || !urls) return false;
  let objectUrl: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  let downloaded = false;
  const revoke = () => {
    if (objectUrl === null) return;
    try {
      urls.revokeObjectURL(objectUrl);
    } catch {
      // The browser owns the URL lifecycle; revocation remains best effort.
    }
  };
  try {
    objectUrl = urls.createObjectURL(image);
    anchor = doc.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    doc.body.appendChild(anchor);
    anchor.click();
    downloaded = true;
    return true;
  } catch {
    return false;
  } finally {
    try {
      anchor?.remove();
    } catch {
      // A detached or policy-controlled DOM node needs no further handling.
    }
    if (objectUrl !== null) {
      if (downloaded) {
        try {
          setTimeout(revoke, 1_000);
        } catch {
          revoke();
        }
      } else {
        revoke();
      }
    }
  }
}

/**
 * Progressive share: attach the image only when Web Share explicitly confirms
 * file support; otherwise share text, copy it, then offer a local image download.
 * No social network is assumed to accept or attach the generated card.
 */
export async function shareResult(options: ShareResultOptions): Promise<ShareOutcome> {
  const environment = options.environment ?? {};
  const nav = environment.navigator === undefined ? defaultNavigator() : environment.navigator;
  // Web Share carries the URL in its dedicated field; clipboard fallback needs
  // the complete text. Keeping those separate avoids duplicate links in targets.
  const text = createShareText(options.result);
  const clipboardText = createShareText(options.result, options.challengeUrl);
  const title = `SOL//SHIFT — ${options.result.score.toLocaleString("en-US")}`;
  const filename = options.filename ?? "sol-shift-result.png";
  const FileType = environment.FileConstructor === undefined
    ? defaultFileConstructor()
    : environment.FileConstructor;

  if (nav?.share) {
    let fileData: ShareData | null = null;
    if (options.image && FileType && nav.canShare) {
      try {
        const file = new FileType([options.image], filename, {
          type: options.image.type || RESULT_CARD_MIME,
        });
        const candidate: ShareData = {
          title,
          text,
          ...(options.challengeUrl ? { url: options.challengeUrl } : {}),
          files: [file],
        };
        if (nav.canShare(candidate)) fileData = candidate;
      } catch {
        fileData = null;
      }
    }

    if (fileData) {
      try {
        await nav.share(fileData);
        return "shared-image";
      } catch (error) {
        if (isAbort(error)) return "cancelled";
        // Some share targets reject mixed file/URL data despite canShare().
      }
    }

    try {
      await nav.share({
        title,
        text,
        ...(options.challengeUrl ? { url: options.challengeUrl } : {}),
      });
      return "shared-text";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
    }
  }

  if (await copyResultText(clipboardText, environment)) return "copied";
  if (options.image && downloadResultCard(options.image, filename, environment)) return "downloaded";
  return "unavailable";
}
