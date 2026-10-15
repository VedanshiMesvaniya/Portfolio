/* =====================================================================
   Project cards: click (or press Enter) to zoom a card into the middle
   of the screen with the page blurred behind it. Click anywhere outside
   the card or press Esc to zoom it back.
   ===================================================================== */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement;
  var lb = doc.getElementById('lightbox');
  if (!lb) return;
  var backdrop = lb.querySelector('.lightbox__backdrop');
  var card = lb.querySelector('.lightbox__card');
  var body = lb.querySelector('.lightbox__body');
  var OPEN_MS = 460, CLOSE_MS = 340;
  var current = null, busy = false;

  var reduced = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var shell = [doc.getElementById('nav'), doc.getElementById('main'), doc.querySelector('.foot')].filter(Boolean);

  function setInert(on) {
    shell.forEach(function (n) { if (on) n.setAttribute('inert', ''); else n.removeAttribute('inert'); });
  }
  function lockScroll() {
    var gutter = window.innerWidth - root.clientWidth;      // keep the layout from jumping when the scrollbar disappears
    root.style.setProperty('--sbw', gutter + 'px');
    root.style.overflow = 'hidden';
    root.style.paddingRight = gutter + 'px';
  }
  function unlockScroll() {
    root.style.overflow = '';
    root.style.paddingRight = '';
    root.style.removeProperty('--sbw');
  }
  function flip(from, to) {                                  // transform that makes `to` look like `from`
    return 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px) scale(' + (from.width / to.width) + ',' + (from.height / to.height) + ')';
  }

  function fill(src) {
    body.textContent = '';
    var title = doc.createElement('h3');
    title.id = 'lightbox-title';
    title.textContent = src.querySelector('h3').textContent;
    body.appendChild(title);
    ['.tags', '.proj__list'].forEach(function (sel) {
      var part = src.querySelector(sel);
      if (!part) return;
      var copy = part.cloneNode(true);
      Array.prototype.forEach.call(copy.querySelectorAll('[data-p]'), function (n) { n.removeAttribute('data-p'); });
      body.appendChild(copy);
    });
  }

  function open(src) {
    if (busy || current) return;
    busy = true; current = src;
    fill(src);

    var from = src.getBoundingClientRect();
    lb.hidden = false;
    setInert(true);
    lockScroll();

    card.style.transition = 'none';
    card.style.transform = 'none';
    var to = card.getBoundingClientRect();                   // where the card will end up
    card.style.transformOrigin = 'top left';
    card.style.transform = flip(from, to);                   // start exactly on top of the clicked card
    src.classList.add('is-lifted');
    void card.offsetWidth;

    requestAnimationFrame(function () {
      lb.classList.add('is-open');
      card.style.transition = 'transform ' + OPEN_MS + 'ms cubic-bezier(.2, .85, .2, 1)';
      card.style.transform = 'none';
    });
    card.focus({ preventScroll: true });
    setTimeout(function () { busy = false; }, reduced() ? 0 : OPEN_MS);
  }

  function close() {
    if (busy || !current) return;
    busy = true;
    var src = current;
    var from = src.getBoundingClientRect();
    var to = card.getBoundingClientRect();
    lb.classList.remove('is-open');
    card.style.transition = 'transform ' + CLOSE_MS + 'ms cubic-bezier(.4, 0, .2, 1)';
    card.style.transform = flip(from, to);
    setTimeout(function () {
      lb.hidden = true;
      card.style.transition = 'none';
      card.style.transform = 'none';
      src.classList.remove('is-lifted');
      setInert(false);
      unlockScroll();
      current = null; busy = false;
      src.focus({ preventScroll: true });
    }, reduced() ? 0 : CLOSE_MS);
  }

  // make every project card openable (mouse, touch and keyboard)
  Array.prototype.forEach.call(doc.querySelectorAll('.proj'), function (p) {
    var name = p.querySelector('h3').textContent;
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'button');
    p.setAttribute('aria-haspopup', 'dialog');
    p.setAttribute('aria-label', 'Open ' + name + ' in a larger view');
    p.addEventListener('click', function () { open(p); });
    p.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p); }
    });
  });

  lb.addEventListener('click', function (e) { if (!card.contains(e.target)) close(); });
  doc.addEventListener('keydown', function (e) {
    if (!current) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); card.focus({ preventScroll: true }); }
  });
})();

