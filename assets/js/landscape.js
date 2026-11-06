// A simulated landscape, 1985–2024: forest, a deforestation front that
// follows roads, and regrowth on part of the cleared land. Every pixel keeps
// its yearly NDVI series, shown when the pointer rests on it.
(() => {
  const canvas = document.getElementById("landscape");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const frame = canvas.parentElement;
  const slider = document.getElementById("year-slider");
  const yearOut = document.getElementById("year-out");
  const playBtn = document.getElementById("play");
  const probe = document.getElementById("probe");

  const Y0 = 1985, Y1 = 2024, NY = Y1 - Y0 + 1;
  const COLS = 66, ROWS = 50;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- deterministic noise -------------------------------------------------
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lattice = (s) => {
    const g = new Float32Array(32 * 32);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return (x, y) => g[((y & 31) << 5) | (x & 31)];
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const valueNoise = (g) => (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  const fbm = (n) => (x, y) => {
    let v = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < 4; o++) { v += amp * n(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
    return v / norm;
  };
  const terrain = fbm(valueNoise(lattice()));
  const front = fbm(valueNoise(lattice()));
  const regrow = fbm(valueNoise(lattice()));

  // ---- roads (polylines in grid units) -------------------------------------
  const roads = [
    [[0, 34], [14, 31], [27, 33], [40, 27], [53, 25], [66, 19]],
    [[27, 33], [25, 41], [22, 50]],
    [[40, 27], [43, 16], [41, 6], [44, 0]],
  ];
  const ROAD_OPEN = [1986, 1993, 1999];
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const roadDist = (x, y) => {
    let d = Infinity;
    for (const r of roads) for (let i = 1; i < r.length; i++)
      d = Math.min(d, segDist(x, y, r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]));
    return d;
  };
  // the year each road opens: the first stretch earlier than the branches
  const roadYear = (x, y) => {
    const near = roads.map((r) => {
      let d = Infinity;
      for (let i = 1; i < r.length; i++) d = Math.min(d, segDist(x, y, r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]));
      return d;
    });
    const k = near.indexOf(Math.min(...near));
    return ROAD_OPEN[k] + (k === 0 ? x * 0.12 : 0);
  };

  // ---- pixels --------------------------------------------------------------
  const N = COLS * ROWS;
  const ndvi = new Float32Array(N * NY);
  const info = new Array(N);
  // a protected area the front does not enter
  const inReserve = (x, y) => ((x - 52) / 11) ** 2 + ((y - 39) / 9) ** 2 < 1;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      const h = terrain(x / 11, y / 11);
      const water = h < 0.3;
      let cleared = null, regrowth = null;
      if (!water && !inReserve(x, y)) {
        const d = roadDist(x, y) + (front(x / 6, y / 6) - 0.5) * 7;
        // the front moves out from the road at ~0.45 px a year
        const yr = roadYear(x, y) + d / 0.32 + (rand() - 0.5) * 3;
        if (d < 8.5 && yr <= Y1) cleared = Math.max(Y0 + 1, Math.round(yr));
        if (cleared && cleared < 2012 && regrow(x / 7, y / 7) > 0.56 && d > 2.5) {
          regrowth = Math.round(cleared + 5 + rand() * 9);
          if (regrowth > Y1 - 1) regrowth = null;
        }
      }
      info[i] = { water, cleared, regrowth, reserve: inReserve(x, y) };
      for (let t = 0; t < NY; t++) {
        const yr = Y0 + t;
        const noise = (rand() - 0.5) * 0.06;
        let v;
        if (water) v = -0.08 + noise * 0.5;
        else if (!cleared || yr < cleared) v = 0.83 - (h - 0.3) * 0.08 + noise;
        else if (!regrowth || yr < regrowth) v = 0.3 + noise * 1.4;
        else v = 0.3 + 0.48 * (1 - Math.exp(-(yr - regrowth + 1) / 5)) + noise;
        ndvi[i * NY + t] = v;
      }
    }
  }

  // ---- colour --------------------------------------------------------------
  const stops = [
    [0.15, [205, 186, 140]],
    [0.35, [190, 178, 118]],
    [0.55, [142, 168, 92]],
    [0.72, [72, 128, 76]],
    [0.88, [30, 82, 54]],
  ];
  const WATER = "rgb(74,128,160)";
  const colour = (v) => {
    if (v < 0.05) return WATER;
    if (v <= stops[0][0]) return `rgb(${stops[0][1]})`;
    for (let k = 1; k < stops.length; k++) {
      if (v <= stops[k][0]) {
        const [a, ca] = stops[k - 1], [b, cb] = stops[k];
        const t = (v - a) / (b - a);
        return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * t))})`;
      }
    }
    return `rgb(${stops[stops.length - 1][1]})`;
  };
  const ramp = document.querySelector(".legend .ramp");
  if (ramp) ramp.style.background = `linear-gradient(90deg, ${stops.map((s) => `rgb(${s[1]})`).join(",")})`;
  const sw = document.querySelector(".legend .sw");
  if (sw) sw.style.background = WATER;

  // ---- drawing -------------------------------------------------------------
  let W = 0, H = 0, cell = 0, ox = 0, oy = 0;
  let year = reduceMotion ? Y1 : Y0;
  let hover = -1;

  const resize = () => {
    const r = frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = Math.max(W / COLS, H / ROWS);
    ox = (W - cell * COLS) / 2;
    oy = (H - cell * ROWS) / 2;
    draw();
  };

  const draw = () => {
    const t = Math.round(year) - Y0;
    const gap = cell > 7 ? 1 : 0;
    ctx.fillStyle = "#e7ebe5";
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        ctx.fillStyle = colour(ndvi[i * NY + t]);
        ctx.fillRect(ox + x * cell, oy + y * cell, cell - gap, cell - gap);
      }
    }
    // roads, once open
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(244, 238, 222, 0.9)";
    ctx.lineWidth = Math.max(1.5, cell * 0.32);
    roads.forEach((r, k) => {
      if (year < ROAD_OPEN[k]) return;
      ctx.beginPath();
      r.forEach(([x, y], j) => {
        const px = ox + x * cell, py = oy + y * cell;
        j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
    });
    if (hover >= 0) {
      const hx = hover % COLS, hy = (hover / COLS) | 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#15231d";
      ctx.strokeRect(ox + hx * cell - 1.5, oy + hy * cell - 1.5, cell + 2, cell + 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + hx * cell - 3, oy + hy * cell - 3, cell + 5, cell + 5);
    }
  };

  const setYear = (y, fromSlider) => {
    year = y;
    const r = Math.round(y);
    yearOut.textContent = r;
    if (!fromSlider) slider.value = r;
    slider.setAttribute("aria-valuetext", String(r));
    draw();
    if (hover >= 0) renderProbe();
  };

  // ---- probe (pixel series) ------------------------------------------------
  const svgNS = "http://www.w3.org/2000/svg";
  const renderProbe = () => {
    const i = hover;
    const p = info[i];
    const x = i % COLS, y = (i / COLS) | 0;
    const cur = Math.round(year);
    const vals = Array.from(ndvi.subarray(i * NY, i * NY + NY));
    const w = 260, h = 64, padB = 12;
    const sx = (t) => (t / (NY - 1)) * w;
    const sy = (v) => (h - padB) - ((v + 0.1) / 1.0) * (h - padB - 4);
    let path = "";
    vals.forEach((v, t) => { path += (t ? "L" : "M") + sx(t).toFixed(1) + " " + sy(v).toFixed(1); });
    const mark = (yr, col) => yr
      ? `<line x1="${sx(yr - Y0)}" x2="${sx(yr - Y0)}" y1="2" y2="${h - padB}" stroke="${col}" stroke-dasharray="2 2"/>`
      : "";
    const svg = `
      <svg viewBox="0 0 ${w} ${h}" xmlns="${svgNS}" aria-hidden="true">
        <line x1="0" x2="${w}" y1="${h - padB}" y2="${h - padB}" stroke="#cfd7d0"/>
        ${mark(p.cleared, "#b0325a")}${mark(p.regrowth, "#2c6a48")}
        <path d="${path}" fill="none" stroke="#15231d" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="${sx(cur - Y0)}" cy="${sy(vals[cur - Y0])}" r="3.5" fill="#1d6a8a" stroke="#fff" stroke-width="1.5"/>
        <text x="0" y="${h}" font-size="9" fill="#64746c">${Y0}</text>
        <text x="${w}" y="${h}" font-size="9" fill="#64746c" text-anchor="end">${Y1}</text>
      </svg>`;
    let note;
    if (p.water) note = "Open water: NDVI stays below zero.";
    else if (p.cleared && p.regrowth) note = `Cleared in ${p.cleared}, regrowing since ${p.regrowth}.`;
    else if (p.cleared) note = `Forest cleared in ${p.cleared}.`;
    else if (p.reserve) note = "Inside the protected area: forest throughout.";
    else note = "Forest throughout the series.";
    probe.innerHTML = `
      <div class="probe-head"><span>Pixel ${x}, ${y}</span><span>NDVI in ${cur} <b>${vals[cur - Y0].toFixed(2)}</b></span></div>
      ${svg}
      <p class="probe-note">${note}</p>`;
    probe.classList.add("on");
    // keep the probe away from the pointer
    const px = ox + x * cell;
    const onLeft = px < W * 0.5 && y * cell + oy > H * 0.45;
    probe.style.left = onLeft ? "auto" : "0.75rem";
    probe.style.right = onLeft ? "0.75rem" : "auto";
  };

  const pick = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left - ox) / cell);
    const y = Math.floor((ev.clientY - r.top - oy) / cell);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return -1;
    return y * COLS + x;
  };
  canvas.addEventListener("pointermove", (ev) => {
    const i = pick(ev);
    if (i === hover) return;
    hover = i;
    if (i < 0) probe.classList.remove("on"); else renderProbe();
    draw();
  });
  canvas.addEventListener("pointerleave", (ev) => {
    if (ev.pointerType === "touch") return;
    hover = -1;
    probe.classList.remove("on");
    draw();
  });

  // ---- time ----------------------------------------------------------------
  let raf = 0, playing = false, last = 0;
  const SPEED = 5.5; // years per second
  const icon = (on) => (playBtn.innerHTML = on
    ? '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1" width="2.4" height="8" fill="currentColor"/><rect x="6.1" y="1" width="2.4" height="8" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1 L9 5 L2 9 Z" fill="currentColor"/></svg>');
  const step = (ts) => {
    if (!playing) return;
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    const next = Math.min(Y1, year + dt * SPEED);
    setYear(next);
    if (next >= Y1) { stop(); return; }
    raf = requestAnimationFrame(step);
  };
  const play = () => {
    if (year >= Y1) setYear(Y0);
    playing = true; last = 0;
    icon(true);
    playBtn.setAttribute("aria-label", "Pause");
    raf = requestAnimationFrame(step);
  };
  const stop = () => {
    playing = false;
    cancelAnimationFrame(raf);
    icon(false);
    playBtn.setAttribute("aria-label", "Play 1985 to 2024");
  };
  playBtn.addEventListener("click", () => (playing ? stop() : play()));
  slider.addEventListener("input", () => { stop(); setYear(+slider.value, true); });

  slider.min = Y0; slider.max = Y1;
  new ResizeObserver(resize).observe(frame);
  resize();
  setYear(year);
  icon(false);
  if (!reduceMotion) setTimeout(play, 600);
})();
