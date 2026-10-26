'use strict';
// Liquid glass motion: content blurs into focus as it enters, headline numbers count up, and glass
// surfaces catch a highlight under the pointer. Pages re-render often, so new content is picked up
// through a MutationObserver. Everything is skipped when the user prefers reduced motion.
(function (root) {
  const doc = root.document;
  const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const REVEAL = '.page-heading,.stat,.panel,.callout,.territory-card,.mi-card,.attention-row';
  const COUNT = '.stat-value';
  const GLASS = '.lq-glass,.stat,.panel,.callout';

  // Animates the first number in an element's text, keeping its prefix, suffix, grouping and decimals.
  function countUp(el) {
    if (el.dataset.lqCounted) return;
    const text = el.textContent, match = text.match(/-?\d[\d,]*(?:\.\d+)?/);
    el.dataset.lqCounted = '1';
    if (!match) return;
    const raw = match[0], target = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = (raw.split('.')[1] || '').length, grouped = raw.includes(','), padded = /^0\d/.test(raw) ? raw.length : 0;
    const format = value => {
      let out = grouped ? value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : value.toFixed(decimals);
      if (padded) out = out.padStart(padded, '0');
      return text.slice(0, match.index) + out + text.slice(match.index + raw.length);
    };
    const start = performance.now(), duration = 1100;
    const step = now => {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 4);
      el.textContent = t < 1 ? format(target * eased) : text;
      if (t < 1) root.requestAnimationFrame(step);
    };
    el.textContent = format(0);
    root.requestAnimationFrame(step);
    // Animation frames pause in hidden tabs; the final value is always written, so a figure never sticks at 0.
    root.setTimeout(() => { if (el.isConnected && el.textContent !== text) el.textContent = text; }, duration + 150);
  }

  const observer = 'IntersectionObserver' in root ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      entry.target.querySelectorAll?.(COUNT).forEach(countUp);
      if (entry.target.matches(COUNT)) countUp(entry.target);
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }) : null;

  function enhance(scope) {
    if (reduced || !observer || doc.body.classList.contains('expansion-fullscreen')) return;
    const items = [...scope.querySelectorAll(REVEAL)].filter(el => !el.classList.contains('lq-reveal'));
    items.forEach((el, index) => { el.classList.add('lq-reveal'); el.style.setProperty('--i', String(index % 8)); observer.observe(el); });
  }

  doc.addEventListener('pointermove', event => {
    const glass = event.target.closest?.(GLASS);
    if (!glass) return;
    const box = glass.getBoundingClientRect();
    glass.style.setProperty('--mx', `${event.clientX - box.left}px`);
    glass.style.setProperty('--my', `${event.clientY - box.top}px`);
  }, { passive: true });

  function start() {
    const main = doc.getElementById('main');
    if (!main) return;
    enhance(main);
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      root.requestAnimationFrame(() => { queued = false; enhance(main); });
    }).observe(main, { childList: true, subtree: true });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  root.LiquidMotion = { countUp, enhance };
})(window);
