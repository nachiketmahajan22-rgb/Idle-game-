window.Game = window.Game || {};

Game.UI = (function () {
  const STATE = { CAMP: 'camp', HUNT: 'hunt' };

  let currentScreen = STATE.CAMP;
  let screenCamp = null;
  let screenHunt = null;

  function showScreen(name) {
    currentScreen = name;
    screenCamp.classList.toggle('active', name === STATE.CAMP);
    screenHunt.classList.toggle('active', name === STATE.HUNT);
    if (name === STATE.CAMP) {
      Game.UIHunt.hideAllModals();
      Game.UICamp.refresh();
    }
  }

  function getScreen() {
    return currentScreen;
  }

  function init() {
    screenCamp = document.getElementById('screen-camp');
    screenHunt = document.getElementById('screen-hunt');

    Game.UICamp.init();
    Game.UIHunt.init();

    const canvasEl = document.getElementById('hunt-canvas');
    Game.Arena.init(canvasEl);
    // Zone is the canvas itself (not #screen-hunt) so pointerdowns on HUD buttons -
    // a sibling overlay, not a descendant of the canvas - never also trigger the
    // joystick underneath them.
    Game.Joystick.init(
      canvasEl,
      document.getElementById('joystick-base'),
      document.getElementById('joystick-knob')
    );

    showScreen(STATE.CAMP);
  }

  return { STATE: STATE, showScreen: showScreen, getScreen: getScreen, init: init };
})();
