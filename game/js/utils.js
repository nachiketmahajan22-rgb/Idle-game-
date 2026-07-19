window.Game = window.Game || {};

Game.Utils = (function () {
  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  const WORLD_HALF_SIZE = 1200;

  function formatNumber(value) {
    const n = Math.floor(value);
    if (n < 1000) return String(n);
    let tier = Math.floor(Math.log10(n) / 3);
    if (tier >= SUFFIXES.length) tier = SUFFIXES.length - 1;
    const scaled = n / Math.pow(1000, tier);
    const decimals = scaled < 10 ? 2 : (scaled < 100 ? 1 : 0);
    return scaled.toFixed(decimals) + SUFFIXES[tier];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function distance(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
  }

  function distanceSq(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
  }

  // Returns {x, y} unit vector from (ax,ay) toward (bx,by); {0,0} if the points coincide.
  function normalizeTo(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  return { formatNumber, clamp, formatDuration, formatClock, distance, distanceSq, normalizeTo, WORLD_HALF_SIZE };
})();
