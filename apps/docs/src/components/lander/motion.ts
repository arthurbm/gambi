// One switch for every looping figure on the landing. Motion stops when the
// visitor asks the OS for reduced motion, or when they press the pause
// control in the nav. The choice is kept per browser; an inline script in
// Lander.astro restores it before these modules run.

const KEY = "gambi-motion";
const EVENT = "gambi:motion";
const root = document.documentElement;
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

export const isPaused = () => root.dataset.motion === "paused";

export const isStill = () => reduce.matches || isPaused();

export const setPaused = (paused: boolean) => {
  if (paused) {
    root.dataset.motion = "paused";
  } else {
    delete root.dataset.motion;
  }
  try {
    localStorage.setItem(KEY, paused ? "paused" : "");
  } catch {
    // Storage can be blocked; the choice then lasts for this page view.
  }
  document.dispatchEvent(new Event(EVENT));
};

export const onMotionChange = (fn: (still: boolean) => void) => {
  document.addEventListener(EVENT, () => fn(isStill()));
  reduce.addEventListener("change", () => fn(isStill()));
};
