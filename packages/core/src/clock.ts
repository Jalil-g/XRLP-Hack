export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Controllable clock for tests, the simulator and demo "fast-forward". */
export class FakeClock implements Clock {
  private t: number;
  constructor(start: Date | string = new Date()) {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): Date {
    this.t += ms;
    return this.now();
  }
  advanceDays(days: number): Date {
    return this.advance(days * 86_400_000);
  }
  set(d: Date | string): void {
    this.t = new Date(d).getTime();
  }
}

export const DAY_MS = 86_400_000;
export const iso = (d: Date): string => d.toISOString();
