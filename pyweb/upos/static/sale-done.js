/* Подтверждение после продажи, заказа, возврата или оплаты: показываем
   итог документа и даём напечатать чек или ценники на его позиции. */
(() => {
  const TITLES = {
    saved: "Продажа проведена",
    order_saved: "Заказ сохранён",
    return_saved: "Возврат оформлен",
    updated: "Документ обновлён",
    paid: "Оплата внесена",
    converted: "Продажа создана из заказа",
  };

  function docData(saleId) {
    const node = document.getElementById(`sales-journal-data-${saleId}`);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (error) {
      return null;
    }
  }

  function tagSettings() {
    const node = document.querySelector("[data-price-tag-settings]");
    try {
      return JSON.parse(node?.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  function printWindow(title, body, pageCss) {
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
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}`
        + `<style>${pageCss || ""}</style></head><body>${body}</body></html>`,
    );
    doc.close();
    frame.contentWindow.focus();
    window.setTimeout(() => {
      frame.contentWindow.print();
      window.setTimeout(() => frame.remove(), 1200);
    }, 300);
  }

  function receiptHtml(doc) {
    const rows = (doc.items || [])
      .map(
        (item) => `<tr><td>${item.name || ""}</td><td class="num">${item.quantity || ""}</td>`
          + `<td class="num">${item.price || ""}</td><td class="num">${item.total || item.sum || ""}</td></tr>`,
      )
      .join("");
    return `<div class="sale-receipt">
      <h1>${doc.number ? `Чек ${doc.number}` : "Чек"}</h1>
      <p>${doc.date || ""}${doc.client ? ` · ${doc.client}` : ""}</p>
      <table>
        <thead><tr><th>Товар</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="sale-receipt-total">Итого: ${doc.amount || ""}</p>
      ${doc.paid_amount ? `<p>Оплачено: ${doc.paid_amount}</p>` : ""}
      ${doc.debt_amount && doc.debt_amount !== "0" ? `<p>Долг: ${doc.debt_amount}</p>` : ""}
    </div>`;
  }

  function tagsHtml(doc) {
    const settings = tagSettings();
    const width = Number(settings.width) || 58;
    const height = Number(settings.height) || 40;
    const fields = settings.fields || {};
    const suffix = settings.price_suffix || "";
    const cards = (doc.items || [])
      .map((item) => {
        const parts = [];
        if (fields.name !== false) parts.push(`<div class="price-tag-name">${item.name || ""}</div>`);
        parts.push(`<div class="price-tag-price"><b>${item.price || ""}</b><span>${suffix}</span></div>`);
        if (item.sku) parts.push(`<div class="price-tag-sku">${item.sku}</div>`);
        return `<div class="price-tag-preview" style="--price-tag-width:${width}mm;--price-tag-height:${height}mm">`
          + `<div class="price-tag-card"><div class="price-tag-body">${parts.join("")}</div></div></div>`;
      })
      .join("");
    return `<div class="sale-tags-sheet">${cards}</div>`;
  }

  function open(dialog, message, saleId) {
    const doc = docData(saleId) || {};
    dialog.querySelector("[data-sale-done-title]").textContent = TITLES[message] || "Готово";
    dialog.querySelector("[data-sale-done-sum]").textContent = doc.amount ? `${doc.amount}` : "";
    const meta = [doc.number ? `№ ${doc.number}` : "", doc.client || "", doc.date || ""]
      .filter(Boolean)
      .join(" · ");
    dialog.querySelector("[data-sale-done-meta]").textContent = meta;
    dialog._saleDoneDoc = doc;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function init() {
    const dialog = document.querySelector("[data-sale-done-dialog]");
    if (!dialog || dialog.dataset.saleDoneReady === "1") return;
    dialog.dataset.saleDoneReady = "1";

    dialog.querySelector("[data-sale-done-close]")?.addEventListener("click", () => dialog.close?.());
    dialog.querySelector("[data-sale-done-print-receipt]")?.addEventListener("click", () => {
      printWindow("Чек", receiptHtml(dialog._saleDoneDoc || {}), "body{font-family:Inter,Arial,sans-serif;padding:8mm}"
        + ".sale-receipt table{width:100%;border-collapse:collapse}"
        + ".sale-receipt th,.sale-receipt td{padding:2mm 1mm;border-bottom:1px solid #cbd5e1;font-size:10pt}"
        + ".sale-receipt .num{text-align:right}.sale-receipt-total{font-weight:800;font-size:12pt}");
    });
    dialog.querySelector("[data-sale-done-print-tags]")?.addEventListener("click", () => {
      const settings = tagSettings();
      printWindow(
        "Ценники",
        tagsHtml(dialog._saleDoneDoc || {}),
        `@page{size:${Number(settings.width) || 58}mm ${Number(settings.height) || 40}mm;margin:0}`
          + "body{margin:0}.sale-tags-sheet{display:flex;flex-wrap:wrap}",
      );
    });

    const params = new URLSearchParams(window.location.search);
    const message = params.get("msg") || "";
    const saleId = params.get("saved_id") || "";
    if (message in TITLES && saleId) {
      open(dialog, message, saleId);
      // Повторное обновление страницы не должно снова открывать окно.
      const url = new URL(window.location.href);
      url.searchParams.delete("msg");
      url.searchParams.delete("saved_id");
      window.history.replaceState(null, "", url.toString());
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
