/* =====================================================================
   Vedanshi Mesvaniya - portfolio
   Vanilla JavaScript, no dependencies, no build step.
   Content lives in index.html. The chat panel is in ask.js.
   ===================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var $ = function (sel, ctx) { return (ctx || doc).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); };
  var reduceMotion = function () {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* -------------------------------------------------------------------
     Reveal-on-scroll. Elements already in view are marked first, so
     nothing hides and then reappears on load. If this script fails to
     load, the hiding class is never added and content stays visible.
     ------------------------------------------------------------------- */
  function initReveal() {
    var items = $$('.reveal');
    items.forEach(function (el) {
      var siblings = $$('.reveal', el.parentElement).filter(function (s) { return s.parentElement === el.parentElement; });
      var idx = Math.max(0, siblings.indexOf(el));
      el.style.setProperty('--d', Math.min(idx * 70, 280) + 'ms');
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add('is-in');
    });
    root.classList.add('js-ready');

    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (el) { if (!el.classList.contains('is-in')) io.observe(el); });
  }

  /* -------------------------------------------------------------------
     Theme toggle
     ------------------------------------------------------------------- */
  function initTheme() {
    var btn = $('#theme-toggle');
    if (!btn) return;
    function sync() {
      var dark = root.getAttribute('data-theme') === 'dark';
      btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    }
    sync();
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* storage can be blocked */ }
      sync();
    });
  }

  /* -------------------------------------------------------------------
     Navigation: scrolled state, mobile menu, scroll-spy
     ------------------------------------------------------------------- */
  function initNav() {
    var nav = $('#nav');
    var menu = $('#menu');
    var burger = $('#burger');
    if (!nav) return;

    function onScroll() { nav.classList.toggle('is-scrolled', window.scrollY > 8); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    function setMenu(open) {
      if (!menu || !burger) return;
      menu.classList.toggle('is-open', open);
      nav.classList.toggle('is-menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    if (burger) {
      burger.addEventListener('click', function () { setMenu(burger.getAttribute('aria-expanded') !== 'true'); });
      $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
      doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
      window.addEventListener('resize', function () { if (window.innerWidth > 860) setMenu(false); });
    }

    var links = {};
    $$('[data-spy]').forEach(function (a) { links[a.getAttribute('data-spy')] = a; });
    function setActive(id) {
      Object.keys(links).forEach(function (k) {
        if (k === id) links[k].setAttribute('aria-current', 'true');
        else links[k].removeAttribute('aria-current');
      });
    }
    if ('IntersectionObserver' in window) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) setActive(e.target.id); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(links).forEach(function (id) { var s = doc.getElementById(id); if (s) spy.observe(s); });
    }
  }

  /* -------------------------------------------------------------------
     Experience timeline: the line fills as you read down the page
     ------------------------------------------------------------------- */
  function initTimeline() {
    var tl = $('#timeline');
    if (!tl) return;
    var fill = doc.createElement('span');
    fill.className = 'timeline__fill';
    fill.setAttribute('aria-hidden', 'true');
    tl.insertBefore(fill, tl.firstChild);
    var steps = $$('.tl', tl);
    var ticking = false;

    function update() {
      ticking = false;
      var rect = tl.getBoundingClientRect();
      var mid = window.innerHeight * 0.55;
      var h = Math.max(0, Math.min(mid - rect.top - 8, rect.height - 16));
      fill.style.height = h + 'px';
      steps.forEach(function (s) { s.classList.toggle('is-passed', s.getBoundingClientRect().top + 16 < mid); });
    }
    function req() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req);
    update();
  }

  /* -------------------------------------------------------------------
     Toast + copy email
     ------------------------------------------------------------------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      doc.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function initCopy() {
    var btn = $('#copy-email');
    if (!btn) return;
    btn.addEventListener('click', function () {
      copyText(btn.getAttribute('data-email')).then(
        function () { toast('Email address copied'); },
        function () { toast('Could not copy. The address is listed on this page.'); }
      );
    });
  }

  /* -------------------------------------------------------------------
     Name typing effect. Each line keeps an invisible "ghost" copy of the
     full text (so nothing moves) and a "live" layer that is typed out.
     The full name is also in the aria-label and is shown straight away
     for visitors who prefer reduced motion or have no JavaScript.
     ------------------------------------------------------------------- */
  function initTyping() {
    var h1 = $('#hero-name');
    if (!h1) return;
    var spans = $$('.name__line > span', h1);
    h1.setAttribute('aria-label', spans.map(function (s) { return s.textContent; }).join(' '));
    if (reduceMotion() || !spans.length) return;

    var lines = spans.map(function (span) {
      var text = span.textContent;
      var line = span.parentNode;
      var ghost = doc.createElement('span');
      ghost.className = 'ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.textContent = text;
      var live = doc.createElement('span');
      live.className = 'live';
      live.setAttribute('aria-hidden', 'true');
      var node = doc.createTextNode('');
      live.appendChild(node);
      line.removeChild(span);
      line.appendChild(ghost);
      line.appendChild(live);
      return { text: text, live: live, node: node };
    });

    var caret = doc.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    lines[0].live.appendChild(caret);

    var li = 0, ci = 0;
    function next() {
      if (li >= lines.length) { setTimeout(function () { caret.remove(); }, 3000); return; }
      var L = lines[li];
      if (ci < L.text.length) {
        ci++;
        L.node.nodeValue = L.text.slice(0, ci);
        L.live.appendChild(caret);                 // keep the caret right after the last letter
        setTimeout(next, 70 + Math.random() * 55);
      } else {
        li++; ci = 0;
        if (li < lines.length) lines[li].live.appendChild(caret);
        setTimeout(next, 340);
      }
    }
    setTimeout(next, 450);
  }

  /* -------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------- */
  function boot() {
    var y = $('#year');
    if (y) y.textContent = String(new Date().getFullYear());
    initTyping();
    initReveal();
    initTheme();
    initNav();
    initTimeline();
    initCopy();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
