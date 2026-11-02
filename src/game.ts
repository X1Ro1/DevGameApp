import { Sfx } from './sfx';

type State = 'menu' | 'playing' | 'paused' | 'won' | 'lost';
type Phase = 1 | 2;

const CFG = {
  startTime: 30, // секунд на то, чтобы заснуть
  missPenalty: 2, // штраф за промах в фазе 1, сек
  hitGain: 7, // сколько % тишины даёт один комар в фазе 1
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

  // ---- Фаза 2 -----------------------------------------------------------
  phase2At: 50, // при каком % тишины комары переходят во вторую фазу
  phase2Bonus: 5, // сек времени в награду за выход во вторую фазу
  bannerTime: 2.2, // сколько висит плашка «Фаза 2», сек
  p2: {
    hp: 2, // сколько попаданий выдерживает комар
    woundGain: 3, // % тишины за первое попадание (комар ранен)
    killGain: 5, // % тишины за добивание
    killTimeBonus: 1, // сек времени за добитого комара
    missPenalty: 3, // штраф за промах, сек
    speedMul: 1.15, // комары быстрее
    turnMul: 0.7, // и чаще меняют курс (меньше = чаще)
    boostChance: 0.5, // и чаще делают рывки
    wobbleAmp: 110, // боковое «виляние», px/s
    wobbleFreq: 9, // частота виляния, рад/с
  },
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
  angry: boolean; // комар во второй фазе
  hp: number;
  maxHp: number;
  wobble: number;
  hurt: number; // таймер «ранен» (тряска и подсветка)
  rage: number; // таймер ауры при превращении
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

interface Banner {
  title: string;
  sub: string;
  age: number;
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
  private readonly barMarkEl = $('bar-mark');
  private readonly phaseEl = $('phase');
  private readonly faceEl = $('face');
  private readonly pauseBtn = $('pause');
  private readonly muteBtn = $('mute');
  private readonly overlay = $('overlay');
  private readonly ovTitle = $('ov-title');
  private readonly ovText = $('ov-text');
  private readonly ovStats = $('ov-stats');
  private readonly startBtn = $('start');
  private readonly resumeBtn = $('resume');
  private readonly restartBtn = $('restart');

  private readonly sfx = new Sfx();

  private width = window.innerWidth;
  private height = window.innerHeight;

  private state: State = 'menu';
  private phase: Phase = 1;
  private mosquitoes: Mosquito[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private banner: Banner | null = null;

  private silence = 0;
  private timeLeft: number = CFG.startTime;
  private elapsed = 0;
  private hits = 0;
  private misses = 0;
  private flash = 0;
  private phaseFlash = 0;
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
    this.restartBtn.addEventListener('click', () => {
      this.sfx.unlock();
      this.start();
    });
    this.resumeBtn.addEventListener('click', () => this.resume());
    this.pauseBtn.addEventListener('click', () => {
      this.pauseBtn.blur();
      this.pause();
    });
    this.muteBtn.addEventListener('click', () => {
      this.muteBtn.blur();
      this.sfx.muted = !this.sfx.muted;
      this.muteBtn.textContent = this.sfx.muted ? '🔇' : '🔊';
    });

    // Esc или P (на любой раскладке) — пауза / продолжить.
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
    });
    // Если вкладку свернули — игра сама встаёт на паузу.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    // Отметка на шкале: с какого процента начинается фаза 2.
    this.barMarkEl.style.left = `${CFG.phase2At}%`;

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

  // ------------------------------------------------------------- state

  /** Какие кнопки показывать в оверлее. */
  private setButtons(mode: 'start' | 'pause'): void {
    this.startBtn.hidden = mode !== 'start';
    this.resumeBtn.hidden = mode !== 'pause';
    this.restartBtn.hidden = mode !== 'pause';
  }

  private start(): void {
    this.state = 'playing';
    this.phase = 1;
    this.silence = 0;
    this.timeLeft = CFG.startTime;
    this.elapsed = 0;
    this.hits = 0;
    this.misses = 0;
    this.flash = 0;
    this.phaseFlash = 0;
    this.banner = null;
    this.rings = [];
    this.texts = [];
    this.mosquitoes = [];
    for (let i = 0; i < CFG.baseMosquitoes; i++) this.mosquitoes.push(this.spawn());

    this.overlay.hidden = true;
    this.overlay.classList.remove('paused');
    this.hud.hidden = false;
    this.last = performance.now();
    this.updateHud();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.sfx.pause();

    this.ovTitle.textContent = 'Пауза ⏸';
    this.ovText.textContent =
      'Таймер и комары замерли. Нажми Esc или P, чтобы продолжить.';
    this.ovStats.textContent =
      `Тишина: ${Math.floor(this.silence)}% · Осталось: ${Math.max(0, this.timeLeft).toFixed(1)} с · Фаза ${this.phase}`;
    this.setButtons('pause');
    this.overlay.classList.add('paused');
    this.overlay.hidden = false;
    this.resumeBtn.focus();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.last = performance.now(); // чтобы не было скачка времени после паузы
    this.overlay.hidden = true;
    this.overlay.classList.remove('paused');
    this.resumeBtn.blur();
    this.sfx.resume();
  }

  private finish(won: boolean): void {
    this.state = won ? 'won' : 'lost';
    this.hud.hidden = true;
    this.banner = null;
    this.overlay.hidden = false;
    this.overlay.classList.remove('paused');
    this.setButtons('start');

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
      this.ovText.textContent =
        this.phase === 2
          ? 'Во второй фазе комары оказались слишком живучими. Время вышло.'
          : 'Время вышло, а комары всё ещё звенят над ухом.';
      this.ovStats.textContent =
        `Тишина: ${Math.floor(this.silence)}% · Фаза: ${this.phase} · Попаданий: ${this.hits} · Промахов: ${this.misses}`;
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

  // ---------------------------------------------------------- mosquitoes

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

    const m: Mosquito = {
      x,
      y,
      vx: 0,
      vy: 0,
      r,
      turnIn: 0,
      boostLeft: 0,
      wing: rand(0, 6),
      angry: false,
      hp: 1,
      maxHp: 1,
      wobble: rand(0, 6),
      hurt: 0,
      rage: 0,
    };
    if (this.phase === 2) this.makeAngry(m);
    else this.retarget(m);
    return m;
  }

  /** Превращает комара во вторую фазу: больше жизней, быстрее, виляет. */
  private makeAngry(m: Mosquito): void {
    m.angry = true;
    m.hp = m.maxHp = CFG.p2.hp;
    m.rage = 0.8;
    this.retarget(m);
  }

  /** Комар внезапно выбирает новый курс и скорость (иногда — с рывком). */
  private retarget(m: Mosquito): void {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(CFG.speedMin, CFG.speedMax) * this.speedMul() * (m.angry ? CFG.p2.speedMul : 1);
    m.vx = Math.cos(angle) * speed;
    m.vy = Math.sin(angle) * speed;
    m.turnIn = rand(CFG.turnMin, CFG.turnMax) * (m.angry ? CFG.p2.turnMul : 1);
    const chance = m.angry ? CFG.p2.boostChance : CFG.boostChance;
    m.boostLeft = Math.random() < chance ? CFG.boostTime : 0;
  }

  private updateMosquito(m: Mosquito, dt: number): void {
    m.wing += dt * (m.angry ? 110 : 70);
    m.turnIn -= dt;
    if (m.boostLeft > 0) m.boostLeft -= dt;
    if (m.hurt > 0) m.hurt -= dt;
    if (m.rage > 0) m.rage -= dt;
    if (m.turnIn <= 0) this.retarget(m);

    const k = m.boostLeft > 0 ? CFG.boostMul : 1;
    m.x += m.vx * k * dt;
    m.y += m.vy * k * dt;

    // Фаза 2: комар «виляет» поперёк курса — по прямой его не поймать.
    if (m.angry) {
      m.wobble += dt * CFG.p2.wobbleFreq;
      const sp = Math.hypot(m.vx, m.vy) || 1;
      const side = Math.cos(m.wobble) * CFG.p2.wobbleAmp;
      m.x += (-m.vy / sp) * side * dt;
      m.y += (m.vx / sp) * side * dt;
    }

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

  private enterPhase2(): void {
    this.phase = 2;
    this.timeLeft += CFG.phase2Bonus;
    for (const m of this.mosquitoes) this.makeAngry(m);

    this.banner = {
      title: 'Фаза 2: комары озверели!',
      sub: `+${CFG.phase2Bonus} с · по ${CFG.p2.hp} попадания · промах −${CFG.p2.missPenalty} с`,
      age: 0,
    };
    this.phaseFlash = 0.6;
    this.pulseTimer('bonus');
    this.sfx.phase();
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
    m.hp -= 1;
    const killed = m.hp <= 0;

    // Фаза 1: любой комар гибнет с одного клика. Фаза 2: первый клик ранит, второй добивает.
    const gain = !m.angry ? CFG.hitGain : killed ? CFG.p2.killGain : CFG.p2.woundGain;
    let label = `+${gain}%`;

    if (killed) {
      this.mosquitoes.splice(index, 1);
      this.hits++;
      if (m.angry) {
        this.timeLeft += CFG.p2.killTimeBonus;
        label += ` · +${CFG.p2.killTimeBonus} с`;
        this.pulseTimer('bonus');
      }
      this.sfx.hit();
    } else {
      m.hurt = 0.35;
      this.retarget(m);
      m.boostLeft = CFG.boostTime; // раненый комар в панике делает рывок
      this.sfx.wound();
    }

    const color = killed ? '#7fd4c1' : '#ffb703';
    this.silence = Math.min(100, this.silence + gain);
    this.rings.push({ x: m.x, y: m.y, age: 0, color });
    this.texts.push({ x: m.x, y: m.y - 10, age: 0, text: label, color });

    if (this.silence >= 100) {
      this.updateHud();
      this.finish(true);
      return;
    }
    if (this.phase === 1 && this.silence >= CFG.phase2At) this.enterPhase2();

    while (this.mosquitoes.length < this.targetCount()) this.mosquitoes.push(this.spawn());
    this.updateHud();
  }

  private onMiss(x: number, y: number): void {
    const penalty = this.phase === 2 ? CFG.p2.missPenalty : CFG.missPenalty;
    this.misses++;
    this.timeLeft -= penalty;
    this.flash = 0.35;
    this.rings.push({ x, y, age: 0, color: '#ff5d5d' });
    this.texts.push({ x, y: y - 10, age: 0, text: `−${penalty} с`, color: '#ff5d5d' });
    this.sfx.miss();
    this.pulseTimer('penalty');

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.updateHud();
      this.finish(false);
      return;
    }
    this.updateHud();
  }

  /** Перезапуск CSS-анимации таймера (штраф или бонус). */
  private pulseTimer(kind: 'penalty' | 'bonus'): void {
    this.timerEl.classList.remove('penalty', 'bonus');
    void this.timerEl.offsetWidth;
    this.timerEl.classList.add(kind);
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
    // На паузе всё замирает: комары, таймер, эффекты.
    if (this.state === 'paused') return;

    for (const m of this.mosquitoes) this.updateMosquito(m, dt);

    for (const r of this.rings) r.age += dt;
    for (const t of this.texts) {
      t.age += dt;
      t.y -= 45 * dt;
    }
    this.rings = this.rings.filter((r) => r.age < 0.45);
    this.texts = this.texts.filter((t) => t.age < 0.8);
    this.flash = Math.max(0, this.flash - dt);
    this.phaseFlash = Math.max(0, this.phaseFlash - dt);
    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= CFG.bannerTime) this.banner = null;
    }

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
    this.barEl.classList.toggle('p2', this.phase === 2);
    this.phaseEl.textContent = `Фаза ${this.phase}`;
    this.phaseEl.classList.toggle('p2', this.phase === 2);
    const s = this.silence;
    this.faceEl.textContent = s >= 100 ? '😴' : s >= 75 ? '🥱' : s >= 50 ? '😪' : s >= 25 ? '😣' : '😫';
  }

  // ---------------------------------------------------------------- draw

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 70, 70, ${this.flash * 0.45})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (this.phaseFlash > 0) {
      ctx.fillStyle = `rgba(170, 90, 255, ${this.phaseFlash * 0.5})`;
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

    this.drawBanner();
  }

  private drawBanner(): void {
    const b = this.banner;
    if (!b) return;
    const ctx = this.ctx;

    const alpha = Math.max(0, Math.min(1, b.age / 0.2, (CFG.bannerTime - b.age) / 0.6));
    const pop = 1 + Math.max(0, 0.3 - b.age) * 1.5; // «удар» в начале
    const size = Math.min(34, this.width / 16);
    const font = 'ui-rounded, system-ui, sans-serif';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.width / 2, Math.max(150, this.height * 0.3));
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(14, 19, 48, 0.9)';

    ctx.font = `800 ${size}px ${font}`;
    ctx.strokeText(b.title, 0, 0);
    ctx.fillStyle = '#d9a8ff';
    ctx.fillText(b.title, 0, 0);

    ctx.font = `700 ${size * 0.55}px ${font}`;
    ctx.strokeText(b.sub, 0, size * 1.1);
    ctx.fillStyle = '#e8ebff';
    ctx.fillText(b.sub, 0, size * 1.1);
    ctx.restore();
  }

  private drawMosquito(m: Mosquito): void {
    const ctx = this.ctx;
    const boosting = m.boostLeft > 0;
    const flap = 0.5 + 0.5 * Math.sin(m.wing);
    const shake = m.hurt > 0 ? 2 : 0;

    ctx.save();
    ctx.translate(m.x + rand(-shake, shake), m.y + rand(-shake, shake));

    // Аура в момент превращения во вторую фазу.
    if (m.rage > 0) {
      const p = 1 - m.rage / 0.8;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#d17bff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, m.r + p * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Крылья: быстро «дрожат» по высоте.
    ctx.fillStyle = m.angry ? 'rgba(255, 190, 235, 0.6)' : 'rgba(205, 222, 255, 0.55)';
    const wingH = m.angry ? 0.34 : 0.28;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * m.r * 0.55, -m.r * 0.85, m.r * 0.8, m.r * (0.18 + wingH * flap), side * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Тело-кружок. Красный — комар в рывке, фиолетовый — фаза 2, рыжий — ранен.
    const wounded = m.angry && m.hp < m.maxHp;
    ctx.fillStyle = boosting ? '#ff5d5d' : wounded ? '#4a1a10' : m.angry ? '#2a1033' : '#1d1824';
    ctx.strokeStyle = boosting ? '#ffd0d0' : wounded ? '#ffb703' : m.angry ? '#d17bff' : '#8f86a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, m.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Глазки (у злых комаров — красные, с бровями).
    ctx.fillStyle = m.angry ? '#ff5d5d' : '#f2e9c9';
    ctx.beginPath();
    ctx.arc(-m.r * 0.35, -m.r * 0.15, m.r * 0.16, 0, Math.PI * 2);
    ctx.arc(m.r * 0.35, -m.r * 0.15, m.r * 0.16, 0, Math.PI * 2);
    ctx.fill();

    if (m.angry) {
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * m.r * 0.65, -m.r * 0.5);
        ctx.lineTo(side * m.r * 0.12, -m.r * 0.32);
        ctx.stroke();
      }

      // Полоски жизней под комаром.
      if (m.maxHp > 1) {
        for (let i = 0; i < m.maxHp; i++) {
          ctx.fillStyle = i < m.hp ? '#ffb703' : 'rgba(255, 255, 255, 0.22)';
          ctx.beginPath();
          ctx.arc((i - (m.maxHp - 1) / 2) * 9, m.r + 9, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }
}
