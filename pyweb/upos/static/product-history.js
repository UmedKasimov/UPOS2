/* История товара и история цен: модалки поверх каталога товаров. */
(() => {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }

  function ensureDialog() {
    let dialog = document.querySelector("[data-product-history-dialog]");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "product-history-dialog";
    dialog.setAttribute("data-product-history-dialog", "");
    dialog.innerHTML = `
      <div class="product-history-surface">
        <header class="product-history-head">
          <div>
            <h3 data-product-history-title>История</h3>
            <p data-product-history-subtitle></p>
          </div>
          <button type="button" class="product-history-close" data-product-history-close aria-label="Закрыть">×</button>
        </header>
        <div class="product-history-body" data-product-history-body>
          <p class="product-history-loading">Загрузка…</p>
        </div>
      </div>`;
    document.body.append(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-product-history-close]")) dialog.close();
    });
    return dialog;
  }

  function movementsHtml(payload) {
    const rows = payload.movements || [];
    if (!rows.length) return '<p class="product-history-empty">Движений по товару пока нет.</p>';
    const body = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}<small>${escapeHtml(row.time)}</small></td>
        <td><strong>${escapeHtml(row.document)}</strong></td>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.warehouse || "-")}</td>
        <td class="num">${escapeHtml(row.before)}</td>
        <td class="num product-history-delta ${String(row.delta_label).startsWith("-") ? "is-out" : "is-in"}">${escapeHtml(row.delta_label)}</td>
        <td class="num">${escapeHtml(row.after)}</td>
        <td class="num">${row.price ? `${escapeHtml(row.price)} ${escapeHtml(row.currency)}` : "-"}</td>
      </tr>`).join("");
    return `
      <div class="products-table-wrap product-history-table-wrap">
        <table class="products-table product-history-table">
          <thead>
            <tr><th>Дата</th><th>Документ</th><th>Операция</th><th>Склад</th><th>До</th><th>Кол-во</th><th>После</th><th>Цена</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function pricesHtml(payload) {
    const rows = payload.prices || [];
    if (!rows.length) return '<p class="product-history-empty">Изменений цен пока нет.</p>';
    const body = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}<small>${escapeHtml(row.time)}</small></td>
        <td>${escapeHtml(row.kind)}</td>
        <td class="num">${escapeHtml(row.old_price)}</td>
        <td class="product-history-arrow" aria-hidden="true">→</td>
        <td class="num"><strong>${escapeHtml(row.price)} ${escapeHtml(row.currency)}</strong></td>
        <td>${escapeHtml(row.document)}</td>
        <td>${escapeHtml(row.actor || "-")}</td>
      </tr>`).join("");
    return `
      <div class="products-table-wrap product-history-table-wrap">
        <table class="products-table product-history-table">
          <thead>
            <tr><th>Дата</th><th>Цена</th><th>Было</th><th></th><th>Стало</th><th>Документ</th><th>Кто</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  async function openHistory(productId, name, mode) {
    const dialog = ensureDialog();
    const title = dialog.querySelector("[data-product-history-title]");
    const subtitle = dialog.querySelector("[data-product-history-subtitle]");
    const body = dialog.querySelector("[data-product-history-body]");
    title.textContent = mode === "prices" ? "История изменения цен" : "История товара";
    subtitle.textContent = name || "";
    body.innerHTML = '<p class="product-history-loading">Загрузка…</p>';
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/history`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.product) {
        subtitle.textContent = [payload.product.name, payload.product.sku && `Артикул: ${payload.product.sku}`, payload.product.unit]
          .filter(Boolean)
          .join(" · ");
      }
      body.innerHTML = mode === "prices" ? pricesHtml(payload) : movementsHtml(payload);
    } catch (error) {
      body.innerHTML = `<p class="product-history-empty">Не удалось загрузить историю (${escapeHtml(error.message)}).</p>`;
    }
  }

  document.addEventListener("click", (event) => {
    const movementBtn = event.target.closest("[data-product-history]");
    if (movementBtn) {
      openHistory(movementBtn.dataset.productHistory, movementBtn.dataset.productHistoryName, "movements");
      return;
    }
    const priceBtn = event.target.closest("[data-product-price-history]");
    if (priceBtn) {
      openHistory(priceBtn.dataset.productPriceHistory, priceBtn.dataset.productHistoryName, "prices");
    }
  });
})();
