import type { GameEvent, GameSnapshot } from "./types";

const BPM = 96;
const BEAT_SECONDS = 60 / BPM;
const BEATS_PER_PHASE = 16;
const PHASE_SECONDS = BEAT_SECONDS * BEATS_PER_PHASE;
const MAX_SCHEDULED_VOICES = 36;
const MUSIC_LOOKAHEAD_SECONDS = 0.24;
const SILENCE = 0.0001;

type VoiceGroup = "music" | "sfx";

interface VoiceRecord {
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
  group: VoiceGroup;
  endsAt: number;
}

interface PhaseScore {
  root: number;
  interval: number;
  cutoff: number;
  resonance: number;
  bed: number;
  pulse: number;
  accent: number;
  bass: readonly number[];
  melody: readonly number[];
  waveform: OscillatorType;
}

interface ToneOptions {
  frequency: number;
  endFrequency?: number;
  duration: number;
  gain: number;
  when?: number;
  attack?: number;
  waveform?: OscillatorType;
  pan?: number;
  filterFrequency?: number;
  destination?: AudioNode;
  group?: VoiceGroup;
}

interface NoiseOptions {
  duration: number;
  gain: number;
  when?: number;
  attack?: number;
  pan?: number;
  playbackRate?: number;
  filterType?: BiquadFilterType;
  filterFrequency?: number;
  endFilterFrequency?: number;
  resonance?: number;
  destination?: AudioNode;
  group?: VoiceGroup;
}

type AudioContextConstructor = new (
  contextOptions?: AudioContextOptions,
) => AudioContext;

// Each phase keeps the same pulse while changing interval colour, density and
// register. The arrays cover one exact 10-second / 16-beat law phase.
const PHASE_SCORES: readonly PhaseScore[] = [
  {
    root: 45,
    interval: 7,
    cutoff: 2800,
    resonance: 0.7,
    bed: 0.16,
    pulse: 0.4,
    accent: 0.31,
    bass: [0, 0, 7, 0, 3, 0, 7, 10, 0, 0, 7, 0, 3, 7, 10, 7],
    melody: [12, -1, 15, -1, 19, -1, 15, 22, 12, -1, 19, -1, 15, 22, 19, 15],
    waveform: "triangle",
  },
  {
    root: 42,
    interval: 6,
    cutoff: 3900,
    resonance: 2.4,
    bed: 0.11,
    pulse: 0.5,
    accent: 0.38,
    bass: [0, 1, 0, 6, 0, 1, 10, 6, 0, 1, 0, 7, 6, 1, 10, 7],
    melody: [18, -1, 13, 19, -1, 22, 13, -1, 18, 19, -1, 13, 22, -1, 19, 25],
    waveform: "sawtooth",
  },
  {
    root: 38,
    interval: 9,
    cutoff: 2200,
    resonance: 0.5,
    bed: 0.19,
    pulse: 0.32,
    accent: 0.28,
    bass: [0, 0, 5, 0, 9, 0, 7, 5, 0, 2, 5, 0, 9, 7, 5, 2],
    melody: [14, -1, -1, 17, 21, -1, 19, -1, 14, 17, -1, 21, 24, -1, 19, 17],
    waveform: "sine",
  },
  {
    root: 36,
    interval: 8,
    cutoff: 3300,
    resonance: 1.3,
    bed: 0.15,
    pulse: 0.36,
    accent: 0.34,
    bass: [0, 0, 8, 0, 3, 0, 10, 8, 0, 3, 8, 0, 10, 8, 3, 5],
    melody: [15, -1, 20, -1, 22, -1, 20, -1, 15, -1, 20, 22, -1, 24, 22, 20],
    waveform: "triangle",
  },
  {
    root: 43,
    interval: 11,
    cutoff: 5100,
    resonance: 1.8,
    bed: 0.1,
    pulse: 0.48,
    accent: 0.4,
    bass: [0, 7, 0, 4, 0, 11, 7, 4, 0, 7, 4, 0, 11, 7, 4, 2],
    melody: [16, 14, 19, -1, 23, 19, 16, -1, 14, 16, 19, 23, 26, 23, 19, 16],
    waveform: "square",
  },
  {
    root: 45,
    interval: 12,
    cutoff: 6800,
    resonance: 0.8,
    bed: 0.21,
    pulse: 0.47,
    accent: 0.45,
    bass: [0, 7, 9, 7, 4, 7, 12, 9, 0, 7, 9, 12, 4, 9, 12, 16],
    melody: [16, 19, 21, 23, 21, 24, 28, 24, 19, 21, 24, 28, 31, 28, 24, 33],
    waveform: "sawtooth",
  },
] as const;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function safeStop(source: AudioScheduledSourceNode, when?: number): void {
  try {
    source.stop(when);
  } catch {
    // A source may already have ended or been stopped during a run reset.
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Disconnect is deliberately idempotent during disposal.
  }
}

