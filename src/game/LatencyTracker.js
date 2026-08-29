const DEFAULT_SAMPLE_LIMIT = 7;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

export class LatencyTracker {
  constructor(sampleLimit = DEFAULT_SAMPLE_LIMIT) {
    this.sampleLimit = Math.max(3, Math.floor(sampleLimit));
    this.samples = [];
    this.rtt = 0;
    this.jitter = 0;
  }

  reset() {
    this.samples.length = 0;
    this.rtt = 0;
    this.jitter = 0;
  }

  add(sample) {
    if (!Number.isFinite(sample) || sample < 0) {
      return { rtt: this.rtt, jitter: this.jitter, sample: null };
    }
    this.samples.push(sample);
    while (this.samples.length > this.sampleLimit) this.samples.shift();
    this.rtt = median(this.samples);
    this.jitter = median(
      this.samples.map((value) => Math.abs(value - this.rtt)),
    );
    return { rtt: this.rtt, jitter: this.jitter, sample };
  }
}

export { DEFAULT_SAMPLE_LIMIT, median };
