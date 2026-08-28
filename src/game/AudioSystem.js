import { clamp } from './math.js';

export class AudioSystem {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.ambience = null;
    this.muted = localStorage.getItem('larp-muted') === 'true';
    this.noiseBuffers = new Map();
  }

  async init() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
      });
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.76;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.ambience) this.startAmbience();
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem('larp-muted', String(muted));
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.76, this.context.currentTime, 0.02);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  createNoiseBuffer(duration = 1) {
    if (!this.context) return null;
    const key = duration.toFixed(2);
    if (this.noiseBuffers.has(key)) return this.noiseBuffers.get(key);
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.84 + white * 0.16;
      data[index] = white * 0.72 + last * 0.28;
    }
    this.noiseBuffers.set(key, buffer);
    return buffer;
  }

  destination(volume = 1, pan = 0) {
    const gain = this.context.createGain();
    gain.gain.value = volume;
    if (typeof this.context.createStereoPanner === 'function') {
      const panner = this.context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    return gain;
  }

  tone({
    frequency = 220,
    endFrequency = frequency,
    duration = 0.1,
    volume = 0.1,
    type = 'sine',
    attack = 0.002,
    pan = 0,
    delay = 0,
  }) {
    if (!this.context || this.muted) return;
    const time = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.destination(volume, pan);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), time);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      time + duration,
    );
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }

  noise({
    duration = 0.12,
    volume = 0.12,
    highpass = 100,
    lowpass = 12000,
    pan = 0,
    delay = 0,
  }) {
    if (!this.context || this.muted) return;
    const time = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    source.buffer = this.createNoiseBuffer(Math.max(0.2, duration));
    const high = this.context.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = highpass;
    const low = this.context.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = lowpass;
    const gain = this.destination(volume, pan);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(high);
    high.connect(low);
    low.connect(gain);
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  click(strong = false) {
    this.tone({
      frequency: strong ? 150 : 420,
      endFrequency: strong ? 90 : 280,
      duration: strong ? 0.09 : 0.035,
      volume: strong ? 0.12 : 0.045,
      type: 'square',
    });
    if (strong) this.noise({ duration: 0.06, volume: 0.05, highpass: 900 });
  }

  gun(kind, pan = 0, distant = false) {
    const distanceScale = distant ? 0.52 : 1;
    if (kind === 'knives') {
      this.noise({ duration: 0.12, volume: 0.09 * distanceScale, highpass: 650, lowpass: 5200, pan });
      this.tone({ frequency: 540, endFrequency: 190, duration: 0.09, volume: 0.045 * distanceScale, type: 'sine', pan });
    } else if (kind === 'shortbow' || kind === 'longbow') {
      const long = kind === 'longbow';
      this.tone({ frequency: long ? 145 : 190, endFrequency: long ? 72 : 92, duration: long ? 0.22 : 0.16, volume: (long ? 0.14 : 0.1) * distanceScale, type: 'triangle', pan });
      this.noise({ duration: 0.09, volume: 0.05 * distanceScale, highpass: 900, lowpass: 4800, pan });
    } else if (kind === 'ember') {
      this.noise({ duration: 0.24, volume: 0.14 * distanceScale, highpass: 420, lowpass: 6200, pan });
      this.tone({ frequency: 260, endFrequency: 78, duration: 0.24, volume: 0.12 * distanceScale, type: 'sawtooth', pan });
    } else if (kind === 'crossbow') {
      this.tone({ frequency: 310, endFrequency: 95, duration: 0.12, volume: 0.13 * distanceScale, type: 'square', pan });
      this.noise({ duration: 0.08, volume: 0.085 * distanceScale, highpass: 750, lowpass: 5200, pan });
    } else if (kind === 'lightning') {
      this.tone({ frequency: 1550, endFrequency: 190, duration: 0.18, volume: 0.14 * distanceScale, type: 'sawtooth', pan });
      this.noise({ duration: 0.18, volume: 0.12 * distanceScale, highpass: 1800, lowpass: 12000, pan });
    } else if (kind === 'greatsword') {
      this.noise({ duration: 0.3, volume: 0.17 * distanceScale, highpass: 90, lowpass: 2100, pan });
      this.tone({ frequency: 130, endFrequency: 48, duration: 0.24, volume: 0.11 * distanceScale, type: 'triangle', pan });
    } else if (kind === 'fireball') {
      this.noise({ duration: 0.38, volume: 0.22 * distanceScale, highpass: 70, lowpass: 4200, pan });
      this.tone({ frequency: 118, endFrequency: 34, duration: 0.36, volume: 0.2 * distanceScale, type: 'sawtooth', pan });
    }
  }

  impact(flesh = false, headshot = false, pan = 0) {
    if (flesh) {
      this.noise({
        duration: headshot ? 0.11 : 0.07,
        volume: headshot ? 0.13 : 0.08,
        highpass: 120,
        lowpass: headshot ? 2600 : 1700,
        pan,
      });
      this.tone({
        frequency: headshot ? 830 : 420,
        endFrequency: headshot ? 430 : 220,
        duration: 0.055,
        volume: headshot ? 0.09 : 0.045,
        type: 'square',
        pan,
      });
    } else {
      this.noise({ duration: 0.055, volume: 0.055, highpass: 1400, lowpass: 9000, pan });
      this.tone({ frequency: 1150, endFrequency: 360, duration: 0.045, volume: 0.028, type: 'sine', pan });
    }
  }

  hurt(amount = 20, pan = 0) {
    const strength = clamp(amount / 70, 0.2, 1);
    this.noise({
      duration: 0.22,
      volume: 0.16 * strength,
      highpass: 40,
      lowpass: 900,
      pan,
    });
    this.tone({
      frequency: 76,
      endFrequency: 35,
      duration: 0.24,
      volume: 0.18 * strength,
      type: 'sawtooth',
      pan,
    });
  }

  pickup() {
    this.tone({ frequency: 330, endFrequency: 520, duration: 0.08, volume: 0.07, type: 'square' });
    this.tone({ frequency: 520, endFrequency: 790, duration: 0.1, volume: 0.06, type: 'square', delay: 0.07 });
    this.noise({ duration: 0.045, volume: 0.025, highpass: 1800, delay: 0.02 });
  }

  empty() {
    this.tone({ frequency: 850, endFrequency: 520, duration: 0.025, volume: 0.04, type: 'square' });
    this.tone({ frequency: 530, endFrequency: 420, duration: 0.02, volume: 0.025, type: 'square', delay: 0.04 });
  }

  movement(type, intensity = 1) {
    if (type === 'step') {
      this.noise({ duration: 0.07, volume: 0.045 * intensity, highpass: 90, lowpass: 1300 });
      this.tone({ frequency: 72, endFrequency: 48, duration: 0.06, volume: 0.035 * intensity, type: 'sine' });
    } else if (type === 'jump') {
      this.noise({ duration: 0.12, volume: 0.06, highpass: 150, lowpass: 1900 });
    } else if (type === 'land') {
      this.noise({ duration: 0.16, volume: 0.09 * intensity, highpass: 45, lowpass: 1200 });
      this.tone({ frequency: 70, endFrequency: 38, duration: 0.13, volume: 0.07 * intensity, type: 'sine' });
    } else if (type === 'slide') {
      this.noise({ duration: 0.28, volume: 0.08, highpass: 220, lowpass: 2800 });
    } else if (type === 'wall') {
      this.noise({ duration: 0.1, volume: 0.04, highpass: 700, lowpass: 4700 });
    }
  }

  countdown(value) {
    const frequency = value > 0 ? 230 + value * 45 : 650;
    this.tone({
      frequency,
      endFrequency: value > 0 ? frequency * 0.82 : 980,
      duration: value > 0 ? 0.12 : 0.22,
      volume: value > 0 ? 0.09 : 0.14,
      type: 'square',
    });
  }

  roundResult(won) {
    const notes = won ? [220, 330, 440] : [190, 145, 92];
    notes.forEach((frequency, index) => {
      this.tone({
        frequency,
        endFrequency: frequency * (won ? 1.05 : 0.86),
        duration: 0.23,
        volume: 0.11,
        type: won ? 'square' : 'sawtooth',
        delay: index * 0.11,
      });
    });
  }

  explosion(pan = 0, scale = 1) {
    this.noise({
      duration: 0.72,
      volume: 0.34 * scale,
      highpass: 28,
      lowpass: 4200,
      pan,
    });
    this.tone({
      frequency: 68,
      endFrequency: 22,
      duration: 0.75,
      volume: 0.34 * scale,
      type: 'sawtooth',
      pan,
    });
    this.noise({
      duration: 0.18,
      volume: 0.15 * scale,
      highpass: 1800,
      pan,
    });
  }

  startAmbience() {
    if (!this.context || this.ambience) return;
    const bus = this.context.createGain();
    bus.gain.value = 0.055;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 0.8;
    bus.connect(filter);
    filter.connect(this.master);

    const low = this.context.createOscillator();
    low.type = 'sawtooth';
    low.frequency.value = 41.2;
    const lowGain = this.context.createGain();
    lowGain.gain.value = 0.3;
    low.connect(lowGain);
    lowGain.connect(bus);

    const fifth = this.context.createOscillator();
    fifth.type = 'sine';
    fifth.frequency.value = 61.8;
    const fifthGain = this.context.createGain();
    fifthGain.gain.value = 0.2;
    fifth.connect(fifthGain);
    fifthGain.connect(bus);

    const lfo = this.context.createOscillator();
    lfo.frequency.value = 0.083;
    const lfoGain = this.context.createGain();
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain);
    lfoGain.connect(bus.gain);
    low.start();
    fifth.start();
    lfo.start();
    this.ambience = { bus, low, fifth, lfo };
  }
}
