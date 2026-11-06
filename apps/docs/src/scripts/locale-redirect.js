// Picks the docs language from the visitor's device on the first page they
// open, then follows their choice. Inlined into <head> by astro.config.mjs,
// so it runs before the page paints; keep it small and dependency-free.
//
// - Arriving from another site (or typing the URL): go to the saved
//   language, or to the device language when nothing is saved yet.
// - Moving between pages of this site, including through the language
//   picker: never redirect, and remember the language being read.
(() => {
  const KEY = "gambi-lang";
  const PREFIX = "/pt-br";
  const path = location.pathname;
  const current =
    path === PREFIX || path.startsWith(`${PREFIX}/`) ? "pt-br" : "en";

  let internal = false;
  try {
    internal =
      document.referrer !== "" &&
      new URL(document.referrer).origin === location.origin;
  } catch {
    // An unparsable referrer counts as an external arrival.
  }

  let saved = null;
  try {
    if (internal) {
      localStorage.setItem(KEY, current);
      return;
    }
    saved = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: fall back to the device language on every arrival.
  }

  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language || ""];
  // The first language the docs have, in the visitor's order of preference.
  const first = languages
    .map((lang) => lang.toLowerCase())
    .find((lang) => lang.startsWith("pt") || lang.startsWith("en"));
  const device = first?.startsWith("pt") ? "pt-br" : "en";
  const wanted = saved === "en" || saved === "pt-br" ? saved : device;
  if (wanted === current) {
    return;
  }

  const target =
    wanted === "pt-br" ? PREFIX + path : path.slice(PREFIX.length) || "/";
  location.replace(target + location.search + location.hash);
})();
