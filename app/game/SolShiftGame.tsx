"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AudioEngine } from "./audio";
import { creatorAutopilotInput } from "./autopilot";
import {
  challengeFromResult,
  compactSeed,
  createRunResult,
  createShareText,
  decodeChallengeUrl,
  encodeChallengeUrl,
  getDailyShift,
  RunHistory,
  SafeStorageAdapter,
  type Challenge,
  type RunResult,
} from "./protocol";
import { GameRenderer } from "./renderer";
import {
  copyResultText,
  downloadResultCard,
  generateResultCardBlob,
  shareResult,
  type ShareOutcome,
} from "./resultCard";
import { GameSimulation } from "./simulation";
import { formatElapsed, resultStatus } from "./uiLogic";
import {
  FIXED_STEP,
  PHASES,
  type GameMode,
  type GameSnapshot,
  type InputState,
  type RenderQuality,
} from "./types";

interface HudState {
  status: GameSnapshot["status"];
  phaseIndex: number;
  phaseTime: number;
  elapsed: number;
  score: number;
  combo: number;
  flux: number;
  charge: number;
  stability: number;
  seed: number;
  runComplete: boolean;
  deathReason: string | null;
}

const INITIAL_HUD: HudState = {
  status: "menu",
  phaseIndex: 0,
  phaseTime: 0,
  elapsed: 0,
  score: 0,
  combo: 1,
  flux: 0,
  charge: 0,
  stability: 3,
  seed: 0,
  runComplete: false,
  deathReason: null,
};

type CreatorFrame = "auto" | "landscape" | "portrait";

interface StartOptions {
  seed?: number;
  creator?: boolean;
  phase?: number;
  phaseTick?: number;
  challengerTarget?: number | null;
}

interface GamePreferences {
  muted: boolean;
  volume: number;
  reducedMotion: boolean;
}

const SHOWCASE_SEED = 0x50_1a_7e_56;
const TARGET_RENDER_MS = 1_000 / 60;
const AUDIO_UPDATE_MS = 50;
const PHASE_RULES = [
  "MASS CURVES",
  "MATTER BREAKS",
  "SPACE FLOWS",
  "THE PAST RETURNS",
  "MANY THINK AS ONE",
  "ALL LAWS COLLAPSE",
] as const;
const PHASE_CODES = ["O", "F", "W", "E", "S", "N"] as const;

function deriveQuality(reducedMotion: boolean): RenderQuality {
  if (typeof window === "undefined") {
    return {
      level: "medium",
      dpr: 1,
      particles: 120,
      trailPoints: 64,
      bloom: true,
      reducedMotion,
    };
  }
  const mobile = matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const low = reducedMotion || cores <= 4 || memory <= 4;
  return {
    level: low ? "low" : mobile ? "medium" : "high",
    dpr: Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : low ? 1.35 : 2),
    particles: reducedMotion ? 48 : low ? 90 : mobile ? 140 : 220,
    trailPoints: reducedMotion ? 28 : low ? 48 : 84,
    bloom: !low,
    reducedMotion,
  };
}

function makeInput(): InputState {
  return {
    target: { x: 0, y: 0 },
    keyboard: { x: 0, y: 0 },
    active: false,
    justPressed: false,
    justReleased: false,
    pointerType: "mouse",
  };
}

function isGamePreferences(value: unknown): value is GamePreferences {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<GamePreferences>;
  return typeof item.muted === "boolean"
    && typeof item.reducedMotion === "boolean"
    && typeof item.volume === "number"
    && Number.isFinite(item.volume)
    && item.volume >= 0
    && item.volume <= 1;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "button, a, input, select, textarea, [contenteditable='true'], [role='button'], [role='slider']",
  ));
}

function toHud(snapshot: GameSnapshot): HudState {
  return {
    status: snapshot.status,
    phaseIndex: snapshot.phaseIndex,
    phaseTime: snapshot.phaseTime,
    elapsed: snapshot.elapsed,
    score: Math.floor(snapshot.metrics.score),
    combo: 1 + Math.min(
      2,
      Math.floor(Math.max(0, snapshot.metrics.combo - 1) / 3) * 0.2,
    ),
    flux: snapshot.metrics.unbankedFlux,
    charge: snapshot.core.charge,
    stability: snapshot.core.stability,
    seed: snapshot.seed,
    runComplete: snapshot.runComplete,
    deathReason: snapshot.deathReason,
  };
}

