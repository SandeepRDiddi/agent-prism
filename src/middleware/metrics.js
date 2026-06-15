const _counters = new Map();
const _histograms = new Map(); // name → { sum, count, buckets: Map<le, count> }

const LATENCY_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, Infinity];

export function incCounter(name, amount = 1) {
  _counters.set(name, (_counters.get(name) || 0) + amount);
}

export function recordLatency(name, ms) {
  let h = _histograms.get(name);
  if (!h) {
    h = { sum: 0, count: 0, buckets: new Map(LATENCY_BUCKETS.map((b) => [b, 0])) };
    _histograms.set(name, h);
  }
  h.sum += ms;
  h.count += 1;
  for (const [le] of h.buckets) {
    if (ms <= le) h.buckets.set(le, h.buckets.get(le) + 1);
  }
}

export function getMetricsText(gauges = {}) {
  const lines = [];

  for (const [name, value] of _counters) {
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  }

  for (const [name, h] of _histograms) {
    lines.push(`# TYPE ${name} histogram`);
    for (const [le, count] of h.buckets) {
      lines.push(`${name}_bucket{le="${le === Infinity ? "+Inf" : le}"} ${count}`);
    }
    lines.push(`${name}_sum ${h.sum}`);
    lines.push(`${name}_count ${h.count}`);
  }

  for (const [name, value] of Object.entries(gauges)) {
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${value}`);
  }

  return lines.join("\n") + "\n";
}
