/* ---------------------------------------------------------------
   nacre.js — the shared material system for deeppearlai.com
   One iridescent gamut, one noise field, one simulation manager.
   Every canvas on the site draws through this module.
   --------------------------------------------------------------- */

export const reducedMotion =
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------- OKLab color ------------------------ */

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const clamp = (v) =>
    Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255)));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/* The canonical pearl anchors — the same tokens as global.css. */
export const PEARL = ['#aebfd6', '#d8cfc2', '#b9d2c9'];

/**
 * 256-entry LUT interpolating a→b→c→a in OKLab, so every canvas on
 * every page provably draws from the same iridescent gamut.
 * Returns an array of [r, g, b] triplets.
 */
export function pearlLUT(anchors = PEARL, steps = 256, chromaBoost = 1) {
  const labs = anchors.map(hexToOklab);
  labs.push(labs[0]); // close the loop
  const lut = new Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * (labs.length - 1);
    const k = Math.floor(t);
    const f = t - k;
    const A = labs[k];
    const B = labs[k + 1];
    lut[i] = oklabToRgb(
      A[0] + (B[0] - A[0]) * f,
      (A[1] + (B[1] - A[1]) * f) * chromaBoost,
      (A[2] + (B[2] - A[2]) * f) * chromaBoost
    );
  }
  return lut;
}

/** Sample a LUT at t in [0,1) with optional alpha → css color string. */
export function lutColor(lut, t, alpha = 1) {
  const i = ((Math.floor(t * lut.length) % lut.length) + lut.length) % lut.length;
  const c = lut[i];
  return alpha >= 1
    ? `rgb(${c[0]},${c[1]},${c[2]})`
    : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/* ------------------------- value noise ------------------------ */

/**
 * Seeded value noise with a permutation table.
 * Returns { noise3(x,y,z) in [-1,1], fbm(x,y,z,octaves) in [-1,1] }.
 */
export function makeNoise(seed = 7) {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const val = (h) => (perm[h & 511] / 255) * 2 - 1;

  function noise3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = fade(x - X), fy = fade(y - Y), fz = fade(z - Z);
    const h = (i, j, k) => perm[(perm[(perm[(X + i) & 255] + Y + j) & 511] + Z + k) & 511];
    return lerp(
      lerp(
        lerp(val(h(0, 0, 0)), val(h(1, 0, 0)), fx),
        lerp(val(h(0, 1, 0)), val(h(1, 1, 0)), fx),
        fy
      ),
      lerp(
        lerp(val(h(0, 0, 1)), val(h(1, 0, 1)), fx),
        lerp(val(h(0, 1, 1)), val(h(1, 1, 1)), fx),
        fy
      ),
      fz
    );
  }

  function fbm(x, y, z, octaves = 2) {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise3(x * f, y * f, z * f);
      amp *= 0.5;
      f *= 2;
    }
    return sum;
  }

  return { noise3, fbm };
}

/* ------------------------ glow sprites ------------------------ */

/**
 * Pre-rendered radial glow sprite (shadowBlur is banned — this is
 * the cheap replacement). color: [r,g,b]. Returns a canvas.
 */
