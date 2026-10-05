import { Sfx } from './sfx';

type State = 'menu' | 'playing' | 'won' | 'lost';

const CFG = {
  startTime: 30, // секунд на то, чтобы заснуть
  missPenalty: 2, // штраф за промах, сек
  hitGain: 7, // сколько % тишины даёт один комар
  baseMosquitoes: 3, // комаров на экране в начале
  extraPer: 25, // +1 комар за каждые N% тишины
  radiusMin: 14,
  radiusMax: 22,
  hitSlop: 8, // «прощение» хитбокса в пикселях
  speedMin: 130, // px/s
  speedMax: 230,
  speedGrow: 0.6, // на сколько ускоряются комары к концу (0.6 = +60%)
  turnMin: 0.5, // как часто комар внезапно меняет курс, сек
  turnMax: 1.6,
  boostChance: 0.35, // шанс, что смена курса сопровождается рывком
  boostMul: 2.3,
  boostTime: 0.55,
} as const;

interface Mosquito {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  turnIn: number;
  boostLeft: number;
  wing: number;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  color: string;
}

interface FloatText {
  x: number;
  y: number;
  age: number;
  text: string;
  color: string;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент #${id}`);
  return el as T;
}

export class Game {
  private readonly canvas = $<HTMLCanvasElement>('game');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud = $('hud');
  private readonly timerEl = $('timer');
  private readonly barEl = $('bar-fill');
  private readonly faceEl = $('face');
  private readonly muteBtn = $('mute');
  private readonly overlay = $('overlay');
  private readonly ovTitle = $('ov-title');
  private readonly ovText = $('ov-text');
  private readonly ovStats = $('ov-stats');
  private readonly startBtn = $('start');

  private readonly sfx = new Sfx();

  private width = window.innerWidth;
  private height = window.innerHeight;

  private state: State = 'menu';
  private mosquitoes: Mosquito[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];

  private silence = 0;
  private timeLeft: number = CFG.startTime;
  private elapsed = 0;
  private hits = 0;
  private misses = 0;
  private flash = 0;
  private last = performance.now();

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D не поддерживается');
    this.ctx = ctx;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
    this.startBtn.addEventListener('click', () => {
      this.sfx.unlock();
      this.start();
    });
    this.muteBtn.addEventListener('click', () => {
      this.sfx.muted = !this.sfx.muted;
      this.muteBtn.textContent = this.sfx.muted ? '🔇' : '🔊';
    });
    for (let i = 0; i < 5; i++) this.mosquitoes.push(this.spawn());