export function SolShiftGame() {
  const stageRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<GameSimulation | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const inputRef = useRef<InputState>(makeInput());
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const accumulatorRef = useRef(0);
  const renderAccumulatorRef = useRef(TARGET_RENDER_MS);
  const audioAccumulatorRef = useRef(AUDIO_UPDATE_MS);
  const keysRef = useRef(new Set<string>());
  const spaceHeldRef = useRef(false);
  const pausedRef = useRef(false);
  const lastHudTickRef = useRef(-1);
  const lastHudStatusRef = useRef<GameSnapshot["status"]>("menu");
  const runModeRef = useRef<GameMode>("daily");
  const runSeedRef = useRef(0);
  const challengerTargetRef = useRef<number | null>(null);
  const challengeStartedRef = useRef(false);
  const creatorRunRef = useRef(false);
  const autoPilotRef = useRef(false);
  const autoPilotInputRef = useRef<InputState>(makeInput());
  const slowMotionRef = useRef(false);
  const resultKeyRef = useRef("");
  const historyRef = useRef<RunHistory | null>(null);
  const preferencesRef = useRef<SafeStorageAdapter | null>(null);
  const pausePanelRef = useRef<HTMLElement>(null);
  const resultPanelRef = useRef<HTMLElement>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [mode, setMode] = useState<GameMode>("daily");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.78);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined"
      ? matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  const [showControls, setShowControls] = useState(true);
  const [paused, setPaused] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [resultImage, setResultImage] = useState<Blob | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareOutcome | "ready">("ready");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorPanelVisible, setCreatorPanelVisible] = useState(true);
  const [autoPilot, setAutoPilot] = useState(false);
  const [slowMotion, setSlowMotion] = useState(false);
  const [cleanHud, setCleanHud] = useState(false);
  const [creatorFrame, setCreatorFrame] = useState<CreatorFrame>("auto");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const dailyShift = useMemo(() => getDailyShift(), []);
  const dailySeed = dailyShift.seed;
  const dailyChallengeNumber = dailyShift.challengeNumber;

  if (historyRef.current === null) historyRef.current = new RunHistory();
  if (preferencesRef.current === null) preferencesRef.current = new SafeStorageAdapter();

  useEffect(() => {
    autoPilotRef.current = autoPilot;
  }, [autoPilot]);

  useEffect(() => {
    slowMotionRef.current = slowMotion;
    audioRef.current?.setPlaybackRate(slowMotion ? 0.35 : 1);
  }, [slowMotion]);

  useEffect(() => {
    const stored = preferencesRef.current?.read<GamePreferences>(
      "preferences",
      isGamePreferences,
    );
    if (stored) {
      setMuted(stored.muted);
      setVolume(stored.volume);
      setReducedMotion(stored.reducedMotion);
    }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    preferencesRef.current?.write("preferences", {
      muted,
      volume,
      reducedMotion,
    } satisfies GamePreferences);
  }, [muted, preferencesReady, reducedMotion, volume]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const initialReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const quality = deriveQuality(initialReducedMotion);
    const simulation = new GameSimulation({
      width: Math.max(96, rect.width),
      height: Math.max(96, rect.height),
      mode: "daily",
      seed: dailySeed,
      reducedMotion: initialReducedMotion,
    });
    const renderer = new GameRenderer(stage, quality);
    const audio = new AudioEngine();
    simulationRef.current = simulation;
    rendererRef.current = renderer;
    audioRef.current = audio;

    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      const width = Math.max(96, bounds.width);
      const height = Math.max(96, bounds.height);
      const previousWidth = simulation.getWidth();
      const previousHeight = simulation.getHeight();
      const scaleX = width / previousWidth;
      const scaleY = height / previousHeight;
      simulation.resize(width, height);
      inputRef.current.target.x *= scaleX;
      inputRef.current.target.y *= scaleY;
      autoPilotInputRef.current.target.x *= scaleX;
      autoPilotInputRef.current.target.y *= scaleY;
      renderer.resize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    const frame = (now: number) => {
      const last = lastFrameRef.current || now;
      const elapsedMs = Math.min(Math.max(now - last, 0), 100);
      const frameSeconds =
        (elapsedMs / 1000) * (slowMotionRef.current ? 0.35 : 1);
      lastFrameRef.current = now;
      renderAccumulatorRef.current += elapsedMs;
      audioAccumulatorRef.current += elapsedMs;

      if (simulation.getStatus() === "playing" && !pausedRef.current) {
        accumulatorRef.current += frameSeconds;
        let safety = 0;
        while (accumulatorRef.current >= FIXED_STEP && safety < 8) {
          let activeInput = inputRef.current;
          if (autoPilotRef.current) {
            activeInput = creatorAutopilotInput(
              simulation.getRenderSnapshot(),
              autoPilotInputRef.current,
            );
            autoPilotInputRef.current = activeInput;
          }
          const events = simulation.update(FIXED_STEP, activeInput);
          if (events.length) {
            renderer.handleEvents(events);
            audio.handleEvents(events);
          }
          if (!autoPilotRef.current) {
            inputRef.current.justPressed = false;
            inputRef.current.justReleased = false;
          } else {
            autoPilotInputRef.current.justPressed = false;
            autoPilotInputRef.current.justReleased = false;
          }
          accumulatorRef.current -= FIXED_STEP;
          safety += 1;
        }
      }

      const status = simulation.getStatus();
      const statusChanged = status !== lastHudStatusRef.current;
      if (renderAccumulatorRef.current < TARGET_RENDER_MS && !statusChanged) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      renderAccumulatorRef.current = statusChanged
        ? 0
        : renderAccumulatorRef.current % TARGET_RENDER_MS;

      // The live renderer view avoids cloning every entity and trail point.
      // It is consumed synchronously and never retained outside this frame.
      const snapshot = simulation.getRenderSnapshot();
      renderer.render(snapshot, accumulatorRef.current / FIXED_STEP);
      if (audioAccumulatorRef.current >= AUDIO_UPDATE_MS || statusChanged) {
        audioAccumulatorRef.current %= AUDIO_UPDATE_MS;
        audio.update(snapshot);
      }
      const previousHudStatus = lastHudStatusRef.current;
      if (snapshot.status === "results" && previousHudStatus !== "results") {
        const resultKey = `${runSeedRef.current}:${snapshot.tick}:${snapshot.metrics.score}`;
        if (resultKeyRef.current !== resultKey) {
          resultKeyRef.current = resultKey;
          const isCreator = creatorRunRef.current;
          const recorded = isCreator
            ? null
            : historyRef.current?.record(
                runModeRef.current,
                runSeedRef.current,
                Math.max(0, Math.floor(snapshot.metrics.score)),
              ) ?? null;
          const completedResult = createRunResult({
            mode: runModeRef.current,
            seed: runSeedRef.current,
            survivalSeconds: snapshot.elapsed,
            metrics: snapshot.metrics,
            ...(runModeRef.current === "daily" && runSeedRef.current === dailySeed
              ? { challengeNumber: dailyChallengeNumber }
              : {}),
            ...(recorded
              ? {
                  attempt: recorded.attempt,
                  isPersonalBest: recorded.isPersonalBest,
                  personalBest: recorded.personalBest,
                }
              : {}),
            ...(challengerTargetRef.current === null
              ? {}
              : { challengerTarget: challengerTargetRef.current }),
          });
          setResult(completedResult);
          setResultImage(null);
          setShareStatus("ready");
        }
      }
      if (
        (snapshot.tick % 6 === 0 && snapshot.tick !== lastHudTickRef.current) ||
        snapshot.status !== lastHudStatusRef.current
      ) {
        lastHudTickRef.current = snapshot.tick;
        lastHudStatusRef.current = snapshot.status;
        setHud(toHud(snapshot));
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      audio.dispose();
      renderer.dispose();
      simulation.dispose();
      audioRef.current = null;
      rendererRef.current = null;
      simulationRef.current = null;
    };
  }, [dailyChallengeNumber, dailySeed]);

  const startRun = useCallback(
    async (nextMode = mode, options: StartOptions = {}) => {
      const simulation = simulationRef.current;
      if (!simulation) return;
      setMode(nextMode);
      // Audio unlock is best-effort and must never delay the first playable frame.
      void audioRef.current?.unlock();
      audioRef.current?.setMuted(muted);
      const seed = options.seed ?? (nextMode === "daily"
        ? dailySeed
        : (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0);
      const isCreator = options.creator === true;
      runModeRef.current = nextMode;
      runSeedRef.current = seed;
      creatorRunRef.current = isCreator;
      challengerTargetRef.current = options.challengerTarget ?? null;
      resultKeyRef.current = "";
      simulation.start(nextMode, seed);
      if (options.phase !== undefined) {
        simulation.forcePhase(options.phase, options.phaseTick);
      }
      inputRef.current = makeInput();
      autoPilotInputRef.current = makeInput();
      accumulatorRef.current = 0;
      renderAccumulatorRef.current = TARGET_RENDER_MS;
      audioAccumulatorRef.current = AUDIO_UPDATE_MS;
      lastHudTickRef.current = -1;
      lastHudStatusRef.current = "playing";
      setPaused(false);
      setHud(toHud(simulation.getRenderSnapshot()));
      setShowControls(true);
      setResult(null);
      setResultImage(null);
      setShareStatus("ready");
      setCreatorOpen(isCreator);
    },
    [dailySeed, mode, muted],
  );

  useEffect(() => {
    if (challengeStartedRef.current) return;
    const decoded = decodeChallengeUrl(window.location.href);
    if (!decoded) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || challengeStartedRef.current) return;
      challengeStartedRef.current = true;
      challengerTargetRef.current = decoded.target;
      setChallenge(decoded);
      // Challenge links are one-tapless: gameplay begins as soon as the arena
      // is ready. The first actual gesture still unlocks browser audio.
      void startRun(decoded.mode, {
        seed: decoded.seed,
        challengerTarget: decoded.target,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [startRun]);

  const enterCreator = useCallback(() => {
    setAutoPilot(true);
    setCreatorPanelVisible(true);
    setCleanHud(false);
    setSlowMotion(false);
    setCreatorFrame("auto");
    void startRun("daily", {
      seed: SHOWCASE_SEED,
      creator: true,
      phase: 0,
      challengerTarget: null,
    });
  }, [startRun]);

  const jumpToCreatorPhase = useCallback(
    (phaseIndex: number, phaseTick = 0) => {
      const simulation = simulationRef.current;
      if (!simulation || !creatorRunRef.current || hud.status === "results" || hud.status === "menu") {
        void startRun("daily", {
          seed: SHOWCASE_SEED,
          creator: true,
          phase: phaseIndex,
          phaseTick,
          challengerTarget: null,
        });
        return;
      }
      simulation.forcePhase(phaseIndex, phaseTick);
      setPaused(false);
      setResult(null);
      resultKeyRef.current = "";
      setHud(toHud(simulation.getRenderSnapshot()));
    },
    [hud.status, startRun],
  );

  const updatePointerTarget = useCallback((event: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const touchLift = event.pointerType === "touch" ? Math.min(rect.width, rect.height) * 0.11 : 0;
    inputRef.current.target.x = event.clientX - rect.left;
    inputRef.current.target.y = event.clientY - rect.top - touchLift;
    inputRef.current.pointerType =
      event.pointerType === "touch"
        ? "touch"
        : event.pointerType === "pen"
          ? "pen"
          : "mouse";
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      void audioRef.current?.unlock();
      if (hud.status !== "playing" || paused || !event.isPrimary) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      updatePointerTarget(event);
      inputRef.current.active = true;
      inputRef.current.justPressed = true;
      inputRef.current.justReleased = false;
      setShowControls(false);
    },
    [hud.status, paused, updatePointerTarget],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || hud.status !== "playing") return;
      updatePointerTarget(event);
    },
    [hud.status, updatePointerTarget],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || !inputRef.current.active) return;
    updatePointerTarget(event);
    inputRef.current.active = false;
    inputRef.current.justReleased = true;
    inputRef.current.justPressed = false;
  }, [updatePointerTarget]);

  const onPointerCancel = useCallback(() => {
    inputRef.current.active = false;
    inputRef.current.justPressed = false;
    inputRef.current.justReleased = false;
  }, []);

  const clearLatchedInput = useCallback(() => {
    keysRef.current.clear();
    spaceHeldRef.current = false;
    inputRef.current.keyboard.x = 0;
    inputRef.current.keyboard.y = 0;
    inputRef.current.active = false;
    inputRef.current.justPressed = false;
    inputRef.current.justReleased = false;
  }, []);

  useEffect(() => {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      KeyA: [-1, 0],
      ArrowRight: [1, 0],
      KeyD: [1, 0],
      ArrowUp: [0, -1],
      KeyW: [0, -1],
      ArrowDown: [0, 1],
      KeyS: [0, 1],
    };
    const recalculate = () => {
      let x = 0;
      let y = 0;
      for (const key of keysRef.current) {
        const vector = directions[key];
        if (vector) {
          x += vector[0];
          y += vector[1];
        }
      }
      const length = Math.hypot(x, y) || 1;
      inputRef.current.keyboard.x = x / length;
      inputRef.current.keyboard.y = y / length;
      if (x || y) inputRef.current.pointerType = "keyboard";
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && (hud.status === "playing" || hud.status === "paused")) {
        event.preventDefault();
        setPaused((value) => !value);
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      void audioRef.current?.unlock();
      if (event.code === "KeyH" && creatorOpen) {
        if (event.repeat) return;
        event.preventDefault();
        setCreatorPanelVisible((value) => !value);
        return;
      }
      if (event.code === "KeyR" && creatorOpen) {
        if (event.repeat) return;
        event.preventDefault();
        void startRun("daily", {
          seed: SHOWCASE_SEED,
          creator: true,
          phase: 0,
          challengerTarget: null,
        });
        return;
      }
      if (creatorOpen && /^Digit[1-6]$/.test(event.code)) {
        if (event.repeat) return;
        event.preventDefault();
        jumpToCreatorPhase(Number(event.code.slice(-1)) - 1);
        return;
      }
      if (event.code === "KeyC") {
        if (event.repeat) return;
        event.preventDefault();
        if (creatorOpen) setAutoPilot((value) => !value);
        else if (hud.status !== "playing") enterCreator();
        return;
      }
      if (event.code === "Enter" && hud.status !== "playing" && hud.status !== "paused") {
        if (event.repeat) return;
        event.preventDefault();
        if (challenge) {
          void startRun(challenge.mode, {
            seed: challenge.seed,
            challengerTarget: challenge.target,
          });
        } else {
          void startRun(mode, {
            seed: mode === "daily" ? dailySeed : undefined,
            challengerTarget: null,
          });
        }
        return;
      }
      if (event.code === "KeyP" && (hud.status === "playing" || hud.status === "paused")) {
        if (event.repeat) return;
        event.preventDefault();
        setPaused((value) => !value);
        return;
      }
      if (event.code === "KeyM") {
        if (event.repeat) return;
        event.preventDefault();
        setMuted((value) => !value);
        return;
      }
      if (hud.status !== "playing" || paused) return;
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        spaceHeldRef.current = true;
        inputRef.current.active = true;
        inputRef.current.justPressed = true;
        inputRef.current.pointerType = "keyboard";
        setShowControls(false);
        return;
      }
      if (event.code in directions) {
        event.preventDefault();
        keysRef.current.add(event.code);
        recalculate();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && spaceHeldRef.current) {
        event.preventDefault();
        spaceHeldRef.current = false;
        inputRef.current.active = false;
        inputRef.current.justReleased = true;
        inputRef.current.justPressed = false;
      }
      keysRef.current.delete(event.code);
      recalculate();
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [challenge, creatorOpen, dailySeed, enterCreator, hud.status, jumpToCreatorPhase, mode, paused, startRun]);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    audioRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    void generateResultCardBlob(result)
      .then((blob) => {
        if (!cancelled) setResultImage(blob);
      })
      .catch(() => {
        if (!cancelled) setResultImage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    pausedRef.current = paused;
    simulationRef.current?.setPaused(paused);
    if (paused) audioRef.current?.pause();
    else audioRef.current?.resume();
  }, [paused]);

  useEffect(() => {
    rendererRef.current?.setQuality(deriveQuality(reducedMotion));
  }, [reducedMotion]);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      clearLatchedInput();
      if (hud.status === "playing") setPaused(true);
    };
    const onBlur = () => {
      clearLatchedInput();
      if (hud.status === "playing") setPaused(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [clearLatchedInput, hud.status]);

  useEffect(() => {
    const panel = paused
      ? pausePanelRef.current
      : hud.status === "results"
        ? resultPanelRef.current
        : null;
    if (!panel) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableSelector =
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";
    const focusFirst = () => {
      const first = panel.querySelector<HTMLElement>(focusableSelector);
      (first ?? panel).focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(focusFirst);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        panel.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.getClientRects().length > 0);
      if (controls.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trapFocus);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [hud.status, paused]);

  const resultChallengeUrl = useMemo(() => {
    if (!result || creatorOpen) return null;
    try {
      const base = typeof window === "undefined"
        ? undefined
        : `${window.location.origin}${window.location.pathname}`;
      return encodeChallengeUrl(challengeFromResult(result), base);
    } catch {
      return null;
    }
  }, [creatorOpen, result]);

  const ensureResultImage = useCallback(async () => {
    if (!result) return null;
    if (resultImage) return resultImage;
    try {
      const image = await generateResultCardBlob(result);
      setResultImage(image);
      return image;
    } catch {
      return null;
    }
  }, [result, resultImage]);

  const copyCurrentResult = useCallback(async () => {
    if (!result) return;
    const copied = await copyResultText(createShareText(result, resultChallengeUrl ?? undefined));
    setShareStatus(copied ? "copied" : "unavailable");
  }, [result, resultChallengeUrl]);

  const copyChallenge = useCallback(async () => {
    if (!result || !resultChallengeUrl || creatorOpen) return;
    const copied = await copyResultText(createShareText(result, resultChallengeUrl));
    setShareStatus(copied ? "copied" : "unavailable");
  }, [creatorOpen, result, resultChallengeUrl]);

  const downloadCurrentCard = useCallback(async () => {
    const image = await ensureResultImage();
    if (!image || !result) {
      setShareStatus("unavailable");
      return;
    }
    const downloaded = downloadResultCard(
      image,
      `sol-shift-${compactSeed(result.seed)}-${result.score}.png`,
    );
    setShareStatus(downloaded ? "downloaded" : "unavailable");
  }, [ensureResultImage, result]);

  const shareCurrentResult = useCallback(async () => {
    if (!result) return;
    const image = await ensureResultImage();
    const outcome = await shareResult({
      result,
      challengeUrl: creatorOpen ? undefined : resultChallengeUrl ?? undefined,
      image,
      filename: `sol-shift-${compactSeed(result.seed)}-${result.score}.png`,
    });
    setShareStatus(outcome);
  }, [creatorOpen, ensureResultImage, result, resultChallengeUrl]);

  const phase = PHASES[Math.max(0, Math.min(PHASES.length - 1, hud.phaseIndex))];
  const secondsLeft = Math.max(0, Math.ceil(60 - hud.elapsed));
  const displayedTime = mode === "endless"
    ? formatElapsed(hud.elapsed)
    : String(secondsLeft).padStart(2, "0");
  const isMenu = hud.status === "menu";
  const isResult = hud.status === "results";

  return (
    <main className={`game-shell creator-frame-${creatorFrame} ${reducedMotion ? "is-reduced-motion" : ""}`}>
      <div
        ref={stageRef}
        className={`game-stage ${creatorOpen ? "is-creator" : ""} ${isMenu || isResult || paused ? "is-ui" : ""}`}
        data-testid="game-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="SOL SHIFT game arena"
      >
        <div className="grain" aria-hidden="true" />

        {!isMenu && !isResult && !cleanHud && (
          <header className={`hud ${reducedMotion ? "is-reduced" : ""}`}>
            <div className="hud-score">
              <span className="hud-label">SCORE</span>
              <strong>{hud.score.toLocaleString("en-US")}</strong>
              <span className={`combo ${hud.combo > 1 ? "is-live" : ""}`}>
                ×{hud.combo.toFixed(hud.combo < 10 ? 1 : 0)}
              </span>
            </div>
            <div className="hud-phase" aria-live="polite">
              <span className="phase-index">0{hud.phaseIndex + 1}</span>
              <strong>{phase}</strong>
              <span className="phase-rule">
                {PHASE_RULES[hud.phaseIndex]}
              </span>
              <i style={{ transform: `scaleX(${Math.min(1, hud.phaseTime / 10)})` }} />
            </div>
            <div className="hud-time">
              <span className="hud-label">{mode === "endless" ? "TIME" : "SHIFT"}</span>
              <strong>{displayedTime}</strong>
              <span className="stability" aria-label={`${hud.stability} stability remaining`}>
                {[0, 1, 2].map((value) => (
                  <i key={value} className={value < hud.stability ? "is-on" : ""} />
                ))}
              </span>
            </div>
          </header>
        )}

        {challenge && !isMenu && !isResult && !creatorOpen && !cleanHud && (
          <div className="challenge-target" aria-label={`Challenger target ${challenge.target}`}>
            <span>TARGET</span>
            <strong>{challenge.target.toLocaleString("en-US")}</strong>
          </div>
        )}

        {!cleanHud && !paused && !isResult && (
          <div className="utility-controls" onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="icon-button"
              onClick={(event) => {
                event.stopPropagation();
                setMuted((value) => !value);
              }}
              aria-label={muted ? "Unmute audio" : "Mute audio"}
              data-testid="mute-button"
            >
              {muted ? "SOUND OFF" : "SOUND ON"}
            </button>
            {!isMenu && !isResult && (
              <button
                type="button"
                className="icon-button icon-only"
                onClick={(event) => {
                  event.stopPropagation();
                  setPaused((value) => !value);
                }}
                aria-label={paused ? "Resume game" : "Pause game"}
              >
                {paused ? "▶" : "Ⅱ"}
              </button>
            )}
          </div>
        )}

        {showControls && hud.status === "playing" && !paused && !cleanHud && !autoPilot && (
          <div className="control-ghost" aria-hidden="true">
            <span className="gesture-orbit"><i /></span>
            <strong>HOLD · BEND SPACE</strong>
            <small>MOVE · RELEASE NOVA</small>
          </div>
        )}

        {paused && (hud.status === "playing" || hud.status === "paused") && (
          <section
            ref={pausePanelRef}
            className="pause-panel panel"
            role="dialog"
            aria-modal="true"
            aria-label="Game paused"
            tabIndex={-1}
          >
            <span className="eyebrow">FIELD SUSPENDED</span>
            <h2>PAUSED</h2>
            <button className="primary-button" type="button" onClick={() => setPaused(false)}>
              RESUME SHIFT
            </button>
            <label className="volume-control">
              <span>VOLUME</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                aria-label="Game volume"
              />
              <output>{Math.round(volume * 100)}%</output>
            </label>
            <button
              className="text-button"
              type="button"
              onClick={() => setReducedMotion((value) => !value)}
            >
              MOTION {reducedMotion ? "REDUCED" : "FULL"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setMuted((value) => !value)}
            >
              SOUND {muted ? "OFF" : "ON"}
            </button>
          </section>
        )}

        {isMenu && (
          <section className="menu-panel" aria-labelledby="game-title">
            <div className="brand-lockup">
              <span className="brand-kicker"><i /> PHYSICS SURVIVAL // 60 SECONDS</span>
              <h1 id="game-title">SOL<span>{"//"}</span>SHIFT</h1>
              <p>Survive while the laws of physics mutate around you.</p>
            </div>

            <div className="mode-card">
              <div className="mode-meta">
                <span className="eyebrow">
                  {challenge ? "CHALLENGE RECEIVED" : `DAILY SHIFT // #${dailyChallengeNumber}`}
                </span>
                <span className="seed">#{compactSeed(challenge?.seed ?? dailySeed)}</span>
              </div>
              {challenge ? (
                <>
                  <h2>BEAT {challenge.target.toLocaleString("en-US")}</h2>
                  <p>
                    {challenge.archetype ? `${challenge.archetype} left this universe for you.` : "A challenger left this universe for you."}
                    {" "}Same seed. Same laws. Your move.
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    data-testid="start-challenge"
                    onClick={() => void startRun(challenge.mode, {
                      seed: challenge.seed,
                      challengerTarget: challenge.target,
                    })}
                  >
                    <span>CHASE THE SIGNAL</span>
                    <i>↗</i>
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      challengerTargetRef.current = null;
                      setChallenge(null);
                    }}
                  >
                    TODAY&apos;S DAILY SHIFT
                  </button>
                </>
              ) : (
                <>
                  <h2>DAILY SHIFT</h2>
                  <p>Same six laws. Same seed. Everyone gets one universe—and unlimited attempts.</p>
                  <button
                    className="primary-button"
                    type="button"
                    data-testid="start-daily"
                    onClick={() => void startRun("daily", {
                      seed: dailySeed,
                      challengerTarget: null,
                    })}
                  >
                    <span>ENTER THE FIELD</span>
                    <i>↗</i>
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void startRun("endless", { challengerTarget: null })}
                  >
                    ENDLESS SHIFT <span>∞</span>
                  </button>
                </>
              )}
              <button className="creator-entry" type="button" onClick={enterCreator}>
                CREATOR MODE <span>REC</span>
              </button>
            </div>

            <div className="menu-controls" aria-label="Controls">
              <span><b>MOVE</b> pointer · touch · WASD</span>
              <span><b>HOLD</b> attract</span>
              <span><b>RELEASE</b> Nova</span>
            </div>
          </section>
        )}

        {creatorOpen && !isMenu && !isResult && creatorPanelVisible && (
          <aside
            className="creator-panel"
            data-testid="creator-panel"
            aria-label="Creator Mode controls"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="creator-heading">
              <span><i /> CREATOR MODE</span>
              <b>SHOWCASE · UNRANKED</b>
            </div>
            <label>
              <span>LAW</span>
              <select
                value={hud.phaseIndex}
                data-testid="creator-phase"
                onChange={(event) => jumpToCreatorPhase(Number(event.target.value))}
              >
                {PHASES.map((name, index) => (
                  <option key={name} value={index}>0{index + 1} · {name}</option>
                ))}
              </select>
            </label>
            <div className="creator-toggle-grid">
              <button
                type="button"
                className={autoPilot ? "is-on" : ""}
                onClick={() => setAutoPilot((value) => !value)}
              >
                AUTO {autoPilot ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                className={slowMotion ? "is-on" : ""}
                onClick={() => setSlowMotion((value) => !value)}
              >
                SLOW {slowMotion ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                className={cleanHud ? "is-on" : ""}
                onClick={() => setCleanHud((value) => !value)}
              >
                HUD {cleanHud ? "CLEAN" : "FULL"}
              </button>
            </div>
            <label>
              <span>FRAME</span>
              <select
                value={creatorFrame}
                onChange={(event) => setCreatorFrame(event.target.value as CreatorFrame)}
              >
                <option value="auto">NATIVE</option>
                <option value="landscape">16:9</option>
                <option value="portrait">9:16</option>
              </select>
            </label>
            <div className="creator-scenarios">
              <button type="button" onClick={() => jumpToCreatorPhase(1, 145)}>FRACTURE CHAIN</button>
              <button type="button" onClick={() => jumpToCreatorPhase(1, 545)}>FLOW TRANSITION</button>
              <button type="button" onClick={() => jumpToCreatorPhase(3, 120)}>ECHO CROSSING</button>
              <button type="button" onClick={() => jumpToCreatorPhase(5, 300)}>FINAL NOVA</button>
            </div>
            <button
              className="creator-hide"
              type="button"
              onClick={() => setCreatorPanelVisible(false)}
            >
              HIDE CONTROLS · H
            </button>
            <small>1–6 phase · R restart · C auto · H controls</small>
          </aside>
        )}

        {isResult && (
          <section
            ref={resultPanelRef}
            className="result-panel panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
            data-testid="result-screen"
            tabIndex={-1}
          >
            <span className="eyebrow">
              {creatorOpen ? "SHOWCASE · UNRANKED" : "SHIFT TERMINATED"}{" // #"}{compactSeed(result?.seed ?? hud.seed)}
            </span>
            <h2 id="result-title">
              {creatorOpen
                ? hud.runComplete ? "SHOWCASE COMPLETE" : "SHOWCASE ENDED"
                : hud.runComplete ? "SURVIVED" : "CORE COLLAPSED"}
            </h2>
            <div className="result-score">
              <span>FINAL SCORE</span>
              <strong>{(result?.score ?? hud.score).toLocaleString("en-US")}</strong>
            </div>
            <div className="result-identity">
              <strong>{result?.archetype ?? "Orbit Architect"}</strong>
              <span>{(result?.survivalSeconds ?? hud.elapsed).toFixed(1)}s · BEST COMBO {result?.bestCombo ?? 0}</span>
            </div>
            <div className="shift-signature" aria-label={`Shift Signature ${result?.signature ?? "pending"}`}>
              {(result?.phaseGrades ?? [0, 0, 0, 0, 0, 0]).map((grade, index) => (
                <span key={PHASE_CODES[index]} className={grade >= 4 ? "is-hot" : ""}>
                  <b>{PHASE_CODES[index]}</b>
                  <i>{grade}</i>
                </span>
              ))}
            </div>
            <p className="result-note">
              {resultStatus(result, hud.deathReason)}
            </p>
            <div className="result-actions">
              <button
                className="primary-button"
                data-testid="retry-button"
                type="button"
                onClick={() => void startRun(result?.mode ?? mode, {
                  seed: creatorOpen ? SHOWCASE_SEED : result?.seed,
                  creator: creatorOpen,
                  challengerTarget: creatorOpen ? null : result?.challengerTarget ?? null,
                })}
              >
                <span>{creatorOpen ? "RECORD AGAIN" : "SHIFT AGAIN"}</span><i>↗</i>
              </button>
              {!creatorOpen && (
                <div className="share-actions">
                  <button type="button" onClick={() => void copyChallenge()} disabled={!resultChallengeUrl}>
                    CHALLENGE A FRIEND
                  </button>
                  <button type="button" onClick={() => void copyCurrentResult()}>COPY RESULT</button>
                  <button type="button" onClick={() => void downloadCurrentCard()} disabled={!result}>
                    {resultImage ? "DOWNLOAD CARD" : "PREPARING CARD"}
                  </button>
                  <button type="button" onClick={() => void shareCurrentResult()}>SHARE</button>
                </div>
              )}
              {shareStatus !== "ready" && !creatorOpen && (
                <output className="share-status" aria-live="polite">{shareStatus.replace("-", " ").toUpperCase()}</output>
              )}
              {creatorOpen && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setCreatorPanelVisible(true);
                    jumpToCreatorPhase(0);
                  }}
                >
                  RETURN TO CREATOR CONTROLS
                </button>
              )}
              <button
                className="text-button"
                type="button"
                onClick={() => setMuted((value) => !value)}
              >
                SOUND {muted ? "OFF" : "ON"}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  window.location.href = window.location.pathname;
                }}
              >
                MAIN FIELD
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
