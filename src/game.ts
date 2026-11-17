import { Sfx } from './sfx';

type State = 'menu' | 'playing' | 'paused' | 'won' | 'lost';
type Phase = 1 | 2;
type Kind = 'normal' | 'frost' | 'bomb';

const CFG = {
  startTime: 60, // секунд на то, чтобы заснуть
  missPenalty: 2, // штраф за промах в фазе 1, сек
  hitGain: 4, // сколько % тишины даёт комар в фазе 1
  baseMosquitoes: 3, // обычных комаров на экране в начале
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
  bannerTime: 2.6, // сколько висит плашка «Фаза 2», сек
  p2: {
    hp: 2, // сколько попаданий выдерживает обычный комар
    woundGain: 2, // % тишины за первое попадание
    killGain: 3, // % тишины за добивание
    killTimeBonus: 2, // сек времени за добитого комара
    missPenalty: 3, // штраф за промах, сек
    speedMul: 1.15,
    turnMul: 0.7,
    boostChance: 0.5,
    wobbleAmp: 110, // боковое «виляние», px/s
    wobbleFreq: 9, // частота виляния, рад/с
  },
  // ---- Особые комары (фаза 2) -------------------------------------------
  special: {
    hp: 3, // и ледяной, и бомба выдерживают 3 клика
    woundGain: 1, // % за каждое промежуточное попадание
    killGain: 4, // % за добивание
    respawn: 6, // через сколько секунд появляется новый
    radiusMin: 22,
    radiusMax: 26,
    speedMul: 0.8, // особые чуть медленнее — их надо ловить
    turnMul: 1.2,
    boostChance: 0.15,
    wobbleAmp: 45,
    slowFactor: 0.3, // ледяной: скорость всех ×0.3 (−70%)
    slowTime: 4, // длительность замедления, сек
    bombRadius: 200, // радиус взрыва, px
  },
  win: {
    popStart: 0.25, // когда начинают рассыпаться комары
    popDelay: 0.13, // пауза между «хлопками»
    moonAt: 0.9, // когда восходит луна
    starsAt: 1.2, // когда проявляются звёзды
    overlayPad: 1.25, // пауза перед карточкой после последнего хлопка
  },
} as const;

interface Mosquito {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  turnIn: number;
  boostLeft: number;
  wing: number;
  angry: boolean;
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
  life: number;
  size: number;
  color: string;
}

interface FloatText {
  x: number;
  y: number;
  age: number;
  life: number;
  text: string;
  color: string;
}

interface Banner {
  title: string;
  sub: string;
  age: number;
}

type ParticleShape = 'dot' | 'spark' | 'flake' | 'firefly' | 'streak';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  shape: ParticleShape;
  grav: number;
}

interface WinPop {
  m: Mosquito;
  delay: number;
  fired: boolean;
}

interface WinFx {
  age: number;
  pops: WinPop[];
  overlayAt: number;
  shown: boolean;
  moonPlayed: boolean;
}

const TAU = Math.PI * 2;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Не найден элемент #${id}`);
  return el as T;
}

// --------------------------------------------------------------- SVG-арт
// Лицо спящего: 5 стадий от «бешенство» до «уснул». Без эмоджи.
const FACES: string[] = [
  // 0 — комары бесят
  `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="20" cy="23" r="13.5" fill="rgba(242,233,201,.08)"/>
    <circle cx="14.8" cy="21" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="25.2" cy="21" r="1.8" fill="currentColor" stroke="none"/>
    <path d="M14 29l3-2 3 2 3-2 3 2" stroke="#ff5d5d"/>
    <path d="M29.5 6.5l3.5 3.5M33 6.5l-3.5 3.5" stroke="#ff5d5d" stroke-width="1.8"/>
    <path d="M7 6c1.8 2.7 2.7 4.1 2.7 5.4a2.7 2.7 0 1 1-5.4 0C4.3 10.1 5.2 8.7 7 6z" fill="#6ee7ff" stroke="none" opacity=".9"/>
  </svg>`,
  // 1 — вымотан
  `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="20" cy="23" r="13.5" fill="rgba(242,233,201,.08)"/>
    <path d="M12.6 20.5q2.2 2 4.4 0M23 20.5q2.2 2 4.4 0"/>
    <path d="M14.5 28.5q2.7 1.6 5.5 0q2.7-1.6 5.5 0"/>
    <path d="M32 8c1.4 2.1 2.1 3.2 2.1 4.2a2.1 2.1 0 1 1-4.2 0c0-1 .7-2.1 2.1-4.2z" fill="#6ee7ff" stroke="none" opacity=".65"/>
  </svg>`,
  // 2 — клюёт носом
  `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="20" cy="23" r="13.5" fill="rgba(242,233,201,.08)"/>
    <path d="M12.6 20.5q2.2 2.4 4.4 0M23 20.5q2.2 2.4 4.4 0"/>
    <ellipse cx="20" cy="28.5" rx="2.5" ry="3" fill="rgba(242,233,201,.12)"/>
    <text x="30" y="11" font-size="9" font-weight="800" fill="#9fd8ff" stroke="none" class="z z1">z</text>
  </svg>`,
  // 3 — почти уснул
  `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="20" cy="23" r="13.5" fill="rgba(242,233,201,.08)"/>
    <path d="M12.6 21q2.2 2.2 4.4 0M23 21q2.2 2.2 4.4 0"/>
    <path d="M15.5 27.5q4.5 3.4 9 0"/>
    <text x="28" y="13" font-size="8" font-weight="800" fill="#9fd8ff" stroke="none" class="z z1">z</text>
    <text x="33" y="7" font-size="10" font-weight="800" fill="#9fd8ff" stroke="none" class="z z2">z</text>
  </svg>`,
  // 4 — уснул
  `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="20" cy="23" r="13.5" fill="rgba(242,233,201,.08)"/>
    <path d="M12.6 21q2.2 2.2 4.4 0M23 21q2.2 2.2 4.4 0"/>
    <path d="M15.5 27.5q4.5 3.4 9 0"/>
    <text x="26" y="15" font-size="8" font-weight="800" fill="#9fd8ff" stroke="none" class="z z1">z</text>
    <text x="31" y="9" font-size="10" font-weight="800" fill="#9fd8ff" stroke="none" class="z z2">z</text>
    <text x="36" y="4" font-size="12" font-weight="800" fill="#9fd8ff" stroke="none" class="z z3">z</text>
    <path d="M7 8l.9 2.6L10.5 11.5l-2.6.9L7 15l-.9-2.6L3.5 11.5l2.6-.9z" fill="#f2e9c9" stroke="none" opacity=".8"/>
  </svg>`,
];

