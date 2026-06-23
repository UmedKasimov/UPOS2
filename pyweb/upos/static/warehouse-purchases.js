(function () {
  function updateAction(form) {
    const hash = form.action.includes("#") ? form.action.slice(form.action.indexOf("#")) : "#purchases";
    const base = form.action.split("#")[0] || window.location.pathname;
    const params = new URLSearchParams(new FormData(form));
    Array.from(params.keys()).forEach((key) => {
      if (!params.get(key)) params.delete(key);
    });
    form.action = `${base}${params.toString() ? `?${params.toString()}` : ""}${hash}`;
  }

  function highlight(root) {
    const query = root.querySelector("[data-warehouse-purchases-filter] input[name=\"q\"]")?.value.trim() || "";
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 5);
    const targets = root.querySelectorAll("[data-warehouse-purchase-highlight]");
    targets.forEach((node) => {
      const original = node.dataset.warehousePurchaseOriginalText || node.textContent || "";
      node.dataset.warehousePurchaseOriginalText = original;
      if (!terms.length) {
        node.textContent = original;
        return;
      }
      const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      if (!pattern) {
        node.textContent = original;
        return;
      }
      const regex = new RegExp(`(${pattern})`, "gi");
      node.replaceChildren();
      let cursor = 0;
      original.replace(regex, (match, _group, offset) => {
        if (offset > cursor) node.append(document.createTextNode(original.slice(cursor, offset)));
        const mark = document.createElement("mark");
        mark.className = "products-search-hit";
        mark.textContent = match;
        node.append(mark);
        cursor = offset + match.length;
        return match;
      });
      if (cursor < original.length) node.append(document.createTextNode(original.slice(cursor)));
    });
  }

  function moneyWithCurrency(value, currency) {
    const text = String(value || "0").trim() || "0";
    const code = String(currency || "UZS").trim() || "UZS";
    return `${text} ${code}`;
  }

  function purchaseEntryNumber(value) {
    const normalized = String(value || "")
      .replace(/\s+/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function purchaseEntryFormat(value) {
    const rounded = Math.round(Number(value || 0));
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(rounded);
  }

  function purchaseEntryMoney(value, currency) {
    return `${purchaseEntryFormat(value)} ${currency || "UZS"}`;
  }

  function initPurchaseEntry(root = document) {
    root.querySelectorAll("[data-warehouse-purchase-entry]").forEach((form) => {
      if (form.dataset.purchaseEntryReady === "1") return;
      form.dataset.purchaseEntryReady = "1";

      const body = form.querySelector("[data-purchase-entry-lines]");
      const currencyInput = form.querySelector("[data-purchase-entry-currency]");
      const amountInput = form.querySelector("[data-purchase-entry-amount]");
      const totalOutput = form.querySelector("[data-purchase-entry-total]");
      if (!body) return;

      const rows = () => Array.from(body.querySelectorAll("[data-purchase-entry-row]"));
      const rowHasProduct = (row) => Boolean(row.querySelector('input[name="line_product"]')?.value.trim());
      const rowTotal = (row) => {
        const quantity = purchaseEntryNumber(row.querySelector('input[name="line_quantity"]')?.value || "1") || 0;
        const price = purchaseEntryNumber(row.querySelector('input[name="line_price"]')?.value);
        return quantity * price;
      };
      const currency = () => currencyInput?.value || "UZS";

      const renumber = () => {
        rows().forEach((row, index) => {
          const number = row.querySelector(".warehouse-purchase-entry-row-number");
          if (number) number.textContent = String(index + 1);
        });
      };

      const recalc = () => {
        let total = 0;
        rows().forEach((row) => {
          const value = rowTotal(row);
          const output = row.querySelector("[data-purchase-entry-line-total]");
          if (output) output.textContent = purchaseEntryMoney(value, currency());
          if (rowHasProduct(row)) total += value;
        });
        if (amountInput) amountInput.value = String(Math.round(total));
        if (totalOutput) totalOutput.textContent = purchaseEntryMoney(total, currency());
        renumber();
      };

      const ensureBlankLine = () => {
        const currentRows = rows();
        const last = currentRows[currentRows.length - 1];
        if (!last || !rowHasProduct(last)) return;
        const clone = last.cloneNode(true);
        delete clone.dataset.purchaseEntryRowReady;
        clone.querySelectorAll("input").forEach((input) => {
          input.value = "";
        });
        const output = clone.querySelector("[data-purchase-entry-line-total]");
        if (output) output.textContent = purchaseEntryMoney(0, currency());
        body.append(clone);
        wireRow(clone);
        recalc();
      };

      const wireRow = (row) => {
        if (row.dataset.purchaseEntryRowReady === "1") return;
        row.dataset.purchaseEntryRowReady = "1";
        row.querySelectorAll("input").forEach((input) => {
          input.addEventListener("focus", () => {
            if (input.name === "line_quantity" || input.name === "line_price") {
              window.setTimeout(() => input.select(), 0);
            }
          });
          input.addEventListener("input", () => {
            if (input.name === "line_quantity" || input.name === "line_price") {
              const cursorAtEnd = input.selectionStart === input.value.length;
              input.value = input.value.replace(/[^\d\s.,-]/g, "");
              if (cursorAtEnd) input.setSelectionRange(input.value.length, input.value.length);
            }
            recalc();
            if (input.name === "line_product") ensureBlankLine();
          });
          input.addEventListener("blur", () => {
            if (input.name === "line_quantity" || input.name === "line_price") {
              const value = purchaseEntryNumber(input.value);
              input.value = value ? purchaseEntryFormat(value) : "";
              recalc();
            }
          });
        });
        row.querySelector("[data-purchase-entry-remove]")?.addEventListener("click", () => {
          if (rows().length > 1) {
            row.remove();
          } else {
            row.querySelectorAll("input").forEach((input) => {
              input.value = "";
            });
          }
          recalc();
        });
      };

      rows().forEach(wireRow);
      currencyInput?.addEventListener("change", recalc);
      form.addEventListener("submit", () => {
        rows().forEach((row) => {
          row.querySelectorAll('input[name="line_quantity"], input[name="line_price"]').forEach((input) => {
            const value = purchaseEntryNumber(input.value);
            input.value = value ? String(value) : "";
          });
        });
        recalc();
      });
      recalc();
    });
  }

  function readPurchase(id) {
    const node = document.getElementById(`warehouse-purchase-data-${id}`);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (_err) {
      return null;
    }
  }

  function setText(root, selector, value) {
    const node = root.querySelector(selector);
    if (node) node.textContent = value == null || value === "" ? "-" : String(value);
  }

  function renderDetail(panel, purchase) {
    const currency = purchase.currency || "UZS";
    const linesRoot = panel.querySelector("[data-purchase-detail-lines]");
    const lines = Array.isArray(purchase.lines) ? purchase.lines : [];
    setText(panel, "[data-purchase-detail-title]", `Закупка: ${purchase.number || "-"}`);
    setText(panel, "[data-purchase-detail-date]", purchase.date ? `${purchase.date} · ${purchase.status_label || "Новый"}` : purchase.status_label || "Новый");
    setText(panel, "[data-purchase-detail-supplier]", purchase.supplier || "Поставщик не указан");
    setText(panel, "[data-purchase-detail-warehouse]", purchase.warehouse || "Основной склад");
    setText(panel, "[data-purchase-detail-status]", purchase.status_label || "Новый");
    setText(panel, "[data-purchase-detail-paid]", moneyWithCurrency(purchase.paid_amount, currency));
    setText(panel, "[data-purchase-detail-debt]", moneyWithCurrency(purchase.debt_amount, currency));
    setText(panel, "[data-purchase-detail-total]", moneyWithCurrency(purchase.amount, currency));
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
      appendCell(row, purchase.number || "Закупка");
      appendCell(row, "-");
      appendCell(row, "-");
      appendCell(row, moneyWithCurrency(purchase.amount, currency));
      linesRoot.append(row);
      return;
    }
    lines.forEach((line, index) => {
      const row = document.createElement("tr");
      const qty = String(line.quantity || "-");
      const price = line.price ? moneyWithCurrency(line.price, currency) : "-";
      const total = line.total ? moneyWithCurrency(line.total, currency) : "-";
      appendCell(row, index + 1);
      appendCell(row, line.product || "Товар");
      appendCell(row, qty);
      appendCell(row, price);
      appendCell(row, total);
      linesRoot.append(row);
    });
  }

  function openDetail(root, purchaseId) {
    const panel = root.querySelector("[data-warehouse-purchase-detail]");
    const backdrop = root.querySelector(".warehouse-purchase-detail-backdrop");
    const purchase = readPurchase(purchaseId);
    if (!panel || !purchase) return;
    renderDetail(panel, purchase);
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add("is-open");
      if (backdrop) backdrop.classList.add("is-open");
    });
  }

  function closeDetail(root) {
    const panel = root.querySelector("[data-warehouse-purchase-detail]");
    const backdrop = root.querySelector(".warehouse-purchase-detail-backdrop");
    if (!panel) return;
    panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    window.setTimeout(() => {
      panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 180);
  }

  function init(root = document) {
    initPurchaseEntry(root);
    root.querySelectorAll("[data-warehouse-purchases-filter]").forEach((form) => {
      if (form.dataset.warehousePurchasesReady === "1") return;
      form.dataset.warehousePurchasesReady = "1";
      let timer = 0;
      const submit = () => {
        updateAction(form);
        form.requestSubmit();
      };
      Array.from(form.elements).forEach((control) => {
        if (control.matches?.('input[type="search"]')) {
          control.addEventListener("input", () => {
            highlight(root);
            window.clearTimeout(timer);
            timer = window.setTimeout(submit, 450);
          });
          control.addEventListener("search", () => {
            window.clearTimeout(timer);
            submit();
          });
          return;
        }
        if (!control.disabled && control.name) {
          control.addEventListener("change", submit);
        }
      });
      form.addEventListener("submit", () => updateAction(form));
    });
    root.querySelectorAll("[data-warehouse-purchase-open]").forEach((trigger) => {
      if (trigger.dataset.warehousePurchaseOpenReady === "1") return;
      trigger.dataset.warehousePurchaseOpenReady = "1";
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        openDetail(root, trigger.dataset.purchaseId || "");
      });
    });
    root.querySelectorAll("[data-warehouse-purchase-close]").forEach((trigger) => {
      if (trigger.dataset.warehousePurchaseCloseReady === "1") return;
      trigger.dataset.warehousePurchaseCloseReady = "1";
      trigger.addEventListener("click", () => closeDetail(root));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDetail(root);
    });
    highlight(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
