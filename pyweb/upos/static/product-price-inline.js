/* Правка цены прямо в каталоге товаров.
 *
 * Раньше, чтобы поменять цену, приходилось открывать карточку товара или
 * экран прайс-листов. Администратор меняет её здесь: клик по ячейке
 * превращает её в поле ввода, Enter сохраняет, Escape отменяет.
 *
 * Расчётные прайс-листы сюда не попадают: сервер их не отдаёт как
 * редактируемые, потому что значение пересчитается заново.
 */
(() => {
  "use strict";

  const CELL = "[data-product-price-edit]";

  function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  }

  function moneyText(value) {
    const number = Number(String(value || "").replace(",", "."));
    if (!isFinite(number) || !number) return "";
    // Пробел-разделитель как в остальном каталоге.
    return number.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }

  function renderValue(cell) {
    const raw = cell.dataset.priceRaw || "";
    const currency = cell.dataset.priceCurrency || "UZS";
    const strong = document.createElement("strong");
    if (raw) {
      strong.textContent = `${moneyText(raw)} ${currency}`;
      cell.classList.remove("is-empty");
    } else {
      strong.textContent = "Не задана";
      cell.classList.add("is-empty");
    }
    cell.textContent = "";
    cell.append(strong);
  }

  function setBusy(cell, busy) {
    cell.classList.toggle("is-saving", Boolean(busy));
  }

  function startEdit(cell) {
    if (cell.classList.contains("is-editing")) return;
    cell.classList.add("is-editing");

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "products-price-inline-input";
    input.value = cell.dataset.priceRaw || "";
    input.setAttribute("aria-label", `${cell.dataset.priceName || "Цена"} — новое значение`);
    cell.textContent = "";
    cell.append(input);
    input.focus();
    input.select();

    let settled = false;

    const finish = (save) => {
      if (settled) return;
      settled = true;
      cell.classList.remove("is-editing");
      if (!save) {
        renderValue(cell);
        return;
      }
      const next = String(input.value || "").trim();
      if (next === String(cell.dataset.priceRaw || "").trim()) {
        renderValue(cell);
        return;
      }
      save_(cell, next);
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function save_(cell, value) {
    setBusy(cell, true);
    renderValue(cell);
    fetch(`/api/products/${encodeURIComponent(cell.dataset.productId || "")}/price`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify({
        price_type_id: cell.dataset.priceTypeId || "",
        price: value,
        currency: cell.dataset.priceCurrency || "UZS",
      }),
    })
      .then((response) =>
        response
          .json()
          .catch(() => ({}))
          .then((body) => {
            if (!response.ok || !body.ok) throw new Error(body.error || "Не удалось сохранить цену");
            return body;
          })
      )
      .then((body) => {
        cell.dataset.priceRaw = body.price || "";
        cell.dataset.priceCurrency = body.currency || cell.dataset.priceCurrency || "UZS";
        renderValue(cell);
        cell.classList.add("is-saved");
        window.setTimeout(() => cell.classList.remove("is-saved"), 1200);
      })
      .catch((error) => {
        renderValue(cell);
        cell.classList.add("is-error");
        cell.title = error.message || "Не удалось сохранить цену";
        window.setTimeout(() => cell.classList.remove("is-error"), 2500);
      })
      .then(() => setBusy(cell, false));
  }

  document.addEventListener("click", (event) => {
    const cell = event.target instanceof Element ? event.target.closest(CELL) : null;
    if (!cell || cell.classList.contains("is-editing")) return;
    // Клик по строке товара не должен открывать карточку — правим цену.
    event.preventDefault();
    event.stopPropagation();
    startEdit(cell);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const cell = event.target instanceof Element ? event.target.closest(CELL) : null;
    if (!cell || cell.classList.contains("is-editing")) return;
    event.preventDefault();
    startEdit(cell);
  });
})();