// Эмблемы карточки: меню / пауза / победа / поражение.
const EMBLEMS: Record<'menu' | 'pause' | 'won' | 'lost', string> = {
  menu: `<svg viewBox="0 0 80 80">
    <defs>
      <radialGradient id="g-menu" cx="35%" cy="28%" r="80%">
        <stop offset="0%" stop-color="#2c3a7e"/><stop offset="100%" stop-color="#131a44"/>
      </radialGradient>
      <mask id="m-menu"><rect width="80" height="80" fill="#fff"/><circle cx="60" cy="19" r="8.5" fill="#000"/></mask>
    </defs>
    <circle cx="40" cy="40" r="38" fill="url(#g-menu)" stroke="rgba(255,255,255,.14)"/>
    <circle cx="55" cy="23" r="10" fill="#f2e9c9" opacity=".9" mask="url(#m-menu)"/>
    <path d="M20 16l1.1 3.4 3.4 1.1-3.4 1.1L20 25l-1.1-3.4-3.4-1.1 3.4-1.1z" fill="#f2e9c9" opacity=".8"/>
    <path d="M62 56l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="#6ee7ff" opacity=".8"/>
    <g>
      <ellipse cx="30" cy="36" rx="11" ry="4.6" fill="rgba(205,222,255,.4)" transform="rotate(-32 30 36)"/>
      <ellipse cx="50" cy="36" rx="11" ry="4.6" fill="rgba(205,222,255,.4)" transform="rotate(32 50 36)"/>
      <path d="M34 46q-6 2-8 7M46 46q6 2 8 7M35 50q-4 3-4.5 7M45 50q4 3 4.5 7" fill="none" stroke="#9a8fb8" stroke-width="1.4" stroke-linecap="round"/>
      <ellipse cx="40" cy="47" rx="5.6" ry="9.5" fill="#241f30" stroke="#9a8fb8" stroke-width="1.6"/>
      <path d="M36.5 45h7M36.8 49h6.4" stroke="#9a8fb8" stroke-width="1.1" opacity=".7"/>
      <circle cx="40" cy="34" r="4.2" fill="#241f30" stroke="#9a8fb8" stroke-width="1.6"/>
      <line x1="40" y1="29.5" x2="40" y2="22" stroke="#f2e9c9" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="38.4" cy="33.4" r="1" fill="#f2e9c9"/><circle cx="41.6" cy="33.4" r="1" fill="#f2e9c9"/>
    </g>
  </svg>`,
  pause: `<svg viewBox="0 0 80 80">
    <defs>
      <radialGradient id="g-pause" cx="35%" cy="28%" r="80%">
        <stop offset="0%" stop-color="#2c3a7e"/><stop offset="100%" stop-color="#131a44"/>
      </radialGradient>
    </defs>
    <circle cx="40" cy="40" r="38" fill="url(#g-pause)" stroke="rgba(255,255,255,.14)"/>
    <circle cx="40" cy="40" r="29" fill="none" stroke="rgba(110,231,255,.45)" stroke-width="1.6" stroke-dasharray="4 7" stroke-linecap="round"/>
    <rect x="30" y="26" width="7" height="28" rx="3.4" fill="#f2e9c9"/>
    <rect x="43" y="26" width="7" height="28" rx="3.4" fill="#f2e9c9"/>
  </svg>`,
  won: `<svg viewBox="0 0 80 80">
    <defs>
      <radialGradient id="g-won" cx="40%" cy="30%" r="85%">
        <stop offset="0%" stop-color="#232f6e"/><stop offset="100%" stop-color="#0b1030"/>
      </radialGradient>
      <mask id="m-won"><rect width="80" height="80" fill="#fff"/><circle cx="47" cy="35" r="17" fill="#000"/></mask>
    </defs>
    <circle cx="40" cy="40" r="38" fill="url(#g-won)" stroke="rgba(242,233,201,.25)"/>
    <circle cx="40" cy="42" r="20" fill="#f2e9c9" mask="url(#m-won)"/>
    <path d="M22 20l1.2 3.6 3.6 1.2-3.6 1.2L22 29.6l-1.2-3.6-3.6-1.2 3.6-1.2z" fill="#f2e9c9" opacity=".9"/>
    <path d="M60 52l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="#6ee7ff" opacity=".9"/>
    <path d="M25 58l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="#7fd4c1" opacity=".8"/>
    <text x="50" y="28" font-size="10" font-weight="800" fill="#9fd8ff" class="z z1">z</text>
    <text x="57" y="19" font-size="12" font-weight="800" fill="#9fd8ff" class="z z2">z</text>
    <text x="64" y="10" font-size="14" font-weight="800" fill="#9fd8ff" class="z z3">z</text>
  </svg>`,
  lost: `<svg viewBox="0 0 80 80">
    <defs>
      <radialGradient id="g-lost" cx="40%" cy="30%" r="85%">
        <stop offset="0%" stop-color="#3a1230"/><stop offset="100%" stop-color="#160b26"/>
      </radialGradient>
    </defs>
    <circle cx="40" cy="40" r="38" fill="url(#g-lost)" stroke="rgba(255,107,107,.3)"/>
    <path d="M17 43Q40 26 63 43" fill="none" stroke="#ff8a8a" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M17 43Q40 55 63 43" fill="none" stroke="#ff8a8a" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="40" cy="43" r="8" fill="#ff5d5d"/>
    <circle cx="40" cy="43" r="3.6" fill="#160b26"/>
    <circle cx="43" cy="40" r="1.5" fill="#fff" opacity=".9"/>
    <path d="M24 46l-4 3M56 46l4 3" stroke="#ff8a8a" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M52 22q4 3 4 8M57 18q6 4.5 6 12M62 14q8 6 8 16" fill="none" stroke="#d17bff" stroke-width="2" stroke-linecap="round" opacity=".85"/>
    <path d="M22 24l8 4" stroke="#ff8a8a" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,
};

export class Game {
  private readonly canvas = $<HTMLCanvasElement>('game');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud = $('hud');
  private readonly timerEl = $('timer');
  private readonly barEl = $('bar-fill');
  private readonly barMarkEl = $('bar-mark');
  private readonly phaseEl = $('phase');
  private readonly faceEl = $('face');
  private readonly pauseBtn = $<HTMLButtonElement>('pause');
  private readonly muteBtn = $<HTMLButtonElement>('mute');
  private readonly overlay = $('overlay');
  private readonly ovIcon = $('ov-icon');
  private readonly ovTitle = $('ov-title');
  private readonly ovText = $('ov-text');
  private readonly ovStats = $('ov-stats');
  private readonly legendEl = $('legend');
  private readonly hintEl = $('menu-hint');
  private readonly startBtn = $<HTMLButtonElement>('start');
  private readonly startLabel = $('start-label');
  private readonly resumeBtn = $<HTMLButtonElement>('resume');
  private readonly restartBtn = $<HTMLButtonElement>('restart');
  private readonly chipSlow = $('chip-slow');
  private readonly chipSlowT = $('chip-slow-t');
  private readonly chipFrost = $('chip-frost');
  private readonly chipFrostT = $('chip-frost-t');
  private readonly chipBomb = $('chip-bomb');
  private readonly chipBombT = $('chip-bomb-t');
  private readonly sfx = new Sfx();
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private width = window.innerWidth;
  private height = window.innerHeight;
  private state: State = 'menu';
  private phase: Phase = 1;
  private mosquitoes: Mosquito[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private particles: Particle[] = [];
  private banner: Banner | null = null;
  private winFx: WinFx | null = null;

  private silence = 0;
  private timeLeft: number = CFG.startTime;
  private elapsed = 0;
  private hits = 0;
  private misses = 0;

  private slowLeft = 0; // остаток замедления от ледяного комара
  private frostIn: number | null = null; // респавн ледяного
  private bombIn: number | null = null; // респавн бомбы

  private flash = 0;
  private phaseFlash = 0;
  private frostFlash = 0;
  private blastFlash = 0;
  private shake = 0;
  private snowTick = 0;
  private nextStreak = 1.4;
  private faceStage = -1;
  private last = performance.now();

  // Звёздная пыль: в игре — едва заметная, при победе — полное небо.
  private readonly stars = Array.from({ length: 90 }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: rand(0.6, 1.9),
    ph: rand(0, TAU),
    sp: rand(0.6, 2.2),
  }));

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D не поддерживается');
    this.ctx = ctx;
    this.resize();
    this.ovIcon.innerHTML = EMBLEMS.menu;
    this.faceEl.innerHTML = FACES[0];
    this.faceStage = 0;

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
      this.muteBtn.classList.toggle('muted', this.sfx.muted);
      this.muteBtn.setAttribute('aria-pressed', String(this.sfx.muted));
      this.muteBtn.setAttribute('aria-label', this.sfx.muted ? 'Включить звук' : 'Выключить звук');
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
    for (const m of this.mosquitoes) {
      m.x = Math.min(Math.max(m.x, m.r), this.width - m.r);
      m.y = Math.min(Math.max(m.y, m.r), this.height - m.r);
    }
  }

  // ------------------------------------------------------------- state
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
    this.frostFlash = 0;
    this.blastFlash = 0;
    this.shake = 0;
    this.slowLeft = 0;
    this.frostIn = null;
    this.bombIn = null;
    this.banner = null;
    this.winFx = null;
    this.rings = [];
    this.texts = [];
    this.particles = [];
    this.mosquitoes = [];
    for (let i = 0; i < CFG.baseMosquitoes; i++) this.mosquitoes.push(this.spawn());
    this.overlay.hidden = true;
    this.overlay.classList.remove('paused', 'won');
    this.hud.hidden = false;
    this.last = performance.now();
    this.updateHud();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.sfx.pause();
    this.ovIcon.innerHTML = EMBLEMS.pause;
    this.ovTitle.textContent = 'Пауза';
    this.ovText.textContent = 'Таймер и комары замерли. Нажми Esc или P, чтобы продолжить.';
    this.ovStats.textContent = `Тишина: ${Math.floor(this.silence)}% · Осталось: ${Math.max(0, this.timeLeft).toFixed(1)} с · Фаза ${this.phase}`;
    this.legendEl.hidden = true;
    this.hintEl.hidden = true;
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
    this.legendEl.hidden = true;
    this.hintEl.hidden = true;
    this.setButtons('start');

    if (won) {
      // Карточку показываем не сразу — сначала играем сцену засыпания.
      const time = this.elapsed;
      const best = this.saveBest(time);
      this.ovIcon.innerHTML = EMBLEMS.won;
      this.ovTitle.textContent = 'Тишина. Он уснул';
      this.ovText.textContent =
        'Комары рассыпались звёздной пылью, и над кроватью взошла луна. Спи спокойно.';
      this.ovStats.textContent =
        `Время: ${time.toFixed(1)} с · Промахов: ${this.misses}` +
        (best !== null ? ` · Рекорд: ${best.toFixed(1)} с` : '');
      this.startLabel.textContent = 'Ещё раз';

      const pops: WinPop[] = this.mosquitoes.map((m, i) => ({
        m,
        delay: CFG.win.popStart + i * CFG.win.popDelay,
        fired: false,
      }));
      const lastPop = CFG.win.popStart + Math.max(0, pops.length - 1) * CFG.win.popDelay;
      this.winFx = {
        age: 0,
        pops,
        overlayAt: Math.max(2.4, lastPop + CFG.win.overlayPad),
        shown: false,
        moonPlayed: false,
      };
      this.overlay.hidden = true;
    } else {
      this.sfx.lose();
      this.ovIcon.innerHTML = EMBLEMS.lost;
      this.ovTitle.textContent = 'Не уснул';
      this.ovText.textContent =
        this.phase === 2
          ? 'Комары оказались слишком живучими. Ледяной и бомба решают: бей их первыми.'
          : 'Время вышло, а комары всё ещё звенят над ухом.';
      this.ovStats.textContent = `Тишина: ${Math.floor(this.silence)}% · Фаза: ${this.phase} · Попаданий: ${this.hits} · Промахов: ${this.misses}`;
      this.startLabel.textContent = 'Попробовать снова';
      this.overlay.hidden = false;
      this.overlay.classList.remove('paused', 'won');
      this.startBtn.focus();
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

  private bombRadius(): number {
    return Math.min(CFG.special.bombRadius, Math.min(this.width, this.height) * 0.45);
  }

  private spawn(kind: Kind = 'normal'): Mosquito {
    const special = kind !== 'normal';
    const r = special
      ? rand(CFG.special.radiusMin, CFG.special.radiusMax)
      : rand(CFG.radiusMin, CFG.radiusMax);
    const side = Math.floor(Math.random() * 4);
    let x = rand(r, this.width - r);
    let y = rand(r, this.height - r);
    if (side === 0) y = r;
    else if (side === 1) y = this.height - r;
    else if (side === 2) x = r;
    else x = this.width - r;

    const m: Mosquito = {
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      r,
      turnIn: 0,
      boostLeft: 0,
      wing: rand(0, 6),
      angry: this.phase === 2,
      hp: 1,
      maxHp: 1,
      wobble: rand(0, 6),
      hurt: 0,
      rage: 0,
    };
    if (this.phase === 2) {
      m.hp = m.maxHp = special ? CFG.special.hp : CFG.p2.hp;
      m.rage = 0.8;
    }
    this.retarget(m);
    return m;
  }

  /** Превращает обычного комара во вторую фазу. */
  private makeAngry(m: Mosquito): void {
    m.angry = true;
    m.hp = m.maxHp = CFG.p2.hp;
    m.rage = 0.8;
    this.retarget(m);
  }

  private spawnSpecial(kind: 'frost' | 'bomb'): void {
    const m = this.spawn(kind);
    this.mosquitoes.push(m);
    this.texts.push({
      x: m.x,
      y: Math.max(24, m.y - m.r - 14),
      age: 0,
      life: 1.8,
      text: kind === 'frost' ? 'Ледяной' : 'Бомба',
      color: kind === 'frost' ? '#7fe3ff' : '#ff8a5c',
    });
    this.sfx.spawn();
  }

  /** Комар внезапно выбирает новый курс и скорость (иногда — с рывком). */
  private retarget(m: Mosquito): void {
    const special = m.kind !== 'normal';
    const angle = rand(0, TAU);
    const speed =
      rand(CFG.speedMin, CFG.speedMax) *
      this.speedMul() *
      (m.angry ? CFG.p2.speedMul : 1) *
      (special ? CFG.special.speedMul : 1);
    m.vx = Math.cos(angle) * speed;
    m.vy = Math.sin(angle) * speed;
    m.turnIn =
      rand(CFG.turnMin, CFG.turnMax) *
      (m.angry ? CFG.p2.turnMul : 1) *
      (special ? CFG.special.turnMul : 1);
    const chance = special
      ? CFG.special.boostChance
      : m.angry
        ? CFG.p2.boostChance
        : CFG.boostChance;
    m.boostLeft = Math.random() < chance ? CFG.boostTime : 0;
  }

  private updateMosquito(m: Mosquito, dt: number): void {
    // Ледяной комар замедляет всех: собственное «время» комара течёт медленнее.
    const mdt = dt * (this.slowLeft > 0 ? CFG.special.slowFactor : 1);
    m.wing += mdt * (m.angry ? 110 : 70);
    m.turnIn -= mdt;
    if (m.boostLeft > 0) m.boostLeft -= mdt;
    if (m.hurt > 0) m.hurt -= dt;
    if (m.rage > 0) m.rage -= dt;
    if (m.turnIn <= 0) this.retarget(m);

    const k = m.boostLeft > 0 ? CFG.boostMul : 1;
    m.x += m.vx * k * mdt;
    m.y += m.vy * k * mdt;

    // Фаза 2: комар «виляет» поперёк курса — по прямой его не поймать.
    if (m.angry) {
      m.wobble += mdt * CFG.p2.wobbleFreq;
      const sp = Math.hypot(m.vx, m.vy) || 1;
      const amp = m.kind === 'normal' ? CFG.p2.wobbleAmp : CFG.special.wobbleAmp;
      const side = Math.cos(m.wobble) * amp;
      m.x += (-m.vy / sp) * side * mdt;
      m.y += (m.vx / sp) * side * mdt;
    }

    // Следы особых комаров.
    if (m.kind === 'bomb' && Math.random() < dt * 5) {
      this.burst(m.x, m.y, '#ff8a5c', 1, 'spark', 60, 0.5, 2);
    }
    if (m.kind === 'frost' && Math.random() < dt * 3) {
      this.burst(m.x, m.y, '#9fe8ff', 1, 'flake', 25, 1.2, 2);
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

  private normalCount(): number {
    let n = 0;
    for (const m of this.mosquitoes) if (m.kind === 'normal') n++;
    return n;
  }

  private targetCount(): number {
    return CFG.baseMosquitoes + Math.floor(this.silence / CFG.extraPer);
  }

  private enterPhase2(): void {
    this.phase = 2;
    this.timeLeft += CFG.phase2Bonus;
    for (const m of this.mosquitoes) this.makeAngry(m);
    this.spawnSpecial('frost');
    this.spawnSpecial('bomb');
    this.banner = {
      title: 'Фаза 2: комары озверели!',
      sub: `+${CFG.phase2Bonus} с · обычные ×2 клика · особые ×3 · промах −${CFG.p2.missPenalty} с`,
      age: 0,
    };
    this.phaseFlash = 0.6;
    this.pulseTimer('bonus');
    this.sfx.phase();
  }

  // ---------------------------------------------------------------- input
  private onPointer(e: PointerEvent): void {
    // Клик во время победной сцены — промотать её к карточке.
    if (this.state === 'won' && this.winFx && !this.winFx.shown) {
      this.skipCelebration();
      return;
    }
    if (this.state !== 'playing') return;
    this.sfx.unlock();
    const x = e.clientX;
    const y = e.clientY;
    // Идём с конца — сверху лежит тот, кого нарисовали последним.
    for (let i = this.mosquitoes.length - 1; i >= 0; i--) {
      const m = this.mosquitoes[i];
      const reach = m.r + CFG.hitSlop;
      if ((m.x - x) ** 2 + (m.y - y) ** 2 <= reach * reach) {
        this.damage(i);
        return;
      }
    }
    this.onMiss(x, y);
  }

  /** Обрабатывает клик по комару и все последствия (включая цепной взрыв). */
  private damage(index: number): void {
    const m = this.mosquitoes[index];
    m.hp -= 1;
    let gained: number;

    if (m.hp > 0) {
      // Ранен: тряска, панический рывок, немного тишины.
      gained = m.kind === 'normal' ? CFG.p2.woundGain : CFG.special.woundGain;
      m.hurt = 0.35;
      this.retarget(m);
      m.boostLeft = CFG.boostTime;
      this.sfx.wound();
      this.rings.push({ x: m.x, y: m.y, age: 0, life: 0.45, size: 38, color: '#ffb703' });
      this.texts.push({ x: m.x, y: m.y - 10, age: 0, life: 0.8, text: `+${gained}%`, color: '#ffb703' });
      this.burst(m.x, m.y, '#ffb703', 6, 'spark', 160, 0.5, 2);
    } else {
      gained = this.killAt(index);
    }

    this.silence = Math.min(100, this.silence + gained);
    if (this.silence >= 100) {
      this.updateHud();
      this.finish(true);
      return;
    }
    if (this.phase === 1 && this.silence >= CFG.phase2At) this.enterPhase2();
    while (this.normalCount() < this.targetCount()) this.mosquitoes.push(this.spawn());
    this.updateHud();
  }

  /** Убирает комара, применяет его эффект. Возвращает суммарный % тишины. */
  private killAt(index: number): number {
    const m = this.mosquitoes[index];
    this.mosquitoes.splice(index, 1);
    this.hits++;
    let gained = 0;

    if (m.kind === 'normal') {
      gained = m.angry ? CFG.p2.killGain : CFG.hitGain;
      let label = `+${gained}%`;
      if (m.angry) {
        this.timeLeft += CFG.p2.killTimeBonus;
        label += ` · +${CFG.p2.killTimeBonus} с`;
        this.pulseTimer('bonus');
      }
      this.sfx.hit();
      this.rings.push({ x: m.x, y: m.y, age: 0, life: 0.45, size: 38, color: '#7fd4c1' });
      this.texts.push({ x: m.x, y: m.y - 10, age: 0, life: 0.8, text: label, color: '#7fd4c1' });
      this.burst(m.x, m.y, '#7fd4c1', 10, 'dot', 150, 0.6, 2.4);
    } else if (m.kind === 'frost') {
      gained = CFG.special.killGain;
      this.slowLeft = CFG.special.slowTime;
      this.frostIn = CFG.special.respawn;
      this.frostFlash = 0.5;
      this.sfx.freeze();
      this.rings.push({ x: m.x, y: m.y, age: 0, life: 0.6, size: 150, color: '#7fe3ff' });
      this.texts.push({
        x: m.x,
        y: m.y - 10,
        age: 0,
        life: 1.1,
        text: `+${gained}% · замедление`,
        color: '#7fe3ff',
      });
      this.burst(m.x, m.y, '#9fe8ff', 26, 'flake', 190, 1.1, 2.6);
    } else {
      // Бомба: взрыв убивает всех в радиусе (цепочкой, включая ледяного).
      gained = CFG.special.killGain;
      this.bombIn = CFG.special.respawn;
      this.blastFlash = 0.3;
      if (!this.reduceMotion) this.shake = 12;
      this.sfx.boom();
      const R = this.bombRadius();
      this.rings.push({ x: m.x, y: m.y, age: 0, life: 0.6, size: R, color: '#ff8a5c' });
      this.rings.push({ x: m.x, y: m.y, age: 0, life: 0.45, size: R * 0.55, color: '#ffd7a0' });
      this.texts.push({ x: m.x, y: m.y - 10, age: 0, life: 1.1, text: `+${gained}% · взрыв`, color: '#ff8a5c' });
      this.burst(m.x, m.y, '#ff8a5c', 40, 'spark', 320, 0.8, 2.6);
      this.burst(m.x, m.y, '#ffd7a0', 16, 'dot', 200, 0.7, 3);

      const victims: number[] = [];
      for (let i = 0; i < this.mosquitoes.length; i++) {
        const v = this.mosquitoes[i];
        if ((v.x - m.x) ** 2 + (v.y - m.y) ** 2 <= R * R) victims.push(i);
      }
      for (let i = victims.length - 1; i >= 0; i--) {
        gained += this.killAt(victims[i]);
      }
    }
    return gained;
  }

  private onMiss(x: number, y: number): void {
    const penalty = this.phase === 2 ? CFG.p2.missPenalty : CFG.missPenalty;
    this.misses++;
    this.timeLeft -= penalty;
    this.flash = 0.35;
    if (!this.reduceMotion) this.shake = Math.max(this.shake, 2.5);
    this.rings.push({ x, y, age: 0, life: 0.45, size: 38, color: '#ff5d5d' });
    this.texts.push({ x, y: y - 10, age: 0, life: 0.8, text: `−${penalty} с`, color: '#ff5d5d' });
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

  // ------------------------------------------------------------ particles
  private burst(
    x: number,
    y: number,
    color: string,
    n: number,
    shape: ParticleShape,
    speed: number,
    life: number,
    size: number,
    grav = 0,
  ): void {
    const count = this.reduceMotion ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = speed * rand(0.3, 1);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        age: 0,
        life: life * rand(0.6, 1.2),
        size: size * rand(0.7, 1.3),
        color,
        shape,
        grav,
      });
    }
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420);
  }

  // ------------------------------------------------------------- win scene
  private firePop(pop: WinPop, silent: boolean, step: number): void {
    pop.fired = true;
    const i = this.mosquitoes.indexOf(pop.m);
    if (i >= 0) this.mosquitoes.splice(i, 1);
    const color =
      pop.m.kind === 'frost' ? '#7fe3ff' : pop.m.kind === 'bomb' ? '#ff8a5c' : '#f2e9c9';
    this.burst(pop.m.x, pop.m.y, color, 10, 'firefly', 60, 2.4, 2.2);
    this.burst(pop.m.x, pop.m.y, '#ffffff', 5, 'spark', 140, 0.4, 1.8);
    this.rings.push({ x: pop.m.x, y: pop.m.y, age: 0, life: 0.5, size: 46, color });
    if (!silent) this.sfx.chime(step);
  }

  private skipCelebration(): void {
    const fx = this.winFx;
    if (!fx) return;
    let step = 0;
    for (const pop of fx.pops) {
      if (!pop.fired) this.firePop(pop, true, step++);
    }
    fx.age = Math.max(fx.age, fx.overlayAt);
  }

  private showWinOverlay(): void {
    const fx = this.winFx;
    if (!fx || fx.shown) return;
    fx.shown = true;
    this.overlay.classList.add('won');
    this.overlay.hidden = false;
    this.startBtn.focus();
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

    if (this.state === 'won') {
      // Победная сцена: комары замирают в воздухе и по очереди рассыпаются.
      for (const m of this.mosquitoes) m.wing += dt * 40;
      const fx = this.winFx;
      if (fx) {
        fx.age += dt;
        let step = 0;
        for (const pop of fx.pops) {
          if (pop.fired) {
            step++;
          } else if (fx.age >= pop.delay) {
            this.firePop(pop, false, step++);
          }
        }
        if (!fx.moonPlayed && fx.age >= CFG.win.moonAt) {
          fx.moonPlayed = true;
          this.sfx.moon();
        }
        this.nextStreak -= dt;
        if (this.nextStreak <= 0 && fx.age >= CFG.win.starsAt) {
          this.nextStreak = rand(1.6, 2.8);
          if (!this.reduceMotion) {
            this.particles.push({
              x: rand(this.width * 0.3, this.width * 0.95),
              y: rand(20, this.height * 0.3),
              vx: -rand(320, 520),
              vy: rand(120, 200),
              age: 0,
              life: 0.7,
              size: 2,
              color: '#ffffff',
              shape: 'streak',
              grav: 0,
            });
          }
        }
        if (!fx.shown && fx.age >= fx.overlayAt) this.showWinOverlay();
      }
    } else {
      for (const m of this.mosquitoes) this.updateMosquito(m, dt);
    }

    for (const r of this.rings) r.age += dt;
    for (const t of this.texts) {
      t.age += dt;
      t.y -= 45 * dt;
    }
    this.rings = this.rings.filter((r) => r.age < r.life);
    this.texts = this.texts.filter((t) => t.age < t.life);

    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.shape === 'flake' || p.shape === 'firefly') {
        p.x += Math.sin((p.age + p.life) * 4) * 14 * dt;
      }
      if (p.shape === 'firefly') p.vy -= 14 * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);

    this.flash = Math.max(0, this.flash - dt);
    this.phaseFlash = Math.max(0, this.phaseFlash - dt);
    this.frostFlash = Math.max(0, this.frostFlash - dt);
    this.blastFlash = Math.max(0, this.blastFlash - dt);
    this.shake = Math.max(0, this.shake - dt * 30);

    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= CFG.bannerTime) this.banner = null;
    }

    if (this.state === 'playing') {
      this.elapsed += dt;
      this.timeLeft -= dt;

      if (this.slowLeft > 0) {
        this.slowLeft = Math.max(0, this.slowLeft - dt);
        // Лёгкий снегопад, пока действует замедление.
        this.snowTick -= dt;
        if (this.snowTick <= 0 && !this.reduceMotion) {
          this.snowTick = 0.12;
          for (let i = 0; i < 2; i++) {
            this.particles.push({
              x: rand(0, this.width),
              y: -8,
              vx: rand(-10, 10),
              vy: rand(50, 90),
              age: 0,
              life: rand(2, 3),
              size: rand(1.5, 3),
              color: '#9fe8ff',
              shape: 'flake',
              grav: 0,
            });
          }
        }
      }

      // Респавн особых комаров: ровно по одному на экране.
      if (this.phase === 2) {
        if (this.frostIn !== null) {
          this.frostIn -= dt;
          if (this.frostIn <= 0) {
            this.frostIn = null;
            this.spawnSpecial('frost');
          }
        }
        if (this.bombIn !== null) {
          this.bombIn -= dt;
          if (this.bombIn <= 0) {
            this.bombIn = null;
            this.spawnSpecial('bomb');
          }
        }
      }

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
    this.timerEl.classList.toggle('danger', this.timeLeft <= 10);
    this.barEl.style.width = `${this.silence}%`;
    this.barEl.classList.toggle('p2', this.phase === 2);
    this.phaseEl.textContent = `Фаза ${this.phase}`;
    this.phaseEl.classList.toggle('p2', this.phase === 2);

    const s = this.silence;
    const stage = s >= 100 ? 4 : s >= 75 ? 3 : s >= 50 ? 2 : s >= 25 ? 1 : 0;
    if (stage !== this.faceStage) {
      this.faceStage = stage;
      this.faceEl.innerHTML = FACES[stage];
    }

    this.chipSlow.hidden = this.slowLeft <= 0;
    if (this.slowLeft > 0) this.chipSlowT.textContent = `${this.slowLeft.toFixed(1)} с`;
    this.chipFrost.hidden = this.frostIn === null;
    if (this.frostIn !== null) this.chipFrostT.textContent = `${Math.max(0, this.frostIn).toFixed(1)} с`;
    this.chipBomb.hidden = this.bombIn === null;
    if (this.bombIn !== null) this.chipBombT.textContent = `${Math.max(0, this.bombIn).toFixed(1)} с`;
  }

  // ---------------------------------------------------------------- draw
  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 70, 70, ${this.flash * 0.45})`;
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
    }
    if (this.phaseFlash > 0) {
      ctx.fillStyle = `rgba(170, 90, 255, ${this.phaseFlash * 0.5})`;
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
    }
    if (this.blastFlash > 0) {
      ctx.fillStyle = `rgba(255, 215, 180, ${this.blastFlash * 0.55})`;
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
    }
    if (this.frostFlash > 0) {
      ctx.fillStyle = `rgba(110, 231, 255, ${this.frostFlash * 0.3})`;
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
    }

    this.drawStars();

    // Победа: комната плавно погружается в ночь.
    if (this.winFx) {
      const dim = Math.min(0.5, Math.max(0, this.winFx.age - 0.15) * 0.45);
      ctx.fillStyle = `rgba(6, 8, 24, ${dim})`;
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
    }
    if (this.slowLeft > 0) {
      ctx.fillStyle = 'rgba(110, 231, 255, 0.05)';
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
    }

    for (const m of this.mosquitoes) {
      if (m.kind === 'bomb') this.drawBlastZone(m);
    }
    for (const m of this.mosquitoes) this.drawMosquito(m);

    this.drawParticles();

    for (const r of this.rings) {
      const p = r.age / r.life;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + p * r.size, 0, TAU);
      ctx.stroke();
    }

    ctx.font = '800 20px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = 1 - t.age / t.life;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    if (this.winFx) this.drawMoon();
    this.drawBanner();
    ctx.restore();
  }

  private drawStars(): void {
    const ctx = this.ctx;
    const fx = this.winFx;
    const ramp = fx ? Math.min(1, Math.max(0, (fx.age - CFG.win.starsAt) / 1.2)) : 0;
    const base = 0.1 + ramp * 0.75;
    const now = performance.now() / 1000;
    for (const st of this.stars) {
      const tw = 0.6 + 0.4 * Math.sin(now * st.sp + st.ph);
      const a = base * tw;
      if (a <= 0.01) continue;
      const x = st.x * this.width;
      const y = st.y * this.height;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#f2e9c9';
      ctx.beginPath();
      ctx.arc(x, y, st.s * (1 + ramp * 0.4), 0, TAU);
      ctx.fill();
      if (ramp > 0.5 && st.s > 1.5) {
        ctx.strokeStyle = '#f2e9c9';
        ctx.lineWidth = 1;
        ctx.globalAlpha = a * 0.7;
        const l = st.s * 4;
        ctx.beginPath();
        ctx.moveTo(x - l, y);
        ctx.lineTo(x + l, y);
        ctx.moveTo(x, y - l);
        ctx.lineTo(x, y + l);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawMoon(): void {
    const fx = this.winFx;
    if (!fx || fx.age < CFG.win.moonAt) return;
    const ctx = this.ctx;
    const t = Math.min(1, (fx.age - CFG.win.moonAt) / 1.2);
    const e = easeOut(t);
    const r = Math.min(64, Math.max(36, Math.min(this.width, this.height) * 0.09));
    const mx = this.width * 0.72;
    const my = this.height * 0.3 - e * this.height * 0.06 + (1 - e) * 50;

    ctx.save();
    ctx.globalAlpha = e;
    const glow = ctx.createRadialGradient(mx, my, r * 0.4, mx, my, r * 3);
    glow.addColorStop(0, 'rgba(242, 233, 201, 0.22)');
    glow.addColorStop(1, 'rgba(242, 233, 201, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(mx, my, r * 3, 0, TAU);
    ctx.fill();

    const pulse = 0.5 + 0.5 * Math.sin(fx.age * 1.4);
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = e * (0.1 - i * 0.025) * (0.7 + pulse * 0.3);
      ctx.strokeStyle = '#f2e9c9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, r * (1.5 + i * 0.5 + pulse * 0.1), 0, TAU);
      ctx.stroke();
    }

    // Полумесяц: большой круг минус смещённый (even-odd + clip).
    ctx.globalAlpha = e;
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, TAU);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, TAU);
    ctx.arc(mx + r * 0.42, my - r * 0.2, r * 0.88, 0, TAU);
    ctx.fillStyle = '#f2e9c9';
    ctx.fill('evenodd');
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = Math.max(0, 1 - p.age / p.life);
      ctx.globalAlpha = a;
      if (p.shape === 'streak') {
        const tx = p.x - p.vx * 0.08;
        const ty = p.y - p.vy * 0.08;
        const g = ctx.createLinearGradient(p.x, p.y, tx, ty);
        g.addColorStop(0, 'rgba(255,255,255,.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      } else if (p.shape === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.shape === 'flake') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        const s = p.size;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const ang = (i * Math.PI) / 3 + p.age;
          ctx.moveTo(p.x - Math.cos(ang) * s, p.y - Math.sin(ang) * s);
          ctx.lineTo(p.x + Math.cos(ang) * s, p.y + Math.sin(ang) * s);
        }
        ctx.stroke();
      } else if (p.shape === 'firefly') {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3.2, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawBanner(): void {
    const b = this.banner;
    if (!b) return;
    const ctx = this.ctx;
    const alpha = Math.max(0, Math.min(1, b.age / 0.2, (CFG.bannerTime - b.age) / 0.6));
    const pop = 1 + Math.max(0, 0.3 - b.age) * 1.5;
    const size = Math.min(34, this.width / 16);
    const font = 'ui-rounded, system-ui, sans-serif';
    const y = Math.min(Math.max(120, this.height * 0.3), this.height - 80);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.width / 2, y);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(14, 19, 48, 0.9)';
    ctx.font = `800 ${size}px ${font}`;
    ctx.strokeText(b.title, 0, 0);
    ctx.fillStyle = '#d9a8ff';
    ctx.fillText(b.title, 0, 0);
    ctx.font = `700 ${size * 0.5}px ${font}`;
    ctx.strokeText(b.sub, 0, size * 1.1);
    ctx.fillStyle = '#e8ebff';
    ctx.fillText(b.sub, 0, size * 1.1);
    ctx.restore();
  }

  /** Пунктирный радиус взрыва вокруг комара-бомбы. */
  private drawBlastZone(m: Mosquito): void {
    const ctx = this.ctx;
    const R = this.bombRadius() + Math.sin(m.wing * 0.4) * 3;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 70, 70, 0.05)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = m.hurt > 0 ? 'rgba(255, 200, 160, 0.9)' : 'rgba(255, 107, 107, 0.5)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -m.wing * 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, R, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  private drawMosquito(m: Mosquito): void {
    const ctx = this.ctx;
    const boosting = m.boostLeft > 0;
    const flap = 0.5 + 0.5 * Math.sin(m.wing);
    const shake = m.hurt > 0 ? 2 : 0;
    const wounded = m.hp < m.maxHp;
    const r = m.r;

    // Палитра по виду комара.
    let body = '#241f30';
    let edge = '#9a8fb8';
    let wing = 'rgba(205, 222, 255, 0.5)';
    let eye = '#f2e9c9';
    if (m.kind === 'frost') {
      body = '#0f2f46';
      edge = '#7fe3ff';
      wing = 'rgba(160, 235, 255, 0.6)';
      eye = '#d9f7ff';
    } else if (m.kind === 'bomb') {
      body = '#38101a';
      edge = '#ff6b6b';
      wing = 'rgba(255, 170, 150, 0.5)';
      eye = '#ff5d5d';
    } else if (m.angry) {
      body = '#2a1033';
      edge = '#d17bff';
      wing = 'rgba(255, 190, 235, 0.55)';
      eye = '#ff5d5d';
    }
    if (boosting && m.kind !== 'bomb') {
      body = m.angry ? '#4a1420' : '#3a1420';
      edge = '#ff8a8a';
    }
    if (boosting && m.kind === 'bomb') edge = '#ffd0d0';
    if (wounded && m.hurt > 0) edge = '#ffb703';

    ctx.save();
    ctx.translate(m.x + rand(-shake, shake), m.y + rand(-shake, shake));

    // Аура в момент превращения / появления.
    if (m.rage > 0) {
      const p = 1 - m.rage / 0.8;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = m.kind === 'frost' ? '#7fe3ff' : m.kind === 'bomb' ? '#ff6b6b' : '#d17bff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r + p * 34, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Иней вокруг замедленных комаров.
    if (this.slowLeft > 0) {
      ctx.strokeStyle = 'rgba(110, 231, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, 0, TAU);
      ctx.stroke();
    }

    // Ледяные кристаллы на орбите.
    if (m.kind === 'frost') {
      ctx.fillStyle = 'rgba(159, 232, 255, 0.85)';
      for (let i = 0; i < 3; i++) {
        const a = m.wing * 0.03 + (i * TAU) / 3;
        const cx = Math.cos(a) * (r + 8);
        const cy = Math.sin(a) * (r + 8);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillRect(-2.4, -2.4, 4.8, 4.8);
        ctx.restore();
      }
    }

    // Полоски жизней (не поворачиваются вместе с телом).
    if (m.maxHp > 1) {
      const pip = m.kind === 'frost' ? '#7fe3ff' : m.kind === 'bomb' ? '#ff6b6b' : '#ffb703';
      for (let i = 0; i < m.maxHp; i++) {
        ctx.fillStyle = i < m.hp ? pip : 'rgba(255, 255, 255, 0.22)';
        ctx.beginPath();
        ctx.arc((i - (m.maxHp - 1) / 2) * 9, r + 10, 3, 0, TAU);
        ctx.fill();
      }
    }

    // Тело разворачивается по курсу: голова смотрит туда, куда летит комар.
    ctx.rotate(Math.atan2(m.vy, m.vx) + Math.PI / 2);

    // Лапки: тонкие, trailing, чуть подрагивают.
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const ly = (-0.1 + i * 0.3) * r;
        const wig = Math.sin(m.wing * 0.5 + i) * r * 0.08;
        ctx.beginPath();
        ctx.moveTo(side * r * 0.3, ly);
        ctx.quadraticCurveTo(side * r * 0.95, ly + r * 0.1 + wig, side * r * 1.15, ly + r * 0.55 + wig);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Крылья: двойная отрисовка = смаз от быстрой вибрации.
    ctx.fillStyle = wing;
    for (const side of [-1, 1]) {
      const baseA = side * (0.85 + flap * 0.35);
      for (const [da, al] of [
        [0, 1],
        [side * 0.28, 0.4],
      ] as const) {
        ctx.save();
        ctx.globalAlpha = al;
        ctx.translate(side * r * 0.4, -r * 0.05);
        ctx.rotate(baseA + da);
        ctx.beginPath();
        ctx.ellipse(side * r * 0.55, 0, r * 0.78, r * (0.16 + 0.2 * flap), 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    // Брюшко с полосками.
    ctx.fillStyle = body;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.5, r * 0.4, r * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, r * 0.42);
    ctx.lineTo(r * 0.3, r * 0.42);
    ctx.moveTo(-r * 0.32, r * 0.66);
    ctx.lineTo(r * 0.32, r * 0.66);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Ядро бомбы пульсирует.
    if (m.kind === 'bomb') {
      const pulse = 0.6 + 0.4 * Math.sin(m.wing * 0.5);
      const g = ctx.createRadialGradient(0, r * 0.5, 0, 0, r * 0.5, r * 0.5);
      g.addColorStop(0, `rgba(255, 93, 93, ${0.85 * pulse})`);
      g.addColorStop(1, 'rgba(255, 93, 93, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, r * 0.5, r * 0.5, 0, TAU);
      ctx.fill();
    }
    // Снежинка на брюшке ледяного.
    if (m.kind === 'frost') {
      ctx.strokeStyle = '#bfefff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(-Math.cos(a) * r * 0.28, r * 0.5 - Math.sin(a) * r * 0.28);
        ctx.lineTo(Math.cos(a) * r * 0.28, r * 0.5 + Math.sin(a) * r * 0.28);
      }
      ctx.stroke();
    }

    // Грудь и голова.
    ctx.fillStyle = body;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.12, r * 0.44, r * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -r * 0.62, r * 0.32, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Хоботок и усики.
    ctx.strokeStyle = m.kind === 'frost' ? '#d9f7ff' : '#f2e9c9';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.9);
    ctx.lineTo(0, -r * 1.35);
    ctx.stroke();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, -r * 0.85);
    ctx.quadraticCurveTo(-r * 0.4, -r * 1.1, -r * 0.5, -r * 1.2);
    ctx.moveTo(r * 0.12, -r * 0.85);
    ctx.quadraticCurveTo(r * 0.4, -r * 1.1, r * 0.5, -r * 1.2);
    ctx.stroke();

    // Глаза (у злых — с бровями).
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.66, r * 0.11, 0, TAU);
    ctx.arc(r * 0.15, -r * 0.66, r * 0.11, 0, TAU);
    ctx.fill();
    if (m.angry) {
      ctx.strokeStyle = eye;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.86);
      ctx.lineTo(-r * 0.05, -r * 0.76);
      ctx.moveTo(r * 0.3, -r * 0.86);
      ctx.lineTo(r * 0.05, -r * 0.76);
      ctx.stroke();
    }

    ctx.restore();
  }
}