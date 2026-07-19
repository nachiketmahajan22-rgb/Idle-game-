window.Game = window.Game || {};

// Floating virtual joystick driven by Pointer Events, which unifies touch, mouse
// and pen under one API - this is what gives us a working mouse-drag fallback
// for desktop dev/testing without any separate code path.
Game.Joystick = (function () {
  const MAX_RADIUS = 50;

  let zoneEl = null;
  let baseEl = null;
  let knobEl = null;
  let active = false;
  let pointerId = null;
  let originX = 0;
  let originY = 0;
  let vecX = 0;
  let vecY = 0;

  function init(zoneElement, baseElement, knobElement) {
    zoneEl = zoneElement;
    baseEl = baseElement;
    knobEl = knobElement;
    zoneEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerDown(e) {
    if (active) return;
    active = true;
    pointerId = e.pointerId;
    originX = e.clientX;
    originY = e.clientY;
    baseEl.style.left = originX + 'px';
    baseEl.style.top = originY + 'px';
    baseEl.classList.remove('hidden');
    knobEl.classList.remove('hidden');
    updateKnob(originX, originY);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!active || e.pointerId !== pointerId) return;
    updateKnob(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    pointerId = null;
    vecX = 0;
    vecY = 0;
    baseEl.classList.add('hidden');
    knobEl.classList.add('hidden');
  }

  function updateKnob(clientX, clientY) {
    const dx = clientX - originX;
    const dy = clientY - originY;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, MAX_RADIUS);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;
    vecX = dist > 0 ? knobX / MAX_RADIUS : 0;
    vecY = dist > 0 ? knobY / MAX_RADIUS : 0;
    knobEl.style.left = (originX + knobX) + 'px';
    knobEl.style.top = (originY + knobY) + 'px';
  }

  function getVector() {
    return { x: vecX, y: vecY };
  }

  function isActive() {
    return active;
  }

  // Test-only hook so Playwright can drive movement without dispatching real pointer events.
  function debugSetVector(x, y) {
    vecX = x;
    vecY = y;
  }

  return { init: init, getVector: getVector, isActive: isActive, debugSetVector: debugSetVector };
})();
