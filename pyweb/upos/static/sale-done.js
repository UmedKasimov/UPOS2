/* Подтверждение после продажи, заказа, возврата или оплаты: показываем
   итог документа и даём напечатать чек. */
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function lineName(item) {
    return item.name || item.product || item.title || "";
  }

  function lineQuantity(item) {
    return item.quantity || item.qty || "";
  }

  function linePrice(item) {
    return item.price || "";
  }

  function lineTotal(item) {
    return item.total || item.sum || "";
  }

  function formatAmountText(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/^([+-]?\d[\d\s.,]*)(.*)$/);
    if (!match) return raw;
    const compact = match[1].replace(/\s+/g, "").replace(",", ".");
    const amount = Number(compact);
    if (!Number.isFinite(amount)) return raw;
    const hasDecimal = /[.,]\d/.test(match[1]);
    const formatted = amount.toLocaleString("ru-RU", {
      maximumFractionDigits: hasDecimal ? 2 : 0,
    });
    return `${formatted}${match[2] || ""}`.trim();
  }

  function moneyWithCurrency(amount, currency) {
    const text = String(amount || "").trim();
    const code = String(currency || "").trim();
    if (!text) return "";
    const formatted = formatAmountText(text);
    if (!code || formatted.toUpperCase().endsWith(` ${code.toUpperCase()}`)) return formatted;
    return `${formatted} ${code}`;
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
        (item) => `<tr><td>${escapeHtml(lineName(item))}</td><td class="num">${escapeHtml(lineQuantity(item))}</td>`
          + `<td class="num">${escapeHtml(moneyWithCurrency(linePrice(item), doc.currency))}</td><td class="num">${escapeHtml(moneyWithCurrency(lineTotal(item), doc.currency))}</td></tr>`,
      )
      .join("");
    return `<div class="sale-receipt">
      <h1>${doc.number ? `Чек ${escapeHtml(doc.number)}` : "Чек"}</h1>
      <p>${escapeHtml(doc.date || "")}${doc.client ? ` · ${escapeHtml(doc.client)}` : ""}</p>
      <table>
        <thead><tr><th>Товар</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="sale-receipt-total">Итого: ${escapeHtml(moneyWithCurrency(doc.amount, doc.currency))}</p>
      ${doc.paid_amount ? `<p>Оплачено: ${escapeHtml(moneyWithCurrency(doc.paid_amount, doc.currency))}</p>` : ""}
      ${doc.debt_amount && doc.debt_amount !== "0" ? `<p>Долг: ${escapeHtml(moneyWithCurrency(doc.debt_amount, doc.currency))}</p>` : ""}
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
        if (fields.name !== false) parts.push(`<div class="price-tag-name">${escapeHtml(lineName(item))}</div>`);
        parts.push(`<div class="price-tag-price"><b>${escapeHtml(linePrice(item))}</b><span>${escapeHtml(suffix)}</span></div>`);
        if (item.sku) parts.push(`<div class="price-tag-sku">${escapeHtml(item.sku)}</div>`);
        return `<div class="price-tag-preview" style="--price-tag-width:${width}mm;--price-tag-height:${height}mm">`
          + `<div class="price-tag-card"><div class="price-tag-body">${parts.join("")}</div></div></div>`;
      })
      .join("");
    return `<div class="sale-tags-sheet">${cards}</div>`;
  }

  function normalizedItems(doc) {
    const items = Array.isArray(doc.items) && doc.items.length ? doc.items : doc.lines;
    return (Array.isArray(items) ? items : []).filter((item) => item && lineName(item));
  }

  function renderSummary(dialog, doc) {
    const node = dialog.querySelector("[data-sale-done-summary]");
    if (!node) return;
    const items = normalizedItems(doc);
    const payments = Array.isArray(doc.payment_lines) ? doc.payment_lines : [];
    const clientHtml = doc.client
      ? `<section class="sale-done-section sale-done-client">
          <span>Клиент</span>
          <table class="sale-done-table">
            <tbody><tr><th>Имя</th><td>${escapeHtml(doc.client)}</td></tr></tbody>
          </table>
        </section>`
      : "";
    const itemRows = items.map((item) => {
      const qty = lineQuantity(item);
      const price = moneyWithCurrency(linePrice(item), doc.currency);
      const total = moneyWithCurrency(lineTotal(item), doc.currency);
      return `<tr>
        <td>${escapeHtml(lineName(item))}</td>
        <td class="sale-done-num">${escapeHtml(qty)}</td>
        <td class="sale-done-num">${escapeHtml(price)}</td>
        <td class="sale-done-num"><strong>${escapeHtml(total || price)}</strong></td>
      </tr>`;
    }).join("");
    const paymentRows = payments.length
      ? payments.map((payment, index) => {
          const label = payment.account || payment.type || `Оплата ${index + 1}`;
          return `<tr>
            <td>${escapeHtml(label)}</td>
            <td>${escapeHtml(payment.type || "-")}</td>
            <td class="sale-done-num"><strong>${escapeHtml(moneyWithCurrency(payment.amount, payment.currency || doc.currency))}</strong></td>
          </tr>`;
        }).join("")
      : `<tr class="sale-done-muted"><td>Оплата не внесена</td><td>-</td><td class="sale-done-num"><strong>${escapeHtml(moneyWithCurrency(doc.outstanding_amount || doc.amount, doc.currency))}</strong></td></tr>`;
    node.innerHTML = `${clientHtml}
      ${items.length ? `<section class="sale-done-section">
        <span>Заказ</span>
        <table class="sale-done-table">
          <thead><tr><th>Товар</th><th class="sale-done-num">К-во</th><th class="sale-done-num">Цена</th><th class="sale-done-num">Сумма</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </section>` : ""}
      <section class="sale-done-section">
        <span>Оплата</span>
        <table class="sale-done-table">
          <thead><tr><th>Счёт</th><th>Тип</th><th class="sale-done-num">Сумма</th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      </section>`;
  }

  function open(dialog, message, saleId) {
    const doc = docData(saleId) || {};
    doc.items = normalizedItems(doc);
    const params = new URLSearchParams(window.location.search);
    const paidNow = String(params.get("paid_now") || "").trim();
    const currency = String(params.get("currency") || "").trim();
    dialog.querySelector("[data-sale-done-title]").textContent = TITLES[message] || "Готово";
    // Для оплаты показываем сумму именно этого платежа, а не всего документа.
    const sumText = message === "paid" && paidNow ? paidNow : doc.amount ? `${doc.amount}` : "";
    dialog.querySelector("[data-sale-done-sum]").textContent = sumText;
    const metaParts = [doc.number ? `№ ${doc.number}` : "", doc.client || "", doc.date || ""];
    // При частичной оплате подсказываем остаток к оплате. Берём именно
    // остаток (outstanding), а не «бухгалтерский» долг: у статуса «Новый»
    // долг ещё не признан и равен нулю, хотя доплатить нужно.
    const remaining = String(doc.outstanding_amount || doc.debt_amount || "").trim();
    if (message === "paid" && remaining && remaining !== "0") {
      metaParts.push(`Остаток: ${remaining}${currency ? " " + currency : ""}`);
    }
    dialog.querySelector("[data-sale-done-meta]").textContent = metaParts.filter(Boolean).join(" · ");
    renderSummary(dialog, doc);
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
    const params = new URLSearchParams(window.location.search);
    const message = params.get("msg") || "";
    const saleId = params.get("saved_id") || "";
    if (message in TITLES && saleId) {
      open(dialog, message, saleId);
      // Повторное обновление страницы не должно снова открывать окно.
      const url = new URL(window.location.href);
      url.searchParams.delete("msg");
      url.searchParams.delete("saved_id");
      url.searchParams.delete("paid_now");
      url.searchParams.delete("currency");
      window.history.replaceState(null, "", url.toString());
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
