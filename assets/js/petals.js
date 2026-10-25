/* ==========================================================================
   砚池 · 落花背景层（petals.js）
   —— 一层接连不断的主题色花瓣，慢慢飘落、边落边翻面。
   纯装饰：不接收指针、不进 tab 序、不参与布局；颜色直接读 --h/--s/--l，
   所以换主题色（data-accent）或切昼夜都会立刻跟着变。
   尊重「减少动态效果」：那种环境下整层不跑，背景保持干净。
   ========================================================================== */
(() => {
  const canvas = document.getElementById('petals');
  if (!canvas || typeof canvas.getContext !== 'function' || typeof Path2D !== 'function') return;

  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* 花瓣轮廓：单位空间（宽 1、高 1、尖朝上、底部一个小缺口） */
  const PETAL = new Path2D();
  PETAL.moveTo(0, -0.5);
  PETAL.bezierCurveTo(0.44, -0.33, 0.5, 0.17, 0.12, 0.47);
  PETAL.quadraticCurveTo(0, 0.29, -0.12, 0.47);
  PETAL.bezierCurveTo(-0.5, 0.17, -0.44, -0.33, 0, -0.5);
  PETAL.closePath();

  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, petals = [];
  const pal = { h: 196, s: 34, l: 42, dark: false };

  /* ---------- 取色：只用主题的三根 HSL 轴 ---------- */
  function readPalette() {
    const cs = getComputedStyle(root);
    const num = (k, d) => { const v = parseFloat(cs.getPropertyValue(k)); return Number.isFinite(v) ? v : d; };
    pal.h = num('--h', pal.h);
    pal.s = num('--s', pal.s);
    pal.l = num('--l', pal.l);
    pal.dark = root.getAttribute('data-theme') === 'dark';
    for (const p of petals) tint(p);
  }

  /* 每片花瓣在主题色上做一点点明度/色相抖动，避免一片塑料色板 */
  function tint(p) {
    const hue = pal.h + p.hueShift;
    const sat = Math.max(6, Math.min(92, pal.s + 4 + p.tone * 10));
    const lum = pal.dark ? pal.l + 6 + p.tone * 14 : pal.l + 2 + p.tone * 15;
    p.fill = `hsl(${hue.toFixed(1)} ${sat.toFixed(1)}% ${Math.min(86, lum).toFixed(1)}%)`;
    p.line = `hsl(${hue.toFixed(1)} ${sat.toFixed(1)}% ${Math.min(94, lum + 15).toFixed(1)}%)`;
  }

  /* ---------- 一片花瓣 ---------- */
  function makePetal(initial) {
    const depth = 0.55 + Math.random() * 0.8;            // 近大远小、近快远慢
    const p = {
      depth,
      size: (10 + Math.random() * 10) * depth,           // 像素（长轴）
      tone: Math.random(),
      hueShift: (Math.random() - 0.5) * 18,
      alpha: (0.16 + Math.random() * 0.26) * (0.55 + depth * 0.55),
      x: Math.random() * (W + 140) - 70,
      y: initial ? Math.random() * (H + 80) - 40 : -30 - Math.random() * H * 0.45,
      vx: (Math.random() - 0.5) * 12,                    // 基础横向漂移 px/s
      vy: (15 + Math.random() * 26) * depth,             // 下落速度 px/s
      swingAmp: 9 + Math.random() * 26,                  // 左右摆幅
      swingFreq: 0.45 + Math.random() * 0.85,
      phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.3,
      flip: Math.random() * Math.PI * 2,
      flipSpd: 0.5 + Math.random() * 1.5,                // 翻面快慢
    };
    tint(p);
    return p;
  }

  function draw(p) {
    const face = Math.cos(p.flip);                       // 侧身时变窄，正对时最宽
    const co = Math.abs(face);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(p.size * (face < 0 ? -co : co) || 0.001, p.size);
    ctx.globalAlpha = p.alpha * (0.55 + 0.45 * co);
    ctx.fillStyle = p.fill;
    ctx.fill(PETAL);
    ctx.lineWidth = 0.055;
    ctx.strokeStyle = p.line;
    ctx.globalAlpha *= 0.42;
    ctx.stroke(PETAL);
    ctx.restore();
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    ctx.clearRect(0, 0, W, H);
    for (const p of petals) {
      p.phase += dt * p.swingFreq;
      p.flip += dt * p.flipSpd;
      p.rot += dt * p.spin;
      p.y += p.vy * dt * (0.86 + 0.28 * Math.cos(p.phase * 0.8));
      p.x += (p.vx + Math.sin(p.phase) * p.swingAmp) * dt;
      if (p.y - p.size > H + 24) Object.assign(p, makePetal(false));   // 出底即接上新的一片
      else if (p.x < -90) p.x = W + 80;
      else if (p.x > W + 90) p.x = -80;
      draw(p);
    }
  }

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* 数量跟屏幕面积走，手机上少一半，免得糊满又费电 */
    const want = Math.round(Math.max(24, Math.min(80, (W * H) / 20000)));
    while (petals.length > want) petals.pop();
    while (petals.length < want) petals.push(makePetal(true));
    for (const p of petals) {
      if (p.x > W + 90) p.x = Math.random() * W;
      if (p.y > H + 24) p.y = Math.random() * H;
    }
  }

  function start() {
    if (raf || reduceMQ.matches) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function sync() {
    if (document.hidden || reduceMQ.matches) stop();
    else start();
  }

  readPalette();
  size();
  sync();

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { size(); sync(); }, 180);
  }, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(() => { size(); sync(); }, 320));

  /* 主题色 / 昼夜变化：prefs.set 会抛 yanchi:prefs；属性被别处改动时 MutationObserver 兜住 */
  window.addEventListener('yanchi:prefs', e => {
    const k = e.detail && e.detail.k;
    if (k === 'accent' || k === 'theme') readPalette();
  });
  new MutationObserver(readPalette).observe(root, { attributes: true, attributeFilter: ['data-accent', 'data-theme'] });

  document.addEventListener('visibilitychange', sync);
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', () => { readPalette(); sync(); });
})();
