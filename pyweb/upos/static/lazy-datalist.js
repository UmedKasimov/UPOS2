/* Materialize large native datalists only when their input is used. */
(() => {
  "use strict";

  const parsedSources = new Map();

  function sourceValues(sourceId) {
    if (parsedSources.has(sourceId)) return parsedSources.get(sourceId);
    const source = document.getElementById(sourceId);
    let values = [];
    if (source) {
      try {
        const payload = JSON.parse(source.textContent || "[]");
        if (Array.isArray(payload)) values = payload;
      } catch {
        values = [];
      }
    }
    parsedSources.set(sourceId, values);
    return values;
  }

  function materialize(input) {
    const listId = input?.getAttribute?.("list") || "";
    if (!listId) return;
    const list = document.getElementById(listId);
    const sourceId = list?.dataset?.uposLazyDatalist || "";
    if (!list || !sourceId || list.dataset.uposLazyReady === "1") return;
    const fragment = document.createDocumentFragment();
    sourceValues(sourceId).forEach((value) => {
      const option = document.createElement("option");
      option.value = String(value ?? "");
      fragment.appendChild(option);
    });
    list.appendChild(fragment);
    list.dataset.uposLazyReady = "1";
  }

  ["pointerdown", "focusin", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      const input = event.target instanceof Element ? event.target.closest("input[list]") : null;
      materialize(input);
    }, { capture: true, passive: true });
  });

  window.UPOSLazyDatalist = { materialize };
})();
