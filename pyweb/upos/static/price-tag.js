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
    const state = { fields: {} };
    root.querySelectorAll("[data-price-tag-input]").forEach((input) => {
      const key = input.dataset.priceTagInput;
      state[key] = input.type === "checkbox" ? input.checked : input.value;
    });
    root.querySelectorAll("[data-price-tag-field]").forEach((input) => {
      state.fields[input.dataset.priceTagField] = input.checked;
    });
    return state;
  }

  function render(root) {
    const preview = root.querySelector("[data-price-tag-preview]");
    if (!preview) return;
    const state = readState(root);
    const on = (key) => Boolean(state.fields[key]);
    const width = Math.max(20, Number(state.width) || 58);
    const height = Math.max(15, Number(state.height) || 40);

    const parts = [];
    if (on("logo")) {
      parts.push('<div class="price-tag-logo"><span class="price-tag-logo-mark">u</span><span class="price-tag-logo-word">u<b>POS</b></span></div>');
    }
    if (on("name")) parts.push(`<div class="price-tag-name">${SAMPLE.name}</div>`);
    if (on("old_price")) {
      const label = on("old_price_label") && state.old_price_label ? `${state.old_price_label} ` : "";
      parts.push(`<div class="price-tag-old">${label}<s>${money(SAMPLE.old_price, state.format_price)}</s></div>`);
    }
    if (on("price")) {
      parts.push(
        `<div class="price-tag-price"><b>${money(SAMPLE.price, state.format_price)}</b><span>${state.price_suffix || ""}</span></div>`,
      );
    }
    if (on("wholesale_price")) {
      parts.push(`<div class="price-tag-line">Опт: ${money(SAMPLE.wholesale_price, state.format_price)}</div>`);
    }
    if (on("sku")) parts.push(`<div class="price-tag-line">${SAMPLE.sku}</div>`);
    if (on("custom_text") && state.custom_text) parts.push(`<div class="price-tag-line">${state.custom_text}</div>`);
    if (on("custom_text2") && state.custom_text2) parts.push(`<div class="price-tag-line">${state.custom_text2}</div>`);
    if (on("custom_text3") && state.custom_text3) parts.push(`<div class="price-tag-line">${state.custom_text3}</div>`);
    if (on("created_at")) parts.push(`<div class="price-tag-line">Создан: ${SAMPLE.created_at}</div>`);
    if (on("printed_at")) parts.push(`<div class="price-tag-line">Напечатан: ${today()}</div>`);
    if (on("barcode")) {
      parts.push(`<div class="price-tag-barcode">${barcodeBars(SAMPLE.barcode)}</div><div class="price-tag-line">${SAMPLE.barcode}</div>`);
    }

    preview.style.setProperty("--price-tag-width", `${width}mm`);
    preview.style.setProperty("--price-tag-height", `${height}mm`);
    preview.innerHTML = `<div class="price-tag-card">${parts.join("")}</div>`;
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
    root.addEventListener("input", () => render(root));
    root.addEventListener("change", () => render(root));
    root.querySelector("[data-price-tag-save]")?.addEventListener("click", () => save(root));
    root.querySelector("[data-price-tag-print]")?.addEventListener("click", () => print(root));
    render(root);
  }

  const boot = () => document.querySelectorAll("[data-price-tag-editor]").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