export function glowSprite(color, size = 64, intensity = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  const [r, gg, b] = color;
  grad.addColorStop(0, `rgba(${r},${gg},${b},${0.85 * intensity})`);
  grad.addColorStop(0.35, `rgba(${r},${gg},${b},${0.32 * intensity})`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/* ---------------------- simulation manager -------------------- */

/**
 * makeSim(canvas, opts) — the contract every signature canvas uses.
 *
 * opts:
 *   render(ctx, t, dt, view)   — one animation frame. t/dt in ms.
 *                                view = { W, H, DPR } in CSS px.
 *   renderStill(ctx, view)     — composed end-state for reduced
 *                                motion (run the model headless,
 *                                draw once). Falls back to render.
 *   init(view)                 — optional, called after each resize.
 *   fps                        — frame cap, default 60.
 *   dprCap                     — default 1.5.
 *
 * Behavior: sizes to CSS box * DPR, pauses offscreen via
 * IntersectionObserver, pauses on hidden tabs (rAF), honors
 * prefers-reduced-motion by drawing renderStill once. Includes a
 * frame-time governor: if mean frame time exceeds 20ms over 30
 * frames, view.degraded becomes true (sims should drop counts).
 *
 * Returns { view, restart, destroy }.
 */
export function makeSim(canvas, opts) {
  const { render, renderStill, init, fps = 60, dprCap = 1.5 } = opts;
  const ctx = canvas.getContext('2d');
  const view = { W: 0, H: 0, DPR: 1, degraded: false };
  const interval = 1000 / fps;
  let raf = 0;
  let onScreen = false;
  let last = 0;
  let t0 = 0;
  let ftSum = 0;
  let ftN = 0;

  function still() {
    ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    ctx.clearRect(0, 0, view.W, view.H);
    (renderStill || ((c, v) => render(c, 0, 16, v)))(ctx, view);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    view.DPR = Math.min(window.devicePixelRatio || 1, dprCap);
    canvas.width = Math.max(1, Math.round(r.width * view.DPR));
    canvas.height = Math.max(1, Math.round(r.height * view.DPR));
    view.W = r.width;
    view.H = r.height;
    if (init) init(view);
    if (reducedMotion) still();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!t0) {
      t0 = now;
      last = now;
      return;
    }
    const since = now - last;
    if (since < interval - 1) return;
    const dt = Math.min(50, since);
    last = now;
    ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    render(ctx, now - t0, dt, view);
    // frame-time governor
    ftSum += since;
    ftN++;
    if (ftN >= 30) {
      view.degraded = ftSum / ftN > 20 + interval;
      ftSum = 0;
      ftN = 0;
    }
  }

  function play() {
    if (raf || reducedMotion || !onScreen) return;
    last = 0;
    t0 = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  const io = new IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting;
      onScreen ? play() : pause();
    },
    { rootMargin: '60px' }
  );
  io.observe(canvas);

  resize();
  if (reducedMotion) still();

  return {
    view,
    restart() {
      t0 = 0;
      if (reducedMotion) still();
    },
    destroy() {
      pause();
      ro.disconnect();
      io.disconnect();
    },
  };
}

/* -------------------- page-level behaviors --------------------- */

function initReveals() {
  const els = document.querySelectorAll('[data-accrete]:not(.accreted)');
  if (!els.length) return;
  if (reducedMotion) {
    els.forEach((el) => el.classList.add('accreted'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('accreted');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );
  els.forEach((el) => {
    // stagger children automatically
    Array.from(el.children).forEach((c, i) => c.style.setProperty('--i', i));
    io.observe(el);
  });
}

let sheenEls = [];
let sheenBound = false;

function initSheen() {
  sheenEls = Array.from(document.querySelectorAll('.sheen'));
  if (sheenBound) return;
  sheenBound = true;
  let queued = false;
  let ev = null;
  document.addEventListener(
    'pointermove',
    (e) => {
      ev = e;
      if (queued || !sheenEls.length) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        sheenEls.forEach((el) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty('--mx', `${ev.clientX - r.left}px`);
          el.style.setProperty('--my', `${ev.clientY - r.top}px`);
        });
      });
    },
    { passive: true }
  );
}

function initCounters() {
  const els = document.querySelectorAll('[data-count]');
  if (!els.length) return;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target;
      const target = parseFloat(el.dataset.count);
      const decimals = (el.dataset.count.split('.')[1] || '').length;
      if (reducedMotion) {
        el.textContent = target.toFixed(decimals);
        return;
      }
      const dur = parseFloat(el.dataset.countDur || 900);
      const start = performance.now();
      (function tick(now) {
        const p = Math.min(1, (now - start) / dur);
        el.textContent = (target * ease(p)).toFixed(decimals);
        if (p < 1) requestAnimationFrame(tick);
      })(start);
    });
  }, { threshold: 0.6 });
  els.forEach((el) => io.observe(el));
}

/** Called on initial load AND after every view transition. */
export function initPage() {
  initReveals();
  initSheen();
  initCounters();
}
