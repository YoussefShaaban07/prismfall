import { isTouchDevice } from './util';

/**
 * Unified input: keyboard (WASD / arrows), gamepad (left stick, A/RB = dash, Start = pause),
 * and a floating virtual joystick for touch / mouse drag.
 */
export class Input {
  keys = new Set<string>();
  moveX = 0;
  moveY = 0;
  touchUsed = isTouchDevice();
  gamepadUsed = false;
  private dashQueued = false;
  private joy: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private padPrev: boolean[] = [];
  enabled = false;

  onPause: () => void = () => {};
  onKey: (code: string) => void = () => {};
  onPadButton: (idx: number) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, private joyEl: HTMLElement, private knobEl: HTMLElement, dashBtn: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') {
        this.dashQueued = true;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
      this.onKey(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.joy = null;
      this.hideJoy();
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.joy) return;
      if (e.pointerType === 'touch') this.touchUsed = true;
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.showJoy();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.joy || e.pointerId !== this.joy.id) return;
      this.joy.x = e.clientX;
      this.joy.y = e.clientY;
      const dx = this.joy.x - this.joy.ox;
      const dy = this.joy.y - this.joy.oy;
      const d = Math.hypot(dx, dy);
      const max = 64;
      if (d > max) {
        // drag the base along so direction changes stay responsive
        this.joy.ox = this.joy.x - (dx / d) * max;
        this.joy.oy = this.joy.y - (dy / d) * max;
      }
      this.showJoy();
    });
    const end = (e: PointerEvent) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null;
        this.hideJoy();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const dash = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.dashQueued = true;
    };
    dashBtn.addEventListener('pointerdown', dash);
    addEventListener('gamepadconnected', () => (this.gamepadUsed = true));
  }

  releaseAll() {
    this.joy = null;
    this.hideJoy();
    this.keys.clear();
    this.dashQueued = false;
  }

  private showJoy() {
    if (!this.joy) return;
    this.joyEl.style.display = 'block';
    this.joyEl.style.transform = `translate(${this.joy.ox - 60}px, ${this.joy.oy - 60}px)`;
    const dx = this.joy.x - this.joy.ox;
    const dy = this.joy.y - this.joy.oy;
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  private hideJoy() {
    this.joyEl.style.display = 'none';
  }

  queueDash() {
    this.dashQueued = true;
  }

  consumeDash() {
    const d = this.dashQueued;
    this.dashQueued = false;
    return d;
  }

  update() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp') || k.has('KeyZ')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (k.has('KeyA') || k.has('ArrowLeft') || k.has('KeyQ')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    const l = Math.hypot(x, y);
    if (l > 0) {
      x /= l;
      y /= l;
    }

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      const m = Math.hypot(ax, ay);
      if (m > 0.18) {
        this.gamepadUsed = true;
        const s = Math.min(1, (m - 0.18) / 0.72) / m;
        x = ax * s;
        y = ay * s;
      }
      if (p.buttons[12]?.pressed) y = -1;
      if (p.buttons[13]?.pressed) y = 1;
      if (p.buttons[14]?.pressed) x = -1;
      if (p.buttons[15]?.pressed) x = 1;
      p.buttons.forEach((b, i) => {
        const was = this.padPrev[i] ?? false;
        if (b.pressed && !was) {
          this.gamepadUsed = true;
          if (i === 0 || i === 5 || i === 7) this.dashQueued = true;
          if (i === 9) this.onPause();
          this.onPadButton(i);
        }
        this.padPrev[i] = b.pressed;
      });
      break;
    }

    if (this.joy) {
      const dx = this.joy.x - this.joy.ox;
      const dy = this.joy.y - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        const m = Math.min(1, (d - 6) / 48);
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }
    this.moveX = x;
    this.moveY = y;
  }
}
