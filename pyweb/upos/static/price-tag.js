/* Конструктор ценников: размер этикетки в мм, набор полей, живой
   предпросмотр и печать по реальным размерам. */
(() => {
  const SAMPLE = {
    name: "Kungaboqar yog'i Ласка, tozalangan, 1 litr",
    price: 30000,
    old_price: 34000,
    wholesale_price: 27500,
    sku: "182301",
    barcode: "4780016150014",
    created_at: "01.08.2026",
  };

  function money(value, format) {
    const number = Number(value) || 0;
    return format ? number.toLocaleString("ru-RU").replace(/ /g, " ") : String(number);
  }

  function today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  }

  /* Штрихкод рисуем сами: сторонние библиотеки на страницу не тянем. */
  function barcodeBars(code) {
    const digits = String(code || "").replace(/\D/g, "") || "0000000000000";
    let bars = "";
    for (let i = 0; i < digits.length; i += 1) {
      const value = Number(digits[i]);
      const width = 1 + (value % 3);
      bars += `<i style="width:${width}px"></i><u style="width:${1 + ((value + 1) % 2)}px"></u>`;
    }
    return bars;
  }

  function readState(root) {
    const state = {
      fields: {},
      positions: root._priceTagPositions || {},
      styles: root._priceTagStyles || {},
    };
    root.querySelectorAll("[data-price-tag-input]").forEach((input) => {
      const key = input.dataset.priceTagInput;
      state[key] = input.type === "checkbox" ? input.checked : input.value;
    });
    root.querySelectorAll("[data-price-tag-field]").forEach((input) => {
      state.fields[input.dataset.priceTagField] = input.checked;
    });
    return state;
  }

  /* Свободное размещение: элемент можно перетащить мышкой в любое место
     этикетки, координаты храним в миллиметрах — так же, как размер. */
  function applyPositions(root) {
    const positions = root._priceTagPositions || {};
    const state = readState(root);
    const maxX = Number(state.width) || 58;
    const maxY = Number(state.height) || 40;
    root.querySelectorAll("[data-tag-element]").forEach((node) => {
      const spot = positions[node.dataset.tagElement];
      if (!spot) {
        node.style.position = "";
        node.style.left = "";
        node.style.top = "";
        return;
      }
      // Даже сохранённые ранее координаты держим внутри этикетки.
      node.style.position = "absolute";
      node.style.left = `${Math.min(Math.max(0, spot.x), maxX)}mm`;
      node.style.top = `${Math.min(Math.max(0, spot.y), maxY)}mm`;
    });
  }

  function enableDragging(root) {
    const card = root.querySelector(".price-tag-card");
    if (!card) return;
    card.addEventListener("pointerdown", (event) => {
      const node = event.target.closest("[data-tag-element]");
      if (!node) return;
      event.preventDefault();
      root._priceTagSelected = node.dataset.tagElement;
      highlightSelected(root);
      const cardRect = card.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const mmPerPx = (Number(readState(root).width) || 58) / cardRect.width;
      const grabX = event.clientX - nodeRect.left;
      const grabY = event.clientY - nodeRect.top;
      try {
        node.setPointerCapture(event.pointerId);
      } catch (error) {
        /* захват указателя необязателен — двигаем по событиям документа */
      }
      card.classList.add("is-dragging");

      const state = readState(root);
      const cardWidthMm = Number(state.width) || 58;
      const cardHeightMm = Number(state.height) || 40;
      const nodeWidthMm = nodeRect.width * mmPerPx;
      const nodeHeightMm = nodeRect.height * mmPerPx;

      const move = (moveEvent) => {
        // Элемент не должен вылезать за пределы этикетки.
        const rawX = (moveEvent.clientX - cardRect.left - grabX) * mmPerPx;
        const rawY = (moveEvent.clientY - cardRect.top - grabY) * mmPerPx;
        const x = Math.min(Math.max(0, rawX), Math.max(0, cardWidthMm - nodeWidthMm));
        const y = Math.min(Math.max(0, rawY), Math.max(0, cardHeightMm - nodeHeightMm));
        root._priceTagPositions = root._priceTagPositions || {};
        root._priceTagPositions[node.dataset.tagElement] = {
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
        };
        applyPositions(root);
      };
      const stop = () => {
        card.classList.remove("is-dragging");
        node.removeEventListener("pointermove", move);
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        document.removeEventListener("pointercancel", stop);
      };
      // Слушаем и узел (когда сработал захват), и документ — курсор часто
      // уходит за пределы элемента быстрее, чем тот перерисуется.
      node.addEventListener("pointermove", move);
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      document.addEventListener("pointercancel", stop);
    });
  }

  function render(root) {
    const preview = root.querySelector("[data-price-tag-preview]");
    if (!preview) return;
    const state = readState(root);
    const on = (key) => Boolean(state.fields[key]);
    const width = Math.max(20, Number(state.width) || 58);
    const height = Math.max(15, Number(state.height) || 40);

    // Раскладка как в YesPOS: название сверху, крупная цена по центру,
    // снизу логотип слева и штрихкод справа. Каждый блок можно двигать
    // мышкой и настраивать его шрифт отдельно.
    const styles = state.styles || {};
    const block = (key, cls, inner) => {
      const style = styles[key] || {};
      const css = [
        style.size ? `font-size:${style.size}px` : "",
        style.weight ? `font-weight:${style.weight}` : "",
        style.align ? `text-align:${style.align}` : "",
      ].filter(Boolean).join(";");
      return `<div class="${cls}" data-tag-element="${key}" style="${css}">${inner}</div>`;
    };
    const text = (key, fallback) => (styles[key]?.text ? styles[key].text : fallback);

    const top = [];
    if (on("name")) top.push(block("name", "price-tag-name", text("name", SAMPLE.name)));
    if (on("old_price")) {
      const label = on("old_price_label") && state.old_price_label ? `${state.old_price_label} ` : "";
      top.push(block("old_price", "price-tag-old", `${label}<s>${text("old_price", money(SAMPLE.old_price, state.format_price))}</s>`));
    }
    if (on("price")) {
      top.push(block(
        "price",
        "price-tag-price",
        `<b>${text("price", money(SAMPLE.price, state.format_price))}</b><span>${state.price_suffix || ""}</span>`,
      ));
    }
    if (on("wholesale_price")) {
      top.push(block("wholesale_price", "price-tag-line", `Опт: ${text("wholesale_price", money(SAMPLE.wholesale_price, state.format_price))}`));
    }
    if (on("custom_text") && state.custom_text) top.push(block("custom_text", "price-tag-line", text("custom_text", state.custom_text)));
    if (on("custom_text2") && state.custom_text2) top.push(block("custom_text2", "price-tag-line", text("custom_text2", state.custom_text2)));
    if (on("custom_text3") && state.custom_text3) top.push(block("custom_text3", "price-tag-line", text("custom_text3", state.custom_text3)));
    if (on("created_at")) top.push(block("created_at", "price-tag-line", text("created_at", `Создан: ${SAMPLE.created_at}`)));
    if (on("printed_at")) top.push(block("printed_at", "price-tag-line", text("printed_at", `Напечатан: ${today()}`)));

    const left = on("logo")
      ? block("logo", "price-tag-logo", '<span class="price-tag-logo-mark">u</span><span class="price-tag-logo-word">u<b>POS</b></span>')
      : "";
    const right = [];
    if (on("sku")) right.push(block("sku", "price-tag-sku", text("sku", SAMPLE.sku)));
    if (on("barcode")) right.push(block("barcode", "price-tag-barcode", barcodeBars(SAMPLE.barcode)));
    const bottom = left || right.length
      ? `<div class="price-tag-bottom"><div>${left}</div><div class="price-tag-bottom-right">${right.join("")}</div></div>`
      : "";

    preview.style.setProperty("--price-tag-width", `${width}mm`);
    preview.style.setProperty("--price-tag-height", `${height}mm`);
    preview.innerHTML = `<div class="price-tag-card"><div class="price-tag-body">${top.join("")}</div>${bottom}</div>`;
    applyPositions(root);
    enableDragging(root);
    highlightSelected(root);
  }

  /* Панель шрифта выбранного элемента: размер, жирность, выравнивание, текст. */
  function selectedKey(root) {
    return root._priceTagSelected || "";
  }

  function highlightSelected(root) {
    const key = selectedKey(root);
    root.querySelectorAll("[data-tag-element]").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.tagElement === key);
    });
    const panel = root.querySelector("[data-price-tag-style-panel]");
    if (!panel) return;
    panel.hidden = !key;
    if (!key) return;
    const style = (root._priceTagStyles || {})[key] || {};
    const label = root.querySelector("[data-price-tag-style-name]");
    if (label) label.textContent = root.querySelector(`[data-price-tag-field="${key}"]`)?.parentElement?.textContent.trim() || key;
    panel.querySelector('[data-price-tag-style="size"]').value = style.size || "";
    panel.querySelector('[data-price-tag-style="weight"]').value = style.weight || "";
    panel.querySelector('[data-price-tag-style="align"]').value = style.align || "";
    panel.querySelector('[data-price-tag-style="text"]').value = style.text || "";
  }

  function setStatus(root, text) {
    const node = root.querySelector("[data-price-tag-status]");
    if (node) node.textContent = text;
  }

  async function save(root) {
    const state = readState(root);
    setStatus(root, "Сохраняем…");
    try {
      const response = await fetch("/api/settings/price-tag", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
            || document.querySelector('input[name="csrf_token"]')?.value
            || "",
        },
        body: JSON.stringify({ price_tag: state }),
      });
      const data = await response.json();
      setStatus(root, response.ok && data.ok ? "Сохранено" : "Не удалось сохранить");
    } catch (error) {
      setStatus(root, "Не удалось сохранить");
    }
  }

  function print(root) {
    const card = root.querySelector(".price-tag-card");
    if (!card) return;
    const state = readState(root);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-9999px;width:0;height:0;border:0";
    document.body.append(frame);
    const styles = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((link) => `<link rel="stylesheet" href="${link.href}">`)
      .join("");
    const doc = frame.contentDocument;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8">${styles}`
        + `<style>@page{size:${state.width}mm ${state.height}mm;margin:0}`
        + `body{margin:0}.price-tag-preview{--price-tag-width:${state.width}mm;--price-tag-height:${state.height}mm}</style>`
        + `</head><body><div class="price-tag-preview">${card.outerHTML}</div></body></html>`,
    );
    doc.close();
    frame.contentWindow.focus();
    window.setTimeout(() => {
      frame.contentWindow.print();
      window.setTimeout(() => frame.remove(), 1000);
    }, 350);
  }

  function init(root) {
    if (!root || root.dataset.priceTagReady === "1") return;
    root.dataset.priceTagReady = "1";

    // Сохранённые положения и шрифты элементов.
    try {
      const saved = JSON.parse(root.querySelector("[data-price-tag-initial]")?.textContent || "{}");
      root._priceTagPositions = saved.positions && typeof saved.positions === "object" ? saved.positions : {};
      root._priceTagStyles = saved.styles && typeof saved.styles === "object" ? saved.styles : {};
    } catch (error) {
      root._priceTagPositions = {};
      root._priceTagStyles = {};
    }

    const rerender = (event) => {
      const styleInput = event.target.closest?.("[data-price-tag-style]");
      if (styleInput) {
        const key = selectedKey(root);
        if (!key) return;
        root._priceTagStyles = root._priceTagStyles || {};
        const style = { ...(root._priceTagStyles[key] || {}) };
        const value = styleInput.value.trim();
        if (value) style[styleInput.dataset.priceTagStyle] = value;
        else delete style[styleInput.dataset.priceTagStyle];
        root._priceTagStyles[key] = style;
      }
      render(root);
    };
    root.addEventListener("input", rerender);
    root.addEventListener("change", rerender);
    root.querySelector("[data-price-tag-save]")?.addEventListener("click", () => save(root));
    root.querySelector("[data-price-tag-print]")?.addEventListener("click", () => print(root));
    root.querySelector("[data-price-tag-reset-layout]")?.addEventListener("click", () => {
      root._priceTagPositions = {};
      root._priceTagStyles = {};
      root._priceTagSelected = "";
      render(root);
      setStatus(root, "Раскладка сброшена — не забудьте сохранить");
    });
    render(root);
  }

  const boot = () => document.querySelectorAll("[data-price-tag-editor]").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