    requestAnimationFrame(this.frame);
  }


  private resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Если окно уменьшили — вернуть комаров внутрь.
    for (const m of this.mosquitoes) {
      m.x = Math.min(Math.max(m.x, m.r), this.width - m.r);
      m.y = Math.min(Math.max(m.y, m.r), this.height - m.r);
    }
  }

  private start(): void {
    this.state = 'playing';
    this.silence = 0;
    this.timeLeft = CFG.startTime;
    this.elapsed = 0;
    this.hits = 0;
    this.misses = 0;
    this.flash = 0;
    this.rings = [];
    this.texts = [];
    this.mosquitoes = [];
    for (let i = 0; i < CFG.baseMosquitoes; i++) this.mosquitoes.push(this.spawn());

    this.overlay.hidden = true;
    this.hud.hidden = false;
    this.updateHud();
  }

  private finish(won: boolean): void {
    this.state = won ? 'won' : 'lost';
    this.hud.hidden = true;
    this.overlay.hidden = false;

    if (won) {
      this.sfx.win();
      const time = this.elapsed;
      const best = this.saveBest(time);
      this.ovTitle.textContent = 'Тишина. Он уснул 😴';
      this.ovText.textContent = 'Последний комар замолчал, и в комнате наконец стало тихо.';
      this.ovStats.textContent =
        `Время: ${time.toFixed(1)} с · Промахов: ${this.misses}` +
        (best !== null ? ` · Рекорд: ${best.toFixed(1)} с` : '');
      this.startBtn.textContent = 'Ещё раз';
    } else {
      this.sfx.lose();
      this.ovTitle.textContent = 'Не уснул 😫';
      this.ovText.textContent = 'Время вышло, а комары всё ещё звенят над ухом.';
      this.ovStats.textContent =
        `Тишина: ${Math.floor(this.silence)}% · Попаданий: ${this.hits} · Промахов: ${this.misses}`;
      this.startBtn.textContent = 'Попробовать снова';
    }
  }

  /** Лучшее время хранится в localStorage (если он доступен). */
  private saveBest(time: number): number | null {
    try {
      const key = 'mosquito-trap-best';
      const prev = Number(localStorage.getItem(key));
      const best = prev > 0 ? Math.min(prev, time) : time;
      localStorage.setItem(key, String(best));
      return best;
    } catch {
      return null;
    }
  }


  private speedMul(): number {
    return 1 + (this.silence / 100) * CFG.speedGrow;
  }

  private spawn(): Mosquito {
    const r = rand(CFG.radiusMin, CFG.radiusMax);
    const side = Math.floor(Math.random() * 4);
    let x = rand(r, this.width - r);
    let y = rand(r, this.height - r);
    if (side === 0) y = r;
    else if (side === 1) y = this.height - r;
    else if (side === 2) x = r;
    else x = this.width - r;

    const m: Mosquito = { x, y, vx: 0, vy: 0, r, turnIn: 0, boostLeft: 0, wing: rand(0, 6) };
    this.retarget(m);
    return m;
  }

  /** Комар внезапно выбирает новый курс и скорость (иногда — с рывком). */
  private retarget(m: Mosquito): void {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(CFG.speedMin, CFG.speedMax) * this.speedMul();
    m.vx = Math.cos(angle) * speed;
    m.vy = Math.sin(angle) * speed;
    m.turnIn = rand(CFG.turnMin, CFG.turnMax);
    m.boostLeft = Math.random() < CFG.boostChance ? CFG.boostTime : 0;
  }

  private updateMosquito(m: Mosquito, dt: number): void {
    m.wing += dt * 70;
    m.turnIn -= dt;
    if (m.boostLeft > 0) m.boostLeft -= dt;
    if (m.turnIn <= 0) this.retarget(m);

    const k = m.boostLeft > 0 ? CFG.boostMul : 1;
    m.x += m.vx * k * dt;
    m.y += m.vy * k * dt;

    // Отскок от краёв окна.
    if (m.x < m.r) {
      m.x = m.r;
      m.vx = Math.abs(m.vx);
    } else if (m.x > this.width - m.r) {
      m.x = this.width - m.r;
      m.vx = -Math.abs(m.vx);
    }
    if (m.y < m.r) {
      m.y = m.r;
      m.vy = Math.abs(m.vy);
    } else if (m.y > this.height - m.r) {
      m.y = this.height - m.r;
      m.vy = -Math.abs(m.vy);
    }
  }

  private targetCount(): number {
    return CFG.baseMosquitoes + Math.floor(this.silence / CFG.extraPer);
  }

  // ---------------------------------------------------------------- input

  private onPointer(e: PointerEvent): void {
    if (this.state !== 'playing') return;
    this.sfx.unlock();

    const x = e.clientX;
    const y = e.clientY;

    // Идём с конца — сверху лежит тот, кого нарисовали последним.
    for (let i = this.mosquitoes.length - 1; i >= 0; i--) {
      const m = this.mosquitoes[i];
      const reach = m.r + CFG.hitSlop;
      if ((m.x - x) ** 2 + (m.y - y) ** 2 <= reach * reach) {
        this.onHit(i);
        return;
      }
    }
    this.onMiss(x, y);
  }

  private onHit(index: number): void {
    const m = this.mosquitoes[index];
    this.mosquitoes.splice(index, 1);
    this.hits++;
    this.silence = Math.min(100, this.silence + CFG.hitGain);
    this.rings.push({ x: m.x, y: m.y, age: 0, color: '#7fd4c1' });
    this.texts.push({ x: m.x, y: m.y - 10, age: 0, text: `+${CFG.hitGain}%`, color: '#7fd4c1' });
    this.sfx.hit();

    if (this.silence >= 100) {
      this.updateHud();
      this.finish(true);
      return;
    }
    while (this.mosquitoes.length < this.targetCount()) this.mosquitoes.push(this.spawn());
    this.updateHud();
  }

  private onMiss(x: number, y: number): void {
    this.misses++;
    this.timeLeft -= CFG.missPenalty;
    this.flash = 0.35;
    this.rings.push({ x, y, age: 0, color: '#ff5d5d' });
    this.texts.push({ x, y: y - 10, age: 0, text: `−${CFG.missPenalty} с`, color: '#ff5d5d' });
    this.sfx.miss();

    // Перезапуск CSS-анимации штрафа на таймере.
    this.timerEl.classList.remove('penalty');
    void this.timerEl.offsetWidth;
    this.timerEl.classList.add('penalty');

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.updateHud();
      this.finish(false);
      return;
    }
    this.updateHud();
  }

  // ---------------------------------------------------------------- loop

  private frame = (now: number): void => {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.update(dt);
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    for (const m of this.mosquitoes) this.updateMosquito(m, dt);

    for (const r of this.rings) r.age += dt;
    for (const t of this.texts) {
      t.age += dt;
      t.y -= 45 * dt;
    }
    this.rings = this.rings.filter((r) => r.age < 0.45);
    this.texts = this.texts.filter((t) => t.age < 0.8);
    this.flash = Math.max(0, this.flash - dt);

    if (this.state === 'playing') {
      this.elapsed += dt;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.updateHud();
        this.finish(false);
        return;
      }
      this.updateHud();
    }
  }

  private updateHud(): void {
    this.timerEl.textContent = Math.max(0, this.timeLeft).toFixed(1);
    this.timerEl.classList.toggle('danger', this.timeLeft <= 5);
    this.barEl.style.width = `${this.silence}%`;
    const s = this.silence;
    this.faceEl.textContent = s >= 100 ? '😴' : s >= 75 ? '🥱' : s >= 50 ? '😪' : s >= 25 ? '😣' : '😫';
  }


  

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 70, 70, ${this.flash * 0.45})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    for (const m of this.mosquitoes) this.drawMosquito(m);

    for (const r of this.rings) {
      const p = r.age / 0.45;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + p * 38, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.font = '800 20px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = 1 - t.age / 0.8;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawMosquito(m: Mosquito): void {
    const ctx = this.ctx;
    const boosting = m.boostLeft > 0;
    const flap = 0.5 + 0.5 * Math.sin(m.wing);

    ctx.save();
    ctx.translate(m.x, m.y);

    // Крылья: быстро «дрожат» по высоте.
    ctx.fillStyle = 'rgba(205, 222, 255, 0.55)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * m.r * 0.55, -m.r * 0.85, m.r * 0.8, m.r * (0.18 + 0.28 * flap), side * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Тело-кружок. Красный — комар в рывке.
    ctx.fillStyle = boosting ? '#ff5d5d' : '#1d1824';
    ctx.strokeStyle = boosting ? '#ffd0d0' : '#8f86a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, m.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Глазки.
    ctx.fillStyle = '#f2e9c9';
    ctx.beginPath();
    ctx.arc(-m.r * 0.35, -m.r * 0.15, m.r * 0.16, 0, Math.PI * 2);
    ctx.arc(m.r * 0.35, -m.r * 0.15, m.r * 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
