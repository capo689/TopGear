/**
 * Injectable clock so TTL logic is deterministically testable. The daemon uses the
 * system clock; tests use a controllable fake. (Policy is model-free — INV-11 — and
 * time-driven behavior must be reproducible for the adversarial suites.)
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A controllable clock for tests. */
export function fakeClock(startMs = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}
