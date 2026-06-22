(() => {
  const MIN_QUERY_LENGTH = 1;
  const MAX_RESULTS = 5;

  function productOptions() {
    const list = document.getElementById("sales-product-list");
    if (!list) return [];
    return Array.from(list.options).map((option) => ({
      name: String(option.value || "").trim(),
      price: String(option.dataset.price || "").trim(),
      currency: String(option.dataset.currency || "").trim(),
      prices: parseJson(option.dataset.prices, {}),
      quantity: String(option.dataset.quantity || "0").trim(),
    })).filter((item) => item.name);
  }

  function clientOptions() {
    const list = document.getElementById("sales-client-list");
    if (!list) return [];
    return Array.from(list.options).map((option) => String(option.value || "").trim()).filter(Boolean);
  }

  function warehouseOptions() {
    const list = document.getElementById("sales-warehouse-list");
    if (!list) return ["Основной склад"];
    const options = Array.from(list.options).map((option) => String(option.value || "").trim()).filter(Boolean);
    return options.length ? options : ["Основной склад"];
  }

  function parseJson(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function findProduct(input) {
    const value = normalize(input.value);
    if (!value) return null;
    return productOptions().find((item) => normalize(item.name) === value) || null;
  }

  function selectedProductName(input) {
    return String(input?.dataset.salesSelectedProduct || "").trim();
  }

  function selectedProductNames(form, currentLine) {
    const selected = new Set();
    form?.querySelectorAll("[data-sales-line]").forEach((line) => {
      if (line === currentLine) return;
      const input = line.querySelector("[data-sales-product-search]");
      const name = selectedProductName(input) || findProduct(input)?.name || "";
      if (name) selected.add(normalize(name));
    });
    return selected;
  }

  function lockProductInput(input, productName) {
    input.value = productName;
    input.dataset.salesSelectedProduct = productName;
    input.readOnly = true;
    input.classList.add("is-product-selected");
  }

  function selectedPriceType(form) {
    return String(form?.querySelector("[data-sales-price-type]")?.value || "").trim();
  }

  function parseMoney(value) {
    const clean = String(value || "")
      .replace(/\s+/g, "")
      .replace(",", ".")
      .replace(/[^0-9.-]/g, "");
    const number = Number(clean);
    return Number.isFinite(number) ? number : 0;
  }

  function usdUzsRate(form) {
    const rate = parseMoney(form?.dataset.salesUsdUzsRate || "12000");
    return rate > 0 ? rate : 12000;
  }

  function selectedCurrency(form) {
    return String(form?.querySelector("[data-sales-currency]")?.value || "UZS").trim().toUpperCase() || "UZS";
  }

  function formatMoney(value, currency) {
    if (!Number.isFinite(value)) return "";
    const digits = String(currency || "").toUpperCase() === "USD" ? 2 : 0;
    return value.toFixed(digits).replace(/\.?0+$/, "");
  }

  function moneyWithCurrency(value, currency) {
    const text = String(value || "0").trim() || "0";
    const code = String(currency || "UZS").trim() || "UZS";
    return `${text} ${code}`;
  }

  function convertMoney(value, fromCurrency, toCurrency, form) {
    const amount = parseMoney(value);
    const source = String(fromCurrency || "UZS").toUpperCase();
    const target = String(toCurrency || "UZS").toUpperCase();
    if (!amount || source === target) return formatMoney(amount, target);
    const rate = usdUzsRate(form);
    if (source === "UZS" && target === "USD") return formatMoney(amount / rate, target);
    if (source === "USD" && target === "UZS") return formatMoney(amount * rate, target);
    return formatMoney(amount, target);
  }

  function productPrice(productInput, product) {
    const form = productInput.closest("form");
    const priceTypeId = selectedPriceType(form);
    const mapped = product?.prices && priceTypeId ? product.prices[priceTypeId] : null;
    const rawPrice = String(mapped?.price || product?.price || "").trim();
    const rawCurrency = String(mapped?.currency || product?.currency || "UZS").trim().toUpperCase();
    const targetCurrency = selectedCurrency(form);
    return {
      price: rawPrice ? convertMoney(rawPrice, rawCurrency, targetCurrency, form) : "",
      currency: targetCurrency,
    };
  }

  function highlightMatch(name, query) {
    const cleanQuery = String(query || "").trim();
    if (cleanQuery.length < MIN_QUERY_LENGTH) return escapeHtml(name);
    const index = name.toLowerCase().indexOf(cleanQuery.toLowerCase());
    if (index < 0) return escapeHtml(name);
    const before = name.slice(0, index);
    const match = name.slice(index, index + cleanQuery.length);
    const after = name.slice(index + cleanQuery.length);
    return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function syncLinePrice(productInput, product) {
    const line = productInput.closest("[data-sales-line]");
    if (!line || !product) return;
    const priceInput = line.querySelector("[data-sales-price]");
    const selectedPrice = productPrice(productInput, product);
    if (!priceInput || !selectedPrice.price) return;
    if (!priceInput.value || priceInput.dataset.salesAutoPrice === "1") {
      priceInput.value = selectedPrice.price;
      priceInput.dataset.salesAutoPrice = "1";
    }
    const currencyInput = line.closest("form")?.querySelector('[name="currency"]');
    if (selectedPrice.currency && currencyInput && !currencyInput.value) {
      currencyInput.value = selectedPrice.currency;
    }
  }

  function syncLineQuantity(productInput) {
    const line = productInput.closest("[data-sales-line]");
    if (!line) return;
    const quantityInput = line.querySelector('input[name="line_quantity"]');
    if (quantityInput && !quantityInput.value) {
      quantityInput.value = "1";
    }
  }

  function ensureWarehouseValue(input) {
    if (!input || String(input.value || "").trim()) return;
    input.value = formWarehouse(input.closest("form"));
  }

  function menuFor(input) {
    const field = input.closest("[data-sales-product-field]");
    return field?.querySelector("[data-sales-product-menu]") || null;
  }

  function clientMenuFor(input) {
    const field = input.closest("[data-sales-client-field]");
    return field?.querySelector("[data-sales-client-menu]") || null;
  }

  function warehouseMenuFor(input) {
    const field = input.closest("[data-sales-warehouse-field]");
    return field?.querySelector("[data-sales-warehouse-menu]") || null;
  }

  function closeMenu(input) {
    const menu = menuFor(input);
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
  }

  function closeClientMenu(input) {
    const menu = clientMenuFor(input);
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
  }

  function closeWarehouseMenu(input) {
    const menu = warehouseMenuFor(input);
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
  }

  function chooseProduct(input, product) {
    lockProductInput(input, product.name);
    syncLineQuantity(input);
    syncLinePrice(input, product);
    ensureWarehouseValue(input.closest("[data-sales-line]")?.querySelector("[data-sales-line-warehouse]"));
    closeMenu(input);
    ensureBottomLine(input);
  }

  function renderMenu(input) {
    const menu = menuFor(input);
    if (!menu) return;
    const query = String(input.value || "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      closeMenu(input);
      return;
    }
    const normalizedQuery = normalize(query);
    const line = input.closest("[data-sales-line]");
    const blockedProducts = selectedProductNames(input.closest("form"), line);
    const currentSelected = normalize(selectedProductName(input));
    const matches = productOptions()
      .filter((item) => normalize(item.name).includes(normalizedQuery))
      .filter((item) => {
        const name = normalize(item.name);
        return !blockedProducts.has(name) || name === currentSelected;
      })
      .slice(0, MAX_RESULTS);

    if (!matches.length) {
      closeMenu(input);
      return;
    }

    menu.innerHTML = matches.map((item, index) => {
      const selectedPrice = productPrice(input, item);
      return `
      <button type="button" class="sales-product-option" data-product-index="${index}">
        <span class="sales-product-option-main">
          <span class="sales-product-option-name">${highlightMatch(item.name, query)}</span>
          <small class="sales-product-option-qty">Кол-во: ${escapeHtml(item.quantity || "0")}</small>
        </span>
        ${selectedPrice.price ? `<small class="sales-product-option-price">${escapeHtml(selectedPrice.price)} ${escapeHtml(selectedPrice.currency || "UZS")}</small>` : ""}
      </button>
    `;
    }).join("");
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");

    menu.querySelectorAll("[data-product-index]").forEach((button) => {
      const selectItem = () => {
        const item = matches[Number(button.dataset.productIndex || 0)];
        if (item) chooseProduct(input, item);
      };
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        selectItem();
      });
      button.addEventListener("click", selectItem);
    });
  }

  function renderClientMenu(input) {
    const menu = clientMenuFor(input);
    if (!menu) return;
    const query = String(input.value || "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      closeClientMenu(input);
      return;
    }
    const normalizedQuery = normalize(query);
    const matches = clientOptions()
      .filter((item) => normalize(item).includes(normalizedQuery))
      .slice(0, MAX_RESULTS);

    if (!matches.length) {
      closeClientMenu(input);
      return;
    }

    menu.innerHTML = matches.map((item, index) => `
      <button type="button" class="sales-product-option sales-client-option" data-client-index="${index}">
        <span class="sales-product-option-main">
          <span class="sales-product-option-name">${highlightMatch(item, query)}</span>
        </span>
      </button>
    `).join("");
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");

    menu.querySelectorAll("[data-client-index]").forEach((button) => {
      const selectItem = () => {
        const item = matches[Number(button.dataset.clientIndex || 0)];
        if (item) {
          input.value = item;
          closeClientMenu(input);
        }
      };
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        selectItem();
      });
      button.addEventListener("click", selectItem);
    });
  }

  function renderWarehouseMenu(input) {
    const menu = warehouseMenuFor(input);
    if (!menu) return;
    const query = String(input.value || "").trim();
    const normalizedQuery = normalize(query);
    const options = warehouseOptions();
    const currentIsOption = options.some((item) => normalize(item) === normalizedQuery);
    let matches = options
      .filter((item) => !normalizedQuery || currentIsOption || normalize(item).includes(normalizedQuery))
      .slice(0, MAX_RESULTS);
    if (!matches.length && normalizedQuery) {
      matches = options.slice(0, MAX_RESULTS);
    }

    if (!matches.length) {
      closeWarehouseMenu(input);
      return;
    }

    menu.innerHTML = matches.map((item, index) => `
      <button type="button" class="sales-product-option sales-warehouse-option" data-warehouse-index="${index}">
        <span class="sales-product-option-main">
          <span class="sales-product-option-name">${highlightMatch(item, query)}</span>
        </span>
      </button>
    `).join("");
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");

    menu.querySelectorAll("[data-warehouse-index]").forEach((button) => {
      const selectItem = () => {
        const item = matches[Number(button.dataset.warehouseIndex || 0)];
        if (item) {
          input.value = item;
          closeWarehouseMenu(input);
          if (!input.matches("[data-sales-line-warehouse]")) {
            syncBlankLineWarehouses(input.closest("form"));
          }
        }
      };
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        selectItem();
      });
      button.addEventListener("click", selectItem);
    });
  }

  function moveActive(input, step) {
    const menu = menuFor(input);
    if (!menu || menu.hidden) return;
    const buttons = Array.from(menu.querySelectorAll(".sales-product-option"));
    if (!buttons.length) return;
    const current = buttons.findIndex((button) => button.classList.contains("is-active"));
    const next = current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.classList.toggle("is-active", index === next));
    buttons[next].scrollIntoView({ block: "nearest" });
  }

  function moveClientActive(input, step) {
    const menu = clientMenuFor(input);
    if (!menu || menu.hidden) return;
    const buttons = Array.from(menu.querySelectorAll(".sales-client-option"));
    if (!buttons.length) return;
    const current = buttons.findIndex((button) => button.classList.contains("is-active"));
    const next = current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.classList.toggle("is-active", index === next));
    buttons[next].scrollIntoView({ block: "nearest" });
  }

  function moveWarehouseActive(input, step) {
    const menu = warehouseMenuFor(input);
    if (!menu || menu.hidden) return;
    const buttons = Array.from(menu.querySelectorAll(".sales-warehouse-option"));
    if (!buttons.length) return;
    const current = buttons.findIndex((button) => button.classList.contains("is-active"));
    const next = current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
    buttons.forEach((button, index) => button.classList.toggle("is-active", index === next));
    buttons[next].scrollIntoView({ block: "nearest" });
  }

  function refreshLinePrice(line) {
    const productInput = line.querySelector("[data-sales-product-search]");
    const priceInput = line.querySelector("[data-sales-price]");
    if (!productInput || !priceInput) return;
    const product = findProduct(productInput);
    if (!product) return;
    const selectedPrice = productPrice(productInput, product);
    if (!selectedPrice.price) return;
    priceInput.value = selectedPrice.price;
    priceInput.dataset.salesAutoPrice = "1";
  }

  function hasProductValue(line) {
    const input = line?.querySelector("[data-sales-product-search]");
    return Boolean(selectedProductName(input) || findProduct(input));
  }

  function formWarehouse(form) {
    return String(form?.querySelector('input[name="warehouse"]')?.value || "Основной склад").trim() || "Основной склад";
  }

  function syncBlankLineWarehouses(form) {
    const warehouse = formWarehouse(form);
    form?.querySelectorAll("[data-sales-line]").forEach((line) => {
      if (hasProductValue(line)) return;
      const input = line.querySelector("[data-sales-line-warehouse]");
      if (input) input.value = warehouse;
    });
  }

  function clearLine(line, defaultWarehouse) {
    line.querySelectorAll("input").forEach((input) => {
      input.value = "";
      delete input.dataset.salesProductSearchReady;
      delete input.dataset.salesSelectedProduct;
      delete input.dataset.salesWarehouseSearchReady;
      delete input.dataset.salesPriceReady;
      input.readOnly = false;
      input.classList.remove("is-product-selected");
      if (input.dataset.salesAutoPrice) {
        input.dataset.salesAutoPrice = "";
      }
      if (input.matches("[data-sales-product-search]")) {
        input.setAttribute("aria-expanded", "false");
      }
      if (input.matches("[data-sales-warehouse-search]")) {
        input.value = defaultWarehouse || "";
        input.setAttribute("aria-expanded", "false");
      }
    });
    line.querySelectorAll("[data-sales-product-menu], [data-sales-warehouse-menu]").forEach((menu) => {
      menu.hidden = true;
      menu.innerHTML = "";
    });
  }

  function ensureBottomLine(input) {
    const line = input.closest("[data-sales-line]");
    if (!line) return;
    const form = line.closest("form");
    const body = form?.querySelector("[data-sales-lines-body]");
    if (!body) return;

    let lines = Array.from(body.querySelectorAll("[data-sales-line]"));
    const emptyLines = lines.filter((item) => !hasProductValue(item));
    if (emptyLines.length) {
      emptyLines.slice(0, -1).forEach((item) => item.remove());
      lines = Array.from(body.querySelectorAll("[data-sales-line]"));
      const lastEmpty = emptyLines[emptyLines.length - 1];
      if (lastEmpty.isConnected && lines[lines.length - 1] !== lastEmpty) {
        body.appendChild(lastEmpty);
      }
      return;
    }

    const clone = line.cloneNode(true);
    clearLine(clone, formWarehouse(form));
    body.appendChild(clone);
    initLine(clone);
  }

  function initProductSearch(input) {
    if (input.dataset.salesProductSearchReady === "1") return;
    input.dataset.salesProductSearchReady = "1";
    input.addEventListener("input", () => {
      const selected = selectedProductName(input);
      if (selected) {
        input.value = selected;
        renderMenu(input);
        return;
      }
      renderMenu(input);
      const product = findProduct(input);
      if (product) {
        chooseProduct(input, product);
      }
    });
    input.addEventListener("focus", () => renderMenu(input));
    input.addEventListener("blur", () => window.setTimeout(() => closeMenu(input), 120));
    input.addEventListener("change", () => {
      const product = findProduct(input);
      if (product) {
        chooseProduct(input, product);
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        renderMenu(input);
        moveActive(input, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(input, -1);
      } else if (event.key === "Enter") {
        const menu = menuFor(input);
        const active = menu?.querySelector(".sales-product-option.is-active");
        if (active) {
          event.preventDefault();
          active.click();
        }
      } else if (event.key === "Escape") {
        closeMenu(input);
      }
    });
  }

  function initClientSearch(input) {
    if (input.dataset.salesClientSearchReady === "1") return;
    input.dataset.salesClientSearchReady = "1";
    input.addEventListener("input", () => renderClientMenu(input));
    input.addEventListener("focus", () => renderClientMenu(input));
    input.addEventListener("blur", () => window.setTimeout(() => closeClientMenu(input), 120));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        renderClientMenu(input);
        moveClientActive(input, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveClientActive(input, -1);
      } else if (event.key === "Enter") {
        const menu = clientMenuFor(input);
        const active = menu?.querySelector(".sales-client-option.is-active");
        if (active) {
          event.preventDefault();
          active.click();
        }
      } else if (event.key === "Escape") {
        closeClientMenu(input);
      }
    });
  }

  function initWarehouseSearch(input) {
    if (input.dataset.salesWarehouseSearchReady === "1") return;
    input.dataset.salesWarehouseSearchReady = "1";
    input.addEventListener("input", () => renderWarehouseMenu(input));
    input.addEventListener("focus", () => {
      ensureWarehouseValue(input);
      renderWarehouseMenu(input);
    });
    input.addEventListener("click", () => {
      ensureWarehouseValue(input);
      renderWarehouseMenu(input);
    });
    input.addEventListener("blur", () => window.setTimeout(() => {
      ensureWarehouseValue(input);
      closeWarehouseMenu(input);
    }, 120));
    input.addEventListener("change", () => {
      ensureWarehouseValue(input);
      if (!input.matches("[data-sales-line-warehouse]")) {
        syncBlankLineWarehouses(input.closest("form"));
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        renderWarehouseMenu(input);
        moveWarehouseActive(input, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveWarehouseActive(input, -1);
      } else if (event.key === "Enter") {
        const menu = warehouseMenuFor(input);
        const active = menu?.querySelector(".sales-warehouse-option.is-active");
        if (active) {
          event.preventDefault();
          active.click();
        }
      } else if (event.key === "Escape") {
        closeWarehouseMenu(input);
      }
    });
  }

  function initSalesForm(form) {
    form.querySelectorAll("[data-sales-client-search]").forEach(initClientSearch);
    form.querySelectorAll("[data-sales-warehouse-search]").forEach(initWarehouseSearch);
    form.querySelector("[data-sales-price-type]")?.addEventListener("change", () => {
      form.querySelectorAll("[data-sales-line]").forEach(refreshLinePrice);
    });
    form.querySelector("[data-sales-currency]")?.addEventListener("change", () => {
      form.querySelectorAll("[data-sales-line]").forEach(refreshLinePrice);
      form.querySelectorAll("[data-sales-product-search]").forEach(renderMenu);
    });
    form.querySelectorAll("[data-sales-line]").forEach(initLine);
  }

  function initLine(line) {
    line.querySelectorAll("[data-sales-product-search]").forEach(initProductSearch);
    line.querySelectorAll("[data-sales-product-search]").forEach((input) => {
      const product = findProduct(input);
      if (product) lockProductInput(input, product.name);
    });
    line.querySelectorAll("[data-sales-warehouse-search]").forEach(initWarehouseSearch);
    line.querySelectorAll("[data-sales-line-warehouse]").forEach(ensureWarehouseValue);
    line.querySelectorAll("[data-sales-price]").forEach((input) => {
      if (input.dataset.salesPriceReady === "1") return;
      input.dataset.salesPriceReady = "1";
      input.addEventListener("input", () => {
        input.dataset.salesAutoPrice = "0";
      });
    });
  }

  function readSale(id) {
    const node = document.getElementById(`sales-detail-data-${id}`);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (_error) {
      return null;
    }
  }

  function setText(root, selector, value) {
    const node = root.querySelector(selector);
    if (node) node.textContent = value == null || value === "" ? "-" : String(value);
  }

  function renderSalesDetail(panel, sale) {
    const currency = sale.currency || "UZS";
    const linesRoot = panel.querySelector("[data-sales-detail-lines]");
    const lines = Array.isArray(sale.lines) ? sale.lines : [];
    setText(panel, "[data-sales-detail-title]", `${sale.doc_type_label || "Продажа"}: ${sale.number || "-"}`);
    setText(panel, "[data-sales-detail-date]", sale.date ? `${sale.date} · ${sale.status_label || "Новый"}` : sale.status_label || "Новый");
    setText(panel, "[data-sales-detail-client]", sale.client || "Клиент не указан");
    setText(panel, "[data-sales-detail-warehouse]", sale.warehouse || "Основной склад");
    setText(panel, "[data-sales-detail-status]", sale.status_label || "Новый");
    setText(panel, "[data-sales-detail-paid]", moneyWithCurrency(sale.paid_amount, currency));
    setText(panel, "[data-sales-detail-debt]", moneyWithCurrency(sale.debt_amount, currency));
    setText(panel, "[data-sales-detail-total]", moneyWithCurrency(sale.amount, currency));
    if (!linesRoot) return;
    linesRoot.replaceChildren();
    const appendCell = (row, value) => {
      const cell = document.createElement("td");
      cell.textContent = value == null || value === "" ? "-" : String(value);
      row.append(cell);
      return cell;
    };
    if (!lines.length) {
      const row = document.createElement("tr");
      appendCell(row, "1");
      appendCell(row, sale.number || "Продажа");
      appendCell(row, sale.warehouse || "-");
      appendCell(row, "-");
      appendCell(row, "-");
      appendCell(row, moneyWithCurrency(sale.amount, currency));
      linesRoot.append(row);
      return;
    }
    lines.forEach((line, index) => {
      const row = document.createElement("tr");
      appendCell(row, index + 1);
      appendCell(row, line.product || "Товар");
      appendCell(row, line.warehouse || sale.warehouse || "-");
      appendCell(row, line.quantity || "-");
      appendCell(row, line.price ? moneyWithCurrency(line.price, currency) : "-");
      appendCell(row, line.total ? moneyWithCurrency(line.total, currency) : "-");
      linesRoot.append(row);
    });
  }

  function openSalesDetail(root, saleId) {
    const panel = root.querySelector("[data-sales-detail]");
    const backdrop = root.querySelector(".sales-detail-backdrop");
    const sale = readSale(saleId);
    if (!panel || !sale) return;
    renderSalesDetail(panel, sale);
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add("is-open");
      if (backdrop) backdrop.classList.add("is-open");
    });
  }

  function closeSalesDetail(root) {
    const panel = root.querySelector("[data-sales-detail]");
    const backdrop = root.querySelector(".sales-detail-backdrop");
    if (!panel) return;
    panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    window.setTimeout(() => {
      panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 180);
  }

  function initSalesDetail(root = document) {
    root.querySelectorAll("[data-sales-detail-open]").forEach((trigger) => {
      if (trigger.dataset.salesDetailOpenReady === "1") return;
      trigger.dataset.salesDetailOpenReady = "1";
      trigger.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (target?.closest("button, a, input, select, textarea, form")) return;
        event.preventDefault();
        openSalesDetail(root, trigger.dataset.saleId || "");
      });
    });
    root.querySelectorAll("[data-sales-detail-close]").forEach((trigger) => {
      if (trigger.dataset.salesDetailCloseReady === "1") return;
      trigger.dataset.salesDetailCloseReady = "1";
      trigger.addEventListener("click", () => closeSalesDetail(root));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeSalesDetail(root);
    });
  }

  function init() {
    document.querySelectorAll(".sales-form").forEach(initSalesForm);
    initSalesDetail(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
