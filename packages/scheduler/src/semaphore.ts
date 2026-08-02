/**
 * A counting semaphore with a FIFO wait queue and direct permit hand-off. Used to bound
 * concurrency at both the global and per-origin levels (INV-7).
 */
export class Semaphore {
  private permits: number;
  private readonly queue: (() => void)[] = [];

  constructor(permits: number) {
    if (permits < 1) throw new Error("semaphore needs >= 1 permit");
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    // Woken by release() which handed us its permit — do not decrement again.
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.permits += 1;
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.queue.length;
  }
}
