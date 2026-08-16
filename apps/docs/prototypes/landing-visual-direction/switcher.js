// PROTÓTIPO DESCARTÁVEL — barra de troca de variante.
// Ticket #60 do mapa #58. Não vai para a landing real.
(function () {
  const VARIANTS = [
    { file: "a-quadro.html", key: "A", name: "Quadro de partidas" },
    { file: "b-mesa.html", key: "B", name: "Mesa de som" },
    { file: "c-segmentos.html", key: "C", name: "Mostrador de segmentos" },
    { file: "d-benjamin.html", key: "D", name: "Gambiarra elétrica" },
  ];

  const here = location.pathname.split("/").pop() || "a-quadro.html";
  const index = Math.max(
    0,
    VARIANTS.findIndex((v) => v.file === here)
  );
  const current = VARIANTS[index];

  const go = (delta) => {
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length];
    location.href = next.file;
  };

  const bar = document.createElement("div");
  bar.className = "proto-switcher";
  bar.innerHTML = `
    <button type="button" data-dir="-1" aria-label="Variante anterior">←</button>
    <span><b>${current.key}</b> — ${current.name}<i>${index + 1}/${VARIANTS.length}</i></span>
    <button type="button" data-dir="1" aria-label="Próxima variante">→</button>
    <a href="index.html">todas</a>
  `;
  document.body.appendChild(bar);

  for (const button of bar.querySelectorAll("button")) {
    button.addEventListener("click", () => go(Number(button.dataset.dir)));
  }

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (document.activeElement?.isContentEditable) return;
    if (event.key === "ArrowLeft") go(-1);
    if (event.key === "ArrowRight") go(1);
  });

  const style = document.createElement("style");
  style.textContent = `
    .proto-switcher {
      position: fixed; z-index: 9999; left: 50%; bottom: 20px;
      transform: translateX(-50%);
      display: flex; align-items: center; gap: 4px;
      padding: 5px 6px;
      font: 500 12px/1 ui-monospace, "JetBrains Mono", monospace;
      color: #0b0b0c; background: #f4f3ef;
      border-radius: 999px;
      box-shadow: 0 12px 32px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.18);
    }
    .proto-switcher button, .proto-switcher a {
      appearance: none; border: 0; cursor: pointer;
      background: transparent; color: inherit; text-decoration: none;
      padding: 7px 10px; border-radius: 999px;
      font: inherit;
      transition: background-color 140ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .proto-switcher a { font-size: 11px; opacity: 0.5; }
    @media (hover: hover) and (pointer: fine) {
      .proto-switcher button:hover, .proto-switcher a:hover { background: #dedbd2; }
    }
    .proto-switcher button:active { transform: scale(0.94); }
    .proto-switcher span { padding: 0 8px; display: flex; gap: 8px; align-items: baseline; white-space: nowrap; }
    @media (max-width: 520px) {
      .proto-switcher { font-size: 11px; bottom: 12px; }
      .proto-switcher button, .proto-switcher a { padding: 6px 8px; }
      .proto-switcher span { padding: 0 4px; }
    }
    .proto-switcher b { font-weight: 700; }
    .proto-switcher i { font-style: normal; opacity: 0.4; font-size: 11px; }
  `;
  document.head.appendChild(style);
})();
