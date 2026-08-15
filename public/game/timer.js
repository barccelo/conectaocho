(function (namespace) {
  'use strict';

  class GameTimer {
    constructor({ initialSeconds = 60, onTick, onEnd }) {
      this.initialSeconds = initialSeconds;
      this.onTick = onTick;
      this.onEnd = onEnd;
      this.remaining = initialSeconds;
      this.intervalId = null;
    }

    start() {
      if (this.intervalId !== null || this.remaining <= 0) return;
      this.intervalId = window.setInterval(() => {
        this.remaining = Math.max(0, this.remaining - 1);
        this.emitTick();
        if (this.remaining === 0) {
          this.stop();
          this.onEnd();
        }
      }, 1000);
    }

    adjust(seconds) {
      const adjustment = Number(seconds);
      if (!Number.isFinite(adjustment)) return;
      const current = Number.isFinite(this.remaining) ? this.remaining : this.initialSeconds;
      this.remaining = Math.max(0, current + adjustment);
      this.emitTick();
      if (this.remaining === 0) {
        this.stop();
        this.onEnd();
      }
    }

    setInitial(seconds) {
      this.initialSeconds = Math.max(1, Number(seconds) || 60);
      this.reset();
    }

    reset() {
      this.stop();
      this.remaining = Number.isFinite(this.initialSeconds) ? this.initialSeconds : 60;
      this.emitTick();
    }

    stop() {
      if (this.intervalId !== null) {
        window.clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }

    isRunning() { return this.intervalId !== null; }

    emitTick() { this.onTick(this.remaining); }
  }

  namespace.GameTimer = GameTimer;
})(window.Conecta8 = window.Conecta8 || {});