/**
 * One-lifetime procedural Web Audio score for SOL//SHIFT.
 *
 * Call unlock() directly from a pointer/key gesture. All other methods are
 * safe before unlock and in SSR/non-Web-Audio environments.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private unlockInFlight: Promise<void> | null = null;
  private unavailable = false;
  private disposed = false;

  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;

  private bedLayer: GainNode | null = null;
  private pulseLayer: GainNode | null = null;
  private accentLayer: GainNode | null = null;
  private phaseFilter: BiquadFilterNode | null = null;
  private energyFilter: BiquadFilterNode | null = null;
  private reactiveGain: GainNode | null = null;
  private musicDuck: GainNode | null = null;

  private bedOscillatorA: OscillatorNode | null = null;
  private bedOscillatorB: OscillatorNode | null = null;
  private bedGainA: GainNode | null = null;
  private bedGainB: GainNode | null = null;

  private attractionOscillator: OscillatorNode | null = null;
  private attractionNoise: AudioBufferSourceNode | null = null;
  private attractionGain: GainNode | null = null;
  private attractionFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private readonly lifetimeNodes: AudioNode[] = [];
  private readonly persistentSources: AudioScheduledSourceNode[] = [];
  private readonly voices: VoiceRecord[] = [];

  private muted = false;
  private volume = 0.78;
  private phaseIndex = 0;
  private appliedPhase = -1;
  private pendingPhaseTransition = 0.65;
  private comboEnergy = 0;

  private manualPaused = false;
  private snapshotPaused = false;
  private hidden = false;
  private contextTarget: "running" | "suspended" | null = null;
  private listeningForVisibility = false;

  private lastStatus: GameSnapshot["status"] | null = null;
  private appliedTransportStatus: GameSnapshot["status"] | null = null;
  private lastTick = -1;
  private lastElapsed = 0;
  private scheduledPhase = -1;
  private scheduledCycle = -1;
  private nextBeat = -1;
  private phaseAudioOrigin = 0;
  private playbackRate = 1;
  private spatialWidth = 1;
  private coreX = 0.5;

  private readonly handleVisibilityChange = (): void => {
    if (typeof document === "undefined") return;
    this.hidden = document.visibilityState === "hidden";
    this.syncContextState(true);
  };

  public unlock(): Promise<void> {
    if (this.disposed || this.unavailable) return Promise.resolve();

    // A second real gesture is useful on browsers that rejected the first
    // resume, so an existing context is explicitly retried.
    if (this.context) return this.resumeFromGesture();
    if (this.unlockInFlight) return this.unlockInFlight;

    this.unlockInFlight = this.createAndUnlock().finally(() => {
      this.unlockInFlight = null;
    });
    return this.unlockInFlight;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterVolume();
  }

  public setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = clamp(volume);
    this.applyMasterVolume();
  }

  public setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const next = clamp(rate, 0.25, 1);
    if (Math.abs(next - this.playbackRate) < 0.001) return;
    this.playbackRate = next;
    this.stopVoices("music");
    this.scheduledPhase = -1;
    this.scheduledCycle = -1;
    this.nextBeat = -1;
  }

  public setPhase(index: number, transition = 0.65): void {
    if (!Number.isFinite(index)) return;
    const nextPhase = Math.round(clamp(index, 0, PHASE_SCORES.length - 1));
    const changed = nextPhase !== this.phaseIndex;
    this.phaseIndex = nextPhase;
    this.pendingPhaseTransition = Number.isFinite(transition)
      ? clamp(transition, 0.08, 2.5)
      : 0.65;

    if (changed) {
      this.stopVoices("music");
      this.scheduledPhase = -1;
      this.nextBeat = -1;
    }

    if (this.context && (changed || this.appliedPhase !== nextPhase)) {
      this.applyPhaseMorph(nextPhase, this.pendingPhaseTransition);
    }
  }

  public handleEvents(events: readonly GameEvent[]): void {
    if (!this.canMakeSound()) return;

    for (const event of events) {
      switch (event.type) {
        case "phase":
          this.setPhase(event.phaseIndex, 0.72);
          this.playPhaseShift(event.phaseIndex);
          break;
        case "charge-start":
          this.playChargeStart();
          break;
        case "nova":
          this.playNova(event.strength, event.captured, event.x);
          break;
        case "collect":
          this.playCollect(event.value, event.combo, event.x);
          break;
        case "gate":
          this.playGate(event.value, event.x);
          break;
        case "fracture":
          this.playFracture(event.chain, event.strength, event.x);
          break;
        case "near-miss":
          this.playNearMiss(event.x);
          break;
        case "hit":
          this.playHit(event.stability, event.x);
          break;
        case "complete":
          this.playComplete(event.score);
          break;
        case "game-over":
          this.playGameOver(event.score);
          break;
      }
    }
  }

  public update(snapshot: GameSnapshot): void {
    this.spatialWidth = Math.max(1, snapshot.width);
    this.coreX = snapshot.core.x;
    this.setPhase(
      snapshot.phaseIndex,
      snapshot.phaseTransition > 0 ? 0.3 + snapshot.phaseTransition * 0.55 : 0.4,
    );

    const isSnapshotPaused = snapshot.status === "paused";
    if (isSnapshotPaused !== this.snapshotPaused) {
      this.snapshotPaused = isSnapshotPaused;
      this.syncContextState(true);
    }

    const context = this.context;
    if (!context || this.disposed) {
      this.lastStatus = snapshot.status;
      this.lastTick = snapshot.tick;
      this.lastElapsed = snapshot.elapsed;
      return;
    }

    const startingRun =
      snapshot.status === "playing" &&
      (this.lastStatus !== "playing" || snapshot.tick < this.lastTick);
    if (startingRun) this.beginRun(snapshot);

    this.updateTransportLevel(snapshot.status);
    this.updateReactiveLayers(snapshot);

    if (
      snapshot.status === "playing" &&
      context.state === "running" &&
      !this.manualPaused &&
      !this.hidden
    ) {
      this.scheduleMusic(snapshot);
    }

    this.lastStatus = snapshot.status;
    this.lastTick = snapshot.tick;
    this.lastElapsed = snapshot.elapsed;
  }

  public pause(): void {
    this.manualPaused = true;
    this.syncContextState(true);
  }

  public resume(): void {
    this.manualPaused = false;
    this.syncContextState(true);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.listeningForVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      this.listeningForVisibility = false;
    }

    this.stopVoices();
    for (const source of this.persistentSources) {
      source.onended = null;
      safeStop(source);
      safeDisconnect(source);
    }
    this.persistentSources.length = 0;

    for (const node of this.lifetimeNodes) safeDisconnect(node);
    this.lifetimeNodes.length = 0;

    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }

    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.noiseBuffer = null;
  }

  private async createAndUnlock(): Promise<void> {
    if (typeof window === "undefined") {
      this.unavailable = true;
      return;
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: AudioContextConstructor })
        .webkitAudioContext;
    if (!AudioContextClass) {
      this.unavailable = true;
      return;
    }

    let context: AudioContext;
    try {
      context = new AudioContextClass({ latencyHint: "interactive" });
      this.context = context;
      this.buildLifetimeGraph(context);
    } catch {
      this.unavailable = true;
      if (this.context && this.context.state !== "closed") {
        void this.context.close().catch(() => undefined);
      }
      this.context = null;
      return;
    }

    if (typeof document !== "undefined") {
      this.hidden = document.visibilityState === "hidden";
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      this.listeningForVisibility = true;
    }

    await this.resumeFromGesture();
    this.primeAudioPipeline();
  }

  private async resumeFromGesture(): Promise<void> {
    const context = this.context;
    if (
      !context ||
      context.state === "closed" ||
      this.manualPaused ||
      this.snapshotPaused ||
      this.hidden
    ) {
      return;
    }

    try {
      if (context.state !== "running") await context.resume();
      this.contextTarget = "running";
    } catch {
      // Autoplay policy can still reject unusual synthetic gestures. A later
      // unlock() call retries the same context instead of allocating another.
      this.contextTarget = null;
    }
  }

  private buildLifetimeGraph(context: AudioContext): void {
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.18;

    const master = context.createGain();
    const musicBus = context.createGain();
    const sfxBus = context.createGain();
    const bedLayer = context.createGain();
    const pulseLayer = context.createGain();
    const accentLayer = context.createGain();
    const phaseFilter = context.createBiquadFilter();
    const energyFilter = context.createBiquadFilter();
    const reactiveGain = context.createGain();
    const musicDuck = context.createGain();

    master.gain.value = 0;
    musicBus.gain.value = 0.08;
    sfxBus.gain.value = 0.78;
    phaseFilter.type = "lowpass";
    energyFilter.type = "lowpass";
    energyFilter.frequency.value = 5400;
    energyFilter.Q.value = 0.35;
    reactiveGain.gain.value = 0.9;
    musicDuck.gain.value = 1;

    bedLayer.connect(phaseFilter);
    pulseLayer.connect(phaseFilter);
    accentLayer.connect(phaseFilter);
    phaseFilter.connect(energyFilter);
    energyFilter.connect(reactiveGain);
    reactiveGain.connect(musicDuck);
    musicDuck.connect(musicBus);
    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(limiter);
    limiter.connect(context.destination);

    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.limiter = limiter;
    this.bedLayer = bedLayer;
    this.pulseLayer = pulseLayer;
    this.accentLayer = accentLayer;
    this.phaseFilter = phaseFilter;
    this.energyFilter = energyFilter;
    this.reactiveGain = reactiveGain;
    this.musicDuck = musicDuck;

    this.lifetimeNodes.push(
      limiter,
      master,
      musicBus,
      sfxBus,
      bedLayer,
      pulseLayer,
      accentLayer,
      phaseFilter,
      energyFilter,
      reactiveGain,
      musicDuck,
    );

    this.createDroneBed(context);
    this.createAttractionTexture(context);
    this.noiseBuffer = this.createNoiseBuffer(context, 2);
    this.applyMasterVolume(true);
    this.applyPhaseMorph(this.phaseIndex, 0.02);
  }

  private createDroneBed(context: AudioContext): void {
    if (!this.bedLayer) return;

    const oscillatorA = context.createOscillator();
    const oscillatorB = context.createOscillator();
    const gainA = context.createGain();
    const gainB = context.createGain();
    oscillatorA.type = "sine";
    oscillatorB.type = "triangle";
    gainA.gain.value = 0;
    gainB.gain.value = 0;

    oscillatorA.connect(gainA);
    oscillatorB.connect(gainB);
    gainA.connect(this.bedLayer);
    gainB.connect(this.bedLayer);
    oscillatorA.start();
    oscillatorB.start();

    this.bedOscillatorA = oscillatorA;
    this.bedOscillatorB = oscillatorB;
    this.bedGainA = gainA;
    this.bedGainB = gainB;
    this.persistentSources.push(oscillatorA, oscillatorB);
    this.lifetimeNodes.push(oscillatorA, oscillatorB, gainA, gainB);
  }

  private createAttractionTexture(context: AudioContext): void {
    if (!this.sfxBus) return;

    const oscillator = context.createOscillator();
    const oscillatorTrim = context.createGain();
    const noise = context.createBufferSource();
    const noiseTrim = context.createGain();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 86;
    oscillatorTrim.gain.value = 0.68;
    noiseTrim.gain.value = 0.22;
    filter.type = "bandpass";
    filter.frequency.value = 620;
    filter.Q.value = 1.4;
    gain.gain.value = 0;

    noise.buffer = this.createNoiseBuffer(context, 1.5);
    noise.loop = true;
    noise.playbackRate.value = 0.72;

    oscillator.connect(oscillatorTrim);
    oscillatorTrim.connect(filter);
    noise.connect(noiseTrim);
    noiseTrim.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    oscillator.start();
    noise.start();

    this.attractionOscillator = oscillator;
    this.attractionNoise = noise;
    this.attractionFilter = filter;
    this.attractionGain = gain;
    this.persistentSources.push(oscillator, noise);
    this.lifetimeNodes.push(
      oscillator,
      oscillatorTrim,
      noise,
      noiseTrim,
      filter,
      gain,
    );
  }

  private createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 0x51f15e;
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const white = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      // A touch of correlation avoids a brittle, purely digital noise floor.
      previous = previous * 0.18 + white * 0.82;
      samples[index] = previous;
    }
    return buffer;
  }

  private primeAudioPipeline(): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== "running") return;

    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(master);
    source.onended = () => safeDisconnect(source);
    source.start();
  }

  private applyMasterVolume(immediate = false): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const now = context.currentTime;
    const target = this.muted ? 0 : 0.86 * this.volume ** 1.6;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    if (immediate) master.gain.setValueAtTime(target, now);
    else master.gain.linearRampToValueAtTime(target, now + 0.035);
  }

  private applyPhaseMorph(index: number, duration: number): void {
    const context = this.context;
    const score = PHASE_SCORES[index];
    if (
      !context ||
      !score ||
      !this.bedOscillatorA ||
      !this.bedOscillatorB ||
      !this.bedGainA ||
      !this.bedGainB ||
      !this.bedLayer ||
      !this.pulseLayer ||
      !this.accentLayer ||
      !this.phaseFilter
    ) {
      return;
    }

    const now = context.currentTime;
    const end = now + Math.max(0.02, duration);
    const root = midiToFrequency(score.root - 12);
    this.rampExponential(this.bedOscillatorA.frequency, root, now, end);
    this.rampExponential(
      this.bedOscillatorB.frequency,
      root * 2 ** (score.interval / 12),
      now,
      end,
    );
    this.rampLinear(this.bedGainA.gain, 0.09, now, end);
    this.rampLinear(this.bedGainB.gain, 0.045, now, end);
    this.rampLinear(this.bedLayer.gain, score.bed, now, end);
    this.rampLinear(this.pulseLayer.gain, score.pulse, now, end);
    this.rampLinear(this.accentLayer.gain, score.accent, now, end);
    this.rampExponential(this.phaseFilter.frequency, score.cutoff, now, end);
    this.rampLinear(this.phaseFilter.Q, score.resonance, now, end);
    this.appliedPhase = index;
  }

  private rampLinear(
    parameter: AudioParam,
    target: number,
    now: number,
    end: number,
  ): void {
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
    parameter.linearRampToValueAtTime(target, end);
  }

  private rampExponential(
    parameter: AudioParam,
    target: number,
    now: number,
    end: number,
  ): void {
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(Math.max(SILENCE, parameter.value), now);
    parameter.exponentialRampToValueAtTime(Math.max(SILENCE, target), end);
  }

  private targetParameter(
    parameter: AudioParam | null | undefined,
    target: number,
    now: number,
    timeConstant: number,
  ): void {
    if (!parameter) return;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
    parameter.setTargetAtTime(target, now, timeConstant);
  }

  private beginRun(snapshot: GameSnapshot): void {
    this.stopVoices("music");
    this.scheduledPhase = -1;
    this.scheduledCycle = -1;
    this.nextBeat = -1;
    this.comboEnergy = 0;
    if (this.context) {
      this.phaseAudioOrigin =
        this.context.currentTime - snapshot.phaseTime / this.playbackRate;
    }
  }

  private updateTransportLevel(status: GameSnapshot["status"]): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus) return;
    if (status === this.appliedTransportStatus) return;

    const target = status === "playing" ? 0.43 : status === "paused" ? 0.3 : 0.075;
    this.targetParameter(
      bus.gain,
      target,
      context.currentTime,
      status === "playing" ? 0.12 : 0.28,
    );
    this.appliedTransportStatus = status;
  }

  private updateReactiveLayers(snapshot: GameSnapshot): void {
    const context = this.context;
    if (!context) return;

    const now = context.currentTime;
    const elapsedDelta = clamp(snapshot.elapsed - this.lastElapsed, 0, 0.1);
    const comboTarget = clamp((snapshot.metrics.combo - 1) / 13);
    const smoothing = 1 - Math.exp(-Math.max(1 / 60, elapsedDelta) * 7);
    this.comboEnergy += (comboTarget - this.comboEnergy) * smoothing;

    this.targetParameter(
      this.reactiveGain?.gain,
      0.88 + this.comboEnergy * 0.25,
      now,
      0.07,
    );
    this.targetParameter(
      this.energyFilter?.frequency,
      4600 + this.comboEnergy * 5200,
      now,
      0.08,
    );

    let captured = 0;
    for (const entity of snapshot.entities) {
      if (entity.captured) captured += 1;
    }
    const charge = snapshot.status === "playing" ? clamp(snapshot.core.charge) : 0;
    const attractionLevel =
      charge <= 0.01 ? 0 : (0.016 + charge ** 1.35 * 0.1) * (1 + Math.min(8, captured) * 0.035);
    this.targetParameter(this.attractionGain?.gain, attractionLevel, now, 0.035);
    this.targetParameter(
      this.attractionOscillator?.frequency,
      76 + charge * 128 + captured * 2.5,
      now,
      0.025,
    );
    this.targetParameter(
      this.attractionFilter?.frequency,
      520 + charge * 2450 + captured * 45,
      now,
      0.045,
    );
  }

  private scheduleMusic(snapshot: GameSnapshot): void {
    const context = this.context;
    if (!context) return;

    const phaseTime = clamp(snapshot.phaseTime, 0, PHASE_SECONDS);
    const transportChanged =
      this.scheduledPhase !== snapshot.phaseIndex ||
      this.scheduledCycle !== snapshot.cycle ||
      this.nextBeat < 0;

    if (transportChanged) {
      this.stopVoices("music");
      this.scheduledPhase = snapshot.phaseIndex;
      this.scheduledCycle = snapshot.cycle;
      this.phaseAudioOrigin = context.currentTime - phaseTime / this.playbackRate;
      const beatPosition = phaseTime / BEAT_SECONDS;
      this.nextBeat =
        beatPosition < 0.055 ? 0 : Math.max(0, Math.ceil(beatPosition - 0.025));
    }

    const expectedNow = this.phaseAudioOrigin + phaseTime / this.playbackRate;
    if (Math.abs(expectedNow - context.currentTime) > 0.18) {
      this.stopVoices("music");
      this.phaseAudioOrigin = context.currentTime - phaseTime / this.playbackRate;
      this.nextBeat = Math.max(0, Math.ceil(phaseTime / BEAT_SECONDS - 0.025));
    }

    while (this.nextBeat < BEATS_PER_PHASE) {
      const beatTime = this.nextBeat * BEAT_SECONDS;
      const delay = (beatTime - phaseTime) / this.playbackRate;
      if (delay > MUSIC_LOOKAHEAD_SECONDS) break;

      if (delay >= -0.075) {
        const when = context.currentTime + Math.max(0.004, delay);
        this.scheduleMusicBeat(this.nextBeat, when, snapshot.cycle);
      }
      this.nextBeat += 1;
    }
  }

  private scheduleMusicBeat(beat: number, when: number, cycle: number): void {
    const score = PHASE_SCORES[this.phaseIndex];
    const bassOffset = score.bass[beat % score.bass.length] ?? 0;
    const melodyOffset = score.melody[beat % score.melody.length] ?? -1;
    const cycleLift = cycle % 3 === 2 && beat >= 12 ? 12 : 0;
    const bassFrequency = midiToFrequency(score.root + bassOffset - 12);
    const accent = beat % 4 === 0 ? 1.25 : beat % 2 === 0 ? 1.05 : 0.82;

    this.playTone({
      frequency: bassFrequency,
      endFrequency: bassFrequency * 0.992,
      duration: Math.min(1.8, Math.min(0.52, BEAT_SECONDS * 0.78) / this.playbackRate),
      gain: 0.105 * accent * (1 + this.comboEnergy * 0.16),
      when,
      attack: 0.008,
      waveform: score.waveform,
      filterFrequency: 680 + this.phaseIndex * 180 + this.comboEnergy * 700,
      destination: this.pulseLayer ?? undefined,
      group: "music",
    });

    if (melodyOffset >= 0 && (beat % 2 === 0 || this.phaseIndex >= 3)) {
      const melodyFrequency = midiToFrequency(
        score.root + melodyOffset + cycleLift,
      );
      this.playTone({
        frequency: melodyFrequency,
        endFrequency: melodyFrequency * (this.phaseIndex === 1 ? 1.012 : 1.002),
        duration: Math.min(
          2,
          (this.phaseIndex === 2 ? 0.72 : 0.34) / this.playbackRate,
        ),
        gain: 0.052 + this.comboEnergy * 0.028,
        when: when + 0.018,
        attack: this.phaseIndex === 2 ? 0.08 : 0.012,
        waveform: this.phaseIndex === 5 ? "sawtooth" : "sine",
        pan: ((beat * 5 + this.phaseIndex * 3) % 11) / 10 - 0.5,
        filterFrequency: 2600 + this.phaseIndex * 520 + this.comboEnergy * 1800,
        destination: this.accentLayer ?? undefined,
        group: "music",
      });
    }

    // FRACTURE and SWARM add a restrained off-beat, making their material
    // behaviour audible without changing the shared input rhythm.
    if ((this.phaseIndex === 1 || this.phaseIndex === 4) && beat % 2 === 0) {
      const offbeatFrequency = midiToFrequency(
        score.root + (this.phaseIndex === 1 ? 18 : 23),
      );
      this.playTone({
        frequency: offbeatFrequency,
        duration: 0.105 / this.playbackRate,
        gain: 0.035 + this.comboEnergy * 0.02,
        when: when + (BEAT_SECONDS * 0.5) / this.playbackRate,
        attack: 0.003,
        waveform: this.phaseIndex === 1 ? "square" : "sawtooth",
        pan: beat % 4 === 0 ? -0.42 : 0.42,
        filterFrequency: 4200,
        destination: this.accentLayer ?? undefined,
        group: "music",
      });
    }
  }

  private playChargeStart(): void {
    const root = midiToFrequency(PHASE_SCORES[this.phaseIndex].root + 12);
    this.playTone({
      frequency: root,
      endFrequency: root * 1.18,
      duration: 0.095,
      gain: 0.055,
      attack: 0.004,
      waveform: "sine",
      filterFrequency: 2400,
    });
  }

  private playPhaseShift(index: number): void {
    const context = this.context;
    if (!context) return;
    const root = midiToFrequency(PHASE_SCORES[index]?.root ?? 45);
    const now = context.currentTime + 0.004;
    this.playNoise({
      duration: 0.46,
      gain: 0.08,
      when: now,
      attack: 0.025,
      filterType: "bandpass",
      filterFrequency: 420,
      endFilterFrequency: 4200,
      resonance: 1.2,
    });
    this.playTone({
      frequency: root * 0.5,
      endFrequency: root,
      duration: 0.48,
      gain: 0.09,
      when: now,
      attack: 0.035,
      waveform: "sine",
    });
  }

  private playCollect(value: number, combo: number, x: number): void {
    const comboStep = Math.min(12, Math.max(0, combo - 1));
    const scale = [0, 3, 7, 10, 12, 15, 19];
    const offset = scale[comboStep % scale.length] + Math.floor(comboStep / 7) * 12;
    const root = PHASE_SCORES[this.phaseIndex].root;
    const frequency = midiToFrequency(root + 24 + offset);
    const pan = this.panFor(x);
    this.playTone({
      frequency,
      endFrequency: frequency * 1.006,
      duration: 0.12 + Math.min(0.1, Math.max(0, value) * 0.002),
      gain: 0.055 + Math.min(0.055, comboStep * 0.0045),
      attack: 0.003,
      waveform: combo >= 8 ? "triangle" : "sine",
      pan,
      filterFrequency: 3600 + comboStep * 280,
    });

    if (combo > 0 && combo % 5 === 0) {
      this.playTone({
        frequency: frequency * 1.5,
        duration: 0.18,
        gain: 0.038,
        when: (this.context?.currentTime ?? 0) + 0.035,
        attack: 0.008,
        waveform: "sine",
        pan: -pan * 0.6,
      });
    }
  }

  private playGate(value: number, x: number): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + 0.004;
    const pan = this.panFor(x);
    const root = midiToFrequency(PHASE_SCORES[this.phaseIndex].root + 19);
    const lift = 1 + clamp(value / 100, 0, 0.18);
    for (let index = 0; index < 3; index += 1) {
      this.playTone({
        frequency: root * lift * [1, 1.25, 1.5][index],
        duration: 0.3 - index * 0.045,
        gain: 0.045 - index * 0.007,
        when: now + index * 0.032,
        attack: 0.008,
        waveform: "sine",
        pan: clamp(pan + (index - 1) * 0.16, -1, 1),
        filterFrequency: 5200,
      });
    }
  }

  private playNova(strength: number, captured: number, x: number): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + 0.004;
    const power = clamp(strength, 0.2, 1.35);
    const mass = clamp(captured / 10);
    const pan = this.panFor(x) * 0.28;

    this.duck(0.27, 0.58);
    this.playTone({
      frequency: 62 + power * 9,
      endFrequency: 29,
      duration: 0.7,
      gain: 0.19 + power * 0.07 + mass * 0.035,
      when: now,
      attack: 0.004,
      waveform: "sine",
      pan,
    });
    this.playNoise({
      duration: 0.48,
      gain: 0.13 + power * 0.09,
      when: now,
      attack: 0.002,
      pan,
      playbackRate: 0.76,
      filterType: "lowpass",
      filterFrequency: 4400 + power * 1600,
      endFilterFrequency: 240,
      resonance: 0.7,
    });

    const root = PHASE_SCORES[this.phaseIndex].root;
    for (const [index, interval] of [0, 7, 12].entries()) {
      this.playTone({
        frequency: midiToFrequency(root + interval),
        endFrequency: midiToFrequency(root + interval + 12),
        duration: 0.54 + index * 0.08,
        gain: 0.055 + mass * 0.018,
        when: now + 0.025 + index * 0.012,
        attack: 0.045,
        waveform: index === 0 ? "triangle" : "sine",
        pan: (index - 1) * 0.34,
        filterFrequency: 3200 + index * 1000,
      });
    }
  }

  private playFracture(chain: number, strength: number, x: number): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + 0.003;
    const force = clamp(strength, 0.15, 1.4);
    const chainLift = clamp(chain / 14);
    const pan = this.panFor(x);

    this.playNoise({
      duration: 0.18,
      gain: 0.12 + force * 0.075,
      when: now,
      attack: 0.001,
      pan,
      playbackRate: 1.15 + force * 0.35,
      filterType: "bandpass",
      filterFrequency: 1700 + chainLift * 1700,
      endFilterFrequency: 5400 + chainLift * 1600,
      resonance: 0.85,
    });

    const shardRoot = midiToFrequency(72 + Math.min(12, chain));
    const shardCount = Math.min(3, 1 + Math.floor(Math.max(0, chain) / 3));
    for (let index = 0; index < shardCount; index += 1) {
      this.playTone({
        frequency: shardRoot * [1, 1.19, 1.5][index],
        endFrequency: shardRoot * [1.06, 1.11, 1.58][index],
        duration: 0.105 + index * 0.035,
        gain: 0.052 + chainLift * 0.024,
        when: now + index * 0.026,
        attack: 0.0015,
        waveform: "triangle",
        pan: clamp(pan + (index - 1) * 0.24, -1, 1),
        filterFrequency: 6200,
      });
    }
  }

  private playNearMiss(x: number): void {
    const pan = this.panFor(x);
    this.playNoise({
      duration: 0.26,
      gain: 0.065,
      attack: 0.035,
      pan,
      playbackRate: 1.25,
      filterType: "bandpass",
      filterFrequency: 850,
      endFilterFrequency: 3900,
      resonance: 2.1,
    });
    this.playTone({
      frequency: 310,
      endFrequency: 710,
      duration: 0.19,
      gain: 0.032,
      attack: 0.018,
      waveform: "sine",
      pan: clamp(pan * 1.15, -1, 1),
    });
  }

  private playHit(stability: number, x: number): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + 0.002;
    const damage = 1 - clamp(stability);
    const pan = this.panFor(x) * 0.45;
    this.duck(0.48, 0.24);
    this.playTone({
      frequency: 102 - damage * 20,
      endFrequency: 38,
      duration: 0.32,
      gain: 0.16 + damage * 0.07,
      when: now,
      attack: 0.002,
      waveform: "sawtooth",
      pan,
      filterFrequency: 920,
    });
    this.playNoise({
      duration: 0.2,
      gain: 0.13 + damage * 0.045,
      when: now,
      attack: 0.001,
      pan,
      playbackRate: 0.72,
      filterType: "lowpass",
      filterFrequency: 1500,
      endFilterFrequency: 260,
    });
  }

  private playComplete(score: number): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + 0.015;
    const root = PHASE_SCORES[5].root + (score > 0 ? 12 : 0);
    for (const [index, interval] of [0, 4, 7, 12].entries()) {
      this.playTone({
        frequency: midiToFrequency(root + interval),
        duration: 0.65 - index * 0.06,
        gain: 0.065,
        when: now + index * 0.105,
        attack: 0.025,
        waveform: index < 2 ? "triangle" : "sine",
        pan: (index - 1.5) * 0.24,
        filterFrequency: 4800,
      });
    }
  }

  private playGameOver(score: number): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime + 0.008;
    const root = midiToFrequency(PHASE_SCORES[this.phaseIndex].root - 12);
    const scoreWarmth = clamp(Math.log10(Math.max(10, score)) / 6, 0, 0.4);
    this.duck(0.4, 0.7);
    this.playTone({
      frequency: root * (1 + scoreWarmth * 0.04),
      endFrequency: root * 0.5,
      duration: 0.95,
      gain: 0.13,
      when: now,
      attack: 0.012,
      waveform: "triangle",
      filterFrequency: 1100,
    });
    this.playNoise({
      duration: 0.6,
      gain: 0.055,
      when: now + 0.03,
      attack: 0.08,
      playbackRate: 0.48,
      filterType: "lowpass",
      filterFrequency: 900,
      endFilterFrequency: 150,
    });
  }

  private duck(level: number, recoverySeconds: number): void {
    const context = this.context;
    const duck = this.musicDuck;
    if (!context || !duck) return;
    const now = context.currentTime;
    duck.gain.cancelScheduledValues(now);
    duck.gain.setValueAtTime(duck.gain.value, now);
    duck.gain.linearRampToValueAtTime(clamp(level, 0.1, 1), now + 0.018);
    duck.gain.exponentialRampToValueAtTime(1, now + Math.max(0.08, recoverySeconds));
  }

  private playTone(options: ToneOptions): void {
    const context = this.context;
    const destination = options.destination ?? this.sfxBus;
    if (!context || !destination || !this.canMakeSound()) return;

    const when = Math.max(context.currentTime + 0.002, options.when ?? context.currentTime);
    const duration = clamp(options.duration, 0.02, 2.5);
    const attack = clamp(options.attack ?? 0.006, 0.001, duration * 0.6);
    const end = when + duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const filter = options.filterFrequency ? context.createBiquadFilter() : null;
    const panner = this.createPanner(options.pan);

    oscillator.type = options.waveform ?? "sine";
    oscillator.frequency.setValueAtTime(Math.max(20, options.frequency), when);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.endFrequency),
        end,
      );
    }

    envelope.gain.setValueAtTime(SILENCE, when);
    envelope.gain.linearRampToValueAtTime(Math.max(SILENCE, options.gain), when + attack);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, end);

    const nodes: AudioNode[] = [oscillator, envelope];
    let tail: AudioNode = oscillator;
    if (filter) {
      filter.type = "lowpass";
      filter.frequency.value = Math.max(80, options.filterFrequency ?? 4000);
      filter.Q.value = 0.7;
      tail.connect(filter);
      tail = filter;
      nodes.push(filter);
    }
    tail.connect(envelope);
    tail = envelope;
    if (panner) {
      tail.connect(panner);
      tail = panner;
      nodes.push(panner);
    }
    tail.connect(destination);

    oscillator.start(when);
    oscillator.stop(end + 0.025);
    this.registerVoice(
      oscillator,
      nodes,
      options.group ?? "sfx",
      end + 0.025,
    );
  }

  private playNoise(options: NoiseOptions): void {
    const context = this.context;
    const destination = options.destination ?? this.sfxBus;
    const buffer = this.noiseBuffer;
    if (!context || !destination || !buffer || !this.canMakeSound()) return;

    const when = Math.max(context.currentTime + 0.002, options.when ?? context.currentTime);
    const duration = clamp(options.duration, 0.02, Math.min(1.8, buffer.duration));
    const attack = clamp(options.attack ?? 0.004, 0.001, duration * 0.6);
    const end = when + duration;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const panner = this.createPanner(options.pan);

    source.buffer = buffer;
    source.playbackRate.value = clamp(options.playbackRate ?? 1, 0.25, 2.5);
    filter.type = options.filterType ?? "bandpass";
    filter.Q.value = options.resonance ?? 0.8;
    const startFrequency = Math.max(60, options.filterFrequency ?? 1600);
    filter.frequency.setValueAtTime(startFrequency, when);
    if (options.endFilterFrequency) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(60, options.endFilterFrequency),
        end,
      );
    }
    envelope.gain.setValueAtTime(SILENCE, when);
    envelope.gain.linearRampToValueAtTime(Math.max(SILENCE, options.gain), when + attack);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, end);

    source.connect(filter);
    filter.connect(envelope);
    let tail: AudioNode = envelope;
    const nodes: AudioNode[] = [source, filter, envelope];
    if (panner) {
      tail.connect(panner);
      tail = panner;
      nodes.push(panner);
    }
    tail.connect(destination);

    const maximumOffset = Math.max(0, buffer.duration - duration);
    const offset = maximumOffset * (((this.voices.length * 0.6180339) % 1 + 1) % 1);
    source.start(when, offset, duration);
    source.stop(end + 0.025);
    this.registerVoice(source, nodes, options.group ?? "sfx", end + 0.025);
  }

  private createPanner(pan?: number): StereoPannerNode | null {
    const context = this.context;
    if (!context || pan === undefined || typeof context.createStereoPanner !== "function") {
      return null;
    }
    try {
      const panner = context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      return panner;
    } catch {
      return null;
    }
  }

  private registerVoice(
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
    group: VoiceGroup,
    endsAt: number,
  ): void {
    if (this.voices.length >= MAX_SCHEDULED_VOICES) {
      let oldest = this.voices[0];
      for (const voice of this.voices) {
        if (voice.endsAt < oldest.endsAt) oldest = voice;
      }
      this.removeVoice(oldest, true);
    }

    const record: VoiceRecord = { source, nodes, group, endsAt };
    this.voices.push(record);
    source.onended = () => this.removeVoice(record, false);
  }

  private removeVoice(record: VoiceRecord, stop: boolean): void {
    const index = this.voices.indexOf(record);
    if (index >= 0) this.voices.splice(index, 1);
    record.source.onended = null;
    if (stop) safeStop(record.source);
    for (const node of record.nodes) safeDisconnect(node);
  }

  private stopVoices(group?: VoiceGroup): void {
    for (const voice of [...this.voices]) {
      if (!group || voice.group === group) this.removeVoice(voice, true);
    }
  }

  private panFor(x: number): number {
    if (!Number.isFinite(x)) return 0;
    const normalized = ((x - this.coreX) / this.spatialWidth) * 2;
    return clamp(normalized, -0.82, 0.82);
  }

  private canMakeSound(): boolean {
    return Boolean(
      !this.disposed &&
        this.context &&
        this.context.state === "running" &&
        !this.manualPaused &&
        !this.snapshotPaused &&
        !this.hidden,
    );
  }

  private syncContextState(force = false): void {
    const context = this.context;
    if (!context || context.state === "closed" || this.disposed) return;

    const shouldRun = !this.manualPaused && !this.snapshotPaused && !this.hidden;
    const target = shouldRun ? "running" : "suspended";
    if (!force && this.contextTarget === target) return;
    this.contextTarget = target;

    if (shouldRun && context.state === "suspended") {
      void context.resume().catch(() => {
        // A later explicit unlock gesture can retry.
      });
    } else if (!shouldRun && context.state === "running") {
      void context.suspend().catch(() => undefined);
    }
  }
}
