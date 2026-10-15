/* =====================================================================
   Neuron background
   A quiet network spread evenly across the whole page. Three depth
   layers drift at slightly different speeds (scroll and cursor
   parallax) and the occasional signal travels along a link.
   Kept deliberately faint so the content stays the focus.
   Respects reduced-motion (one still frame) and pauses when the tab
   is hidden.
   ===================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('neurons');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var root = document.documentElement;
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // far, middle, near. "cell" is the grid size used to spread that layer's nodes evenly.
  var LAYERS = [
    { cell: 250, a: 0.5, r: 0.8, par: 0.025, drift: 0.6 },
    { cell: 200, a: 0.75, r: 1.0, par: 0.06, drift: 0.9 },
    { cell: 290, a: 1.0, r: 1.15, par: 0.1, drift: 1.1 }
  ];
  var SPRITES = 8;

  var w = 0, h = 0, dpr = 1;
  var nodes = [], edges = [], adj = [], pulses = [], sprites = [];
  var colA = [139, 92, 246], colB = [6, 182, 212], baseAlpha = 1, dark = false;
  var mouse = { x: 0, y: 0, on: false, ox: 0, oy: 0 };
  var scrollY = 0, raf = 0, last = 0, running = false;
  var idleAt = 0, cascadeAt = 0, time = 0;

  /* ---------- colour helpers ---------- */
  function parse(v, fallback) {
    var m = /^#([0-9a-f]{6})$/i.exec((v || '').trim());
    if (!m) return fallback;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lerpCol(t) {
    return [colA[0] + (colB[0] - colA[0]) * t, colA[1] + (colB[1] - colA[1]) * t, colA[2] + (colB[2] - colA[2]) * t];
  }
  function rgb(t) { var c = lerpCol(Math.max(0, Math.min(1, t))); return Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]); }

  function buildSprites() {
    sprites = [];
    for (var i = 0; i < SPRITES; i++) {
      var c = lerpCol(i / (SPRITES - 1));
      var s = document.createElement('canvas');
      s.width = s.height = 48;
      var g = s.getContext('2d');
      var grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      var col = Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]);
      grad.addColorStop(0, 'rgba(' + col + ',0.55)');
      grad.addColorStop(0.35, 'rgba(' + col + ',0.16)');
      grad.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 48, 48);
      sprites.push(s);
    }
  }
  function readTheme() {
    var cs = getComputedStyle(root);
    colA = parse(cs.getPropertyValue('--neuron-a'), colA);
    colB = parse(cs.getPropertyValue('--neuron-b'), colB);
    baseAlpha = parseFloat(cs.getPropertyValue('--neuron-alpha')) || 1;
    dark = root.getAttribute('data-theme') === 'dark';
    buildSprites();
  }

  /* ---------- network ---------- */
  function seed() {
    var small = w < 720;
    nodes = [];
    LAYERS.forEach(function (L, li) {
      if (small && li === 0) return;                       // fewer layers on phones
      var cell = L.cell * (small ? 0.8 : 1);
      L.len = cell * 1.75;                                 // longest link for this layer
      var cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2;
      for (var cy = -1; cy < rows - 1; cy++) {
        for (var cx = -1; cx < cols - 1; cx++) {
          var ax = (cx + 0.15 + Math.random() * 0.7) * cell;   // one node per grid cell, jittered
          var ay = (cy + 0.15 + Math.random() * 0.7) * cell;
          nodes.push({ ax: ax, ay: ay, x: ax, y: ay, layer: li,
            r: (0.9 + Math.random() * 1.1) * L.r,
            ph: Math.random() * 6.283, ph2: Math.random() * 6.283,
            fx: 0.00018 + Math.random() * 0.0003, amp: 5 + Math.random() * 10,
            fire: 0, sx: 0, sy: 0 });
        }
      }
    });

    // each node links to its nearest neighbours on the same layer
    edges = []; adj = nodes.map(function () { return []; });
    var seen = Object.create(null);
    nodes.forEach(function (n, i) {
      var L = LAYERS[n.layer], cand = [];
      nodes.forEach(function (m, j) {
        if (i === j || m.layer !== n.layer) return;
        var dx = n.ax - m.ax, dy = n.ay - m.ay, d = Math.sqrt(dx * dx + dy * dy);
        if (d < L.len) cand.push({ j: j, d: d });
      });
      cand.sort(function (a, b) { return a.d - b.d; });
      cand.slice(0, 2).forEach(function (k) {
        var key = i < k.j ? i + '-' + k.j : k.j + '-' + i;
        if (seen[key]) return;
        seen[key] = 1;
        edges.push({ a: i, b: k.j, curve: (Math.random() - 0.5) * 0.35 });
        adj[i].push(edges.length - 1); adj[k.j].push(edges.length - 1);
      });
    });
    pulses = [];
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    project();
    if (!running) draw();
  }

  /* ---------- positions (drift + parallax) ---------- */
  function project() {
    var span = h + 80;
    nodes.forEach(function (n) {
      var L = LAYERS[n.layer];
      n.x = n.ax + Math.sin(time * n.fx * 1000 + n.ph) * n.amp * L.drift;
      n.y = n.ay + Math.cos(time * n.fx * 1000 * 0.8 + n.ph2) * n.amp * L.drift;
      var px = n.x - mouse.ox * L.par * 9;
      var py = n.y - scrollY * L.par - mouse.oy * L.par * 9;
      n.sx = px;
      n.sy = ((py + 40) % span + span) % span - 40;
    });
  }

  /* ---------- signals ---------- */
  function sendFrom(i, depth, maxDepth, exclude) {
    if (pulses.length > 22) return;
    var options = adj[i].filter(function (e) { return e !== exclude; });
    if (!options.length) return;
    var e = options[(Math.random() * options.length) | 0];
    pulses.push({ e: e, dir: edges[e].a === i ? 1 : -1, t: 0, v: 0.005 + Math.random() * 0.004, depth: depth, max: maxDepth });
  }

  function step(dt) {
    var k = dt / 16.7;
    time += dt / 1000;
    mouse.ox += ((mouse.on ? mouse.x - w / 2 : 0) / 60 - mouse.ox) * 0.06;
    mouse.oy += ((mouse.on ? mouse.y - h / 2 : 0) / 60 - mouse.oy) * 0.06;
    project();

    nodes.forEach(function (n) { if (n.fire > 0) n.fire = Math.max(0, n.fire - 0.018 * k); });

    for (var i = pulses.length - 1; i >= 0; i--) {
      var p = pulses[i];
      p.t += p.v * k;
      if (p.t < 1) continue;
      var ed = edges[p.e], target = p.dir === 1 ? ed.b : ed.a;
      nodes[target].fire = 1;
      if (p.depth < p.max && Math.random() < 0.55) sendFrom(target, p.depth + 1, p.max, p.e);
      pulses.splice(i, 1);
    }

    idleAt -= dt; cascadeAt -= dt;
    if (idleAt <= 0 && nodes.length) { sendFrom((Math.random() * nodes.length) | 0, 0, 3); idleAt = 900 + Math.random() * 1400; }
    if (cascadeAt <= 0 && nodes.length) {
      var onScreen = [];
      nodes.forEach(function (n, idx) { if (n.sx > 0 && n.sx < w && n.sy > 0 && n.sy < h) onScreen.push(idx); });
      if (onScreen.length) { var s = onScreen[(Math.random() * onScreen.length) | 0]; nodes[s].fire = 1; sendFrom(s, 0, 5); sendFrom(s, 0, 5); }
      cascadeAt = 9000 + Math.random() * 6000;
    }
  }

  /* ---------- drawing ---------- */
  function bez(p0, c, p1, t) { var u = 1 - t; return u * u * p0 + 2 * u * t * c + t * t * p1; }
  function ctrl(a, b, curve) {
    return { x: (a.sx + b.sx) / 2 - (b.sy - a.sy) * curve, y: (a.sy + b.sy) / 2 + (b.sx - a.sx) * curve };
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    var fade = 1 - Math.min(scrollY / (h * 1.3), 1) * 0.35;     // slightly calmer further down the page
    var ga = baseAlpha * fade;
    var edgeBase = dark ? 0.2 : 0.26;
    var i, e, a, b, c, d;

    ctx.lineWidth = 0.9;
    for (i = 0; i < edges.length; i++) {
      e = edges[i]; a = nodes[e.a]; b = nodes[e.b];
      var L = LAYERS[a.layer], reach = L.len * 1.25;
      var dx = a.sx - b.sx, dy = a.sy - b.sy;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach) continue;                               // seam of the vertical wrap
      c = ctrl(a, b, e.curve);
      var lit = Math.max(a.fire, b.fire);
      ctx.strokeStyle = 'rgba(' + rgb((a.sx + b.sx) / 2 / w) + ',' + ((edgeBase * L.a * (1 - d / reach) + lit * 0.1) * ga).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.quadraticCurveTo(c.x, c.y, b.sx, b.sy); ctx.stroke();
    }

    // soft halo, then a small core for every node
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (a.sx < -30 || a.sx > w + 30) continue;
      var Ln = LAYERS[a.layer];
      var sp = sprites[Math.max(0, Math.min(SPRITES - 1, Math.round((a.sx / w) * (SPRITES - 1))))];
      var size = (9 + a.r * 4 + a.fire * 12) * (0.85 + Ln.r * 0.2);
      ctx.globalAlpha = Math.min(1, Ln.a * ga * (0.35 + a.fire * 0.65));
      ctx.drawImage(sp, a.sx - size / 2, a.sy - size / 2, size, size);
    }
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (a.sx < -10 || a.sx > w + 10) continue;
      var Lc = LAYERS[a.layer];
      ctx.globalAlpha = Math.min(1, Lc.a * ga * (dark ? 0.55 : 0.6) * (0.8 + a.fire * 0.2));
      ctx.fillStyle = 'rgba(' + rgb(a.sx / w) + ',1)';
      ctx.beginPath(); ctx.arc(a.sx, a.sy, a.r + a.fire * 0.5, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // signals: a short faint trail and a small head
    ctx.lineCap = 'round';
    for (i = 0; i < pulses.length; i++) {
      var p = pulses[i], ed = edges[p.e];
      a = p.dir === 1 ? nodes[ed.a] : nodes[ed.b];
      b = p.dir === 1 ? nodes[ed.b] : nodes[ed.a];
      var dxx = a.sx - b.sx, dyy = a.sy - b.sy;
      if (Math.sqrt(dxx * dxx + dyy * dyy) > LAYERS[a.layer].len * 1.25) continue;
      c = ctrl(a, b, ed.curve * (p.dir === 1 ? 1 : -1));
      var tr = 5, x0 = 0, y0 = 0;
      for (var s = 0; s <= tr; s++) {
        var tt = Math.max(0, p.t - (tr - s) * 0.02);
        var x = bez(a.sx, c.x, b.sx, tt), y = bez(a.sy, c.y, b.sy, tt);
        if (s > 0) {
          ctx.strokeStyle = 'rgba(' + rgb(x / w) + ',' + ((s / tr) * 0.4 * ga).toFixed(3) + ')';
          ctx.lineWidth = 0.7 + (s / tr) * 0.9;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
        }
        x0 = x; y0 = y;
      }
      var hx = bez(a.sx, c.x, b.sx, p.t), hy = bez(a.sy, c.y, b.sy, p.t);
      ctx.fillStyle = 'rgba(' + rgb(hx / w) + ',' + (0.7 * ga).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(hx, hy, 1.5, 0, 6.2832); ctx.fill();
    }
  }

  /* ---------- loop ---------- */
  var ema = 16, seen = 0, prev = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // Weak device? If frames keep taking too long, settle on a still picture.
    if (prev) { ema = ema * 0.92 + Math.min(now - prev, 200) * 0.08; seen++; }
    prev = now;
    if (seen > 120 && ema > 58) { root.classList.add('lite'); stop(); still(); return; }
    if (now - last < 24) return;                             // about 40 fps is plenty here
    var dt = Math.min(now - last, 60);
    last = now;
    step(dt);
    draw();
  }
  function start() {
    if (running || motion.matches || document.hidden) return;
    running = true; last = performance.now(); prev = 0; seen = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); prev = 0; }
  function still() { project(); draw(); }

  window.addEventListener('resize', function () { resize(); });
  window.addEventListener('scroll', function () { scrollY = window.scrollY || 0; if (!running) still(); }, { passive: true });
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true;
  }, { passive: true });
  document.addEventListener('pointerleave', function () { mouse.on = false; });
  window.addEventListener('blur', function () { mouse.on = false; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  if (motion.addEventListener) motion.addEventListener('change', function () { if (motion.matches) { stop(); still(); } else start(); });
  if (window.MutationObserver) {
    new MutationObserver(function () { readTheme(); if (!running) still(); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }

  scrollY = window.scrollY || 0;
  readTheme();
  resize();
  start();
})();
