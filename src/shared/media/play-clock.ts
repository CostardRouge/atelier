/**
 * The preview's playhead, as a small store OUTSIDE React state: the stage
 * paints from it on every animation frame and the transport reads it through
 * `useSyncExternalStore`, so a playing atlas re-renders the transport and
 * nothing else — the inspector and its two hundred controls stay still.
 */

export class PlayClock {
  t = 0;
  playing = false;
  loop = true;
  speed = 1;
  total = 1;
  /**
   * True from Play until the first tick: that frame is painted where the
   * playhead stands and pays whatever a cold start costs (a raster built, a
   * text measured), and the film moves from the next — timed from the end of
   * that frame, never from before it (`AtlasStage`).
   */
  starting = false;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  setTotal(total: number): void {
    this.total = Math.max(0.1, total);
    if (this.t > this.total) this.t = this.total;
    this.changed();
  }

  seek(t: number): void {
    this.t = Math.min(this.total, Math.max(0, t));
    this.changed();
  }

  setPlaying(on: boolean): void {
    if (on && this.t >= this.total - 1e-3) this.t = 0;
    if (on && !this.playing) this.starting = true;
    if (!on) this.starting = false;
    this.playing = on;
    this.changed();
  }

  toggle(): void {
    this.setPlaying(!this.playing);
  }

  setLoop(on: boolean): void {
    this.loop = on;
    this.changed();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.changed();
  }

  /** Advance by `dt` wall seconds; true while it moved. The first tick after Play holds the playhead. */
  tick(dt: number): boolean {
    if (!this.playing) return false;
    if (this.starting) {
      this.starting = false;
      this.changed();
      return true;
    }
    let t = this.t + dt * this.speed;
    if (t >= this.total) {
      if (this.loop) t = t % this.total;
      else {
        t = this.total;
        this.playing = false;
      }
    }
    this.t = t;
    this.changed();
    return true;
  }
}
