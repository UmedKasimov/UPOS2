(function () {
  var DEFAULT_TEMPLATE = {
    title: "BIZNES DASTURLASH TAKLIFI",
    meta: {
      date: "27-07-2026 № CLI-741751",
      customer: "dilshod aka gulchexra market",
      customer_phone: "",
      seller: "Расул Бабаев",
      seller_phone: "+998978910550",
    },
    headers: ["№", "TOVAR NOMI", "RASMI", "SONI", "NARXI", "CHEGIRMA", "JAMI"],
    total_label: "Umumiy:",
    note: "IZOH:",
    rows: [
      {
        name: "MONOBLOK SMART I5 6A METALLIK WIFI",
        image: "monitor",
        qty: "1 шт",
        price: "350",
        discount: "320",
        total: "320",
      },
      {
        name: "Весы без этикетор",
        image: "scale",
        qty: "1 шт",
        price: "220",
        discount: "200",
        total: "200",
      },
      {
        name: "Чек Принтер XPRINTER 80C",
        image: "printer",
        qty: "1 шт",
        price: "40",
        discount: "40",
        total: "40",
      },
    ],
  };

  function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_TEMPLATE));
  }

  function text(value) {
    return value == null ? "" : String(value);
  }

  function numericValue(value) {
    var normalized = text(value)
      .replace(/\u00a0/g, "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    var number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function numberText(value) {
    var rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return String(rounded);
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute("content") || "";
    var input = document.querySelector('input[name="csrf_token"]');
    return input ? input.value || "" : "";
  }

  function setEditableText(root, selector, value) {
    var node = root.querySelector(selector);
    if (node) node.textContent = text(value);
  }

  function createEditableCell(field, value, oldPrice) {
    var span = document.createElement("span");
    span.contentEditable = "true";
    span.setAttribute("data-price-template-row-field", field);
    span.setAttribute("data-price-cell", "");
    if (oldPrice) span.className = "price-template-old";
    span.textContent = text(value);
    return span;
  }

  function createImage(kind) {
    var allowed = ["monitor", "scale", "printer", "empty"];
    var safeKind = allowed.indexOf(kind) >= 0 ? kind : "empty";
    var image = document.createElement("button");
    image.type = "button";
    image.className =
      "price-template-product-img price-template-product-img--" + safeKind;
    image.setAttribute("data-price-template-image", safeKind);
    image.setAttribute("aria-label", "Сменить вид изображения");
    image.title = "Нажмите, чтобы сменить изображение";
    if (safeKind === "monitor") {
      var monitorLabel = document.createElement("span");
      monitorLabel.textContent = "Monoblok A2";
      image.appendChild(monitorLabel);
    } else if (safeKind === "printer") {
      var printerLabel = document.createElement("span");
      printerLabel.textContent = "XP-Q80AS";
      image.appendChild(printerLabel);
    }
    return image;
  }

  function createRow(row) {
    var tr = document.createElement("tr");
    tr.setAttribute("data-price-template-row", "");

    var numberCell = document.createElement("td");
    numberCell.className = "price-template-row-number";
    var number = document.createElement("span");
    number.setAttribute("data-price-template-number", "");
    numberCell.appendChild(number);
    var remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("data-price-template-remove-row", "");
    remove.setAttribute("aria-label", "Удалить строку");
    numberCell.appendChild(remove);
    tr.appendChild(numberCell);

    var nameCell = document.createElement("td");
    nameCell.appendChild(createEditableCell("name", row.name, false));
    tr.appendChild(nameCell);

    var imageCell = document.createElement("td");
    imageCell.appendChild(createImage(text(row.image) || "empty"));
    tr.appendChild(imageCell);

    var qtyCell = document.createElement("td");
    qtyCell.appendChild(createEditableCell("qty", row.qty, false));
    tr.appendChild(qtyCell);

    var priceCell = document.createElement("td");
    priceCell.appendChild(createEditableCell("price", row.price, true));
    tr.appendChild(priceCell);

    var discountCell = document.createElement("td");
    discountCell.appendChild(createEditableCell("discount", row.discount, false));
    tr.appendChild(discountCell);

    var totalCell = document.createElement("td");
    totalCell.appendChild(createEditableCell("total", row.total, false));
    tr.appendChild(totalCell);

    return tr;
  }

  function normalizeTemplate(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var defaults = cloneDefault();
    var meta = source.meta && typeof source.meta === "object" ? source.meta : {};
    var headers = Array.isArray(source.headers) ? source.headers.slice(0, 7) : [];
    while (headers.length < 7) headers.push(defaults.headers[headers.length]);
    var rows = Array.isArray(source.rows) && source.rows.length ? source.rows.slice(0, 50) : defaults.rows;
    return {
      title: text(source.title || defaults.title),
      meta: {
        date: text(meta.date != null ? meta.date : defaults.meta.date),
        customer: text(meta.customer != null ? meta.customer : defaults.meta.customer),
        customer_phone: text(
          meta.customer_phone != null ? meta.customer_phone : defaults.meta.customer_phone,
        ),
        seller: text(meta.seller != null ? meta.seller : defaults.meta.seller),
        seller_phone: text(
          meta.seller_phone != null ? meta.seller_phone : defaults.meta.seller_phone,
        ),
      },
      headers: headers.map(text),
      total_label: text(source.total_label || defaults.total_label),
      note: text(source.note || defaults.note),
      rows: rows.map(function (row) {
        var item = row && typeof row === "object" ? row : {};
        return {
          name: text(item.name),
          image: text(item.image || "empty"),
          qty: text(item.qty),
          price: text(item.price),
          discount: text(item.discount),
          total: text(item.total),
        };
      }),
    };
  }

  function initEditor(root) {
    var preview = root.querySelector(".price-template-preview");
    var rowsRoot = root.querySelector("[data-price-template-rows]");
    var formula = root.querySelector("[data-price-template-formula]");
    var address = root.querySelector("[data-price-template-address]");
    var status = document.querySelector("[data-price-template-status]");
    var saveButton = document.querySelector("[data-price-template-save]");
    var addButton = document.querySelector("[data-price-template-add-row]");
    var resetButton = document.querySelector("[data-price-template-reset]");
    if (!preview || !rowsRoot || !formula || !address) return;

    var selectedCell = null;
    var dirty = false;

    function setStatus(message, state) {
      if (!status) return;
      status.textContent = message || "";
      status.classList.toggle("is-error", state === "error");
      status.classList.toggle("is-success", state === "success");
    }

    function markDirty() {
      dirty = true;
      setStatus("Есть несохранённые изменения", "pending");
    }

    function updateRowAddresses() {
      var rows = rowsRoot.querySelectorAll("[data-price-template-row]");
      rows.forEach(function (row, index) {
        var rowNumber = index + 2;
        var number = row.querySelector("[data-price-template-number]");
        if (number) number.textContent = String(index + 1);
        var columns = { name: "B", qty: "D", price: "E", discount: "F", total: "G" };
        Object.keys(columns).forEach(function (field) {
          var cell = row.querySelector('[data-price-template-row-field="' + field + '"]');
          if (cell) cell.setAttribute("data-cell-address", columns[field] + rowNumber);
        });
        var remove = row.querySelector("[data-price-template-remove-row]");
        if (remove) remove.disabled = rows.length <= 1;
      });
    }

    function recalculateTotals() {
      var qtyTotal = 0;
      var priceTotal = 0;
      var grandTotal = 0;
      rowsRoot.querySelectorAll("[data-price-template-row]").forEach(function (row) {
        qtyTotal += numericValue(
          row.querySelector('[data-price-template-row-field="qty"]').textContent,
        );
        priceTotal += numericValue(
          row.querySelector('[data-price-template-row-field="price"]').textContent,
        );
        grandTotal += numericValue(
          row.querySelector('[data-price-template-row-field="total"]').textContent,
        );
      });
      setEditableText(preview, "[data-price-template-qty-total]", numberText(qtyTotal));
      setEditableText(preview, "[data-price-template-price-total]", numberText(priceTotal));
      setEditableText(preview, "[data-price-template-grand-total]", numberText(grandTotal));
    }

    function recalculateRow(row) {
      if (!row) return;
      var qty = numericValue(
        row.querySelector('[data-price-template-row-field="qty"]').textContent,
      );
      var discount = numericValue(
        row.querySelector('[data-price-template-row-field="discount"]').textContent,
      );
      var discountText =
        row.querySelector('[data-price-template-row-field="discount"]').textContent || "";
      var price = numericValue(
        row.querySelector('[data-price-template-row-field="price"]').textContent,
      );
      var total = row.querySelector('[data-price-template-row-field="total"]');
      total.textContent = numberText(qty * (discountText.trim() ? discount : price));
      if (selectedCell === total) formula.value = total.textContent;
      recalculateTotals();
    }

    function selectCell(cell) {
      if (selectedCell === cell) return;
      if (selectedCell) selectedCell.classList.remove("is-selected");
      selectedCell = cell;
      if (!selectedCell) {
        formula.value = "";
        formula.disabled = true;
        address.textContent = "—";
        return;
      }
      selectedCell.classList.add("is-selected");
      formula.disabled = false;
      formula.value = selectedCell.textContent || "";
      address.textContent = selectedCell.getAttribute("data-cell-address") || "Ячейка";
    }

    function applyTemplate(payload) {
      var data = normalizeTemplate(payload);
      setEditableText(preview, '[data-price-template-field="title"]', data.title);
      setEditableText(preview, '[data-price-template-meta="date"]', data.meta.date);
      setEditableText(preview, '[data-price-template-meta="customer"]', data.meta.customer);
      setEditableText(
        preview,
        '[data-price-template-meta="customer_phone"]',
        data.meta.customer_phone,
      );
      setEditableText(preview, '[data-price-template-meta="seller"]', data.meta.seller);
      setEditableText(
        preview,
        '[data-price-template-meta="seller_phone"]',
        data.meta.seller_phone,
      );
      data.headers.forEach(function (header, index) {
        setEditableText(
          preview,
          '[data-price-template-header="' + index + '"]',
          header,
        );
      });
      setEditableText(preview, '[data-price-template-field="total_label"]', data.total_label);
      setEditableText(preview, '[data-price-template-field="note"]', data.note);
      rowsRoot.replaceChildren();
      data.rows.forEach(function (row) {
        rowsRoot.appendChild(createRow(row));
      });
      updateRowAddresses();
      recalculateTotals();
      selectCell(null);
    }

    function collectTemplate() {
      var headers = [];
      preview.querySelectorAll("[data-price-template-header]").forEach(function (header) {
        headers[Number(header.getAttribute("data-price-template-header"))] =
          header.textContent || "";
      });
      var rows = [];
      rowsRoot.querySelectorAll("[data-price-template-row]").forEach(function (row) {
        var image = row.querySelector("[data-price-template-image]");
        rows.push({
          name: row.querySelector('[data-price-template-row-field="name"]').textContent || "",
          image: image ? image.getAttribute("data-price-template-image") || "empty" : "empty",
          qty: row.querySelector('[data-price-template-row-field="qty"]').textContent || "",
          price: row.querySelector('[data-price-template-row-field="price"]').textContent || "",
          discount:
            row.querySelector('[data-price-template-row-field="discount"]').textContent || "",
          total: row.querySelector('[data-price-template-row-field="total"]').textContent || "",
        });
      });
      return {
        title: preview.querySelector('[data-price-template-field="title"]').textContent || "",
        meta: {
          date: preview.querySelector('[data-price-template-meta="date"]').textContent || "",
          customer:
            preview.querySelector('[data-price-template-meta="customer"]').textContent || "",
          customer_phone:
            preview.querySelector('[data-price-template-meta="customer_phone"]').textContent ||
            "",
          seller: preview.querySelector('[data-price-template-meta="seller"]').textContent || "",
          seller_phone:
            preview.querySelector('[data-price-template-meta="seller_phone"]').textContent || "",
        },
        headers: headers,
        total_label:
          preview.querySelector('[data-price-template-field="total_label"]').textContent || "",
        note: preview.querySelector('[data-price-template-field="note"]').textContent || "",
        rows: rows,
      };
    }

    async function saveTemplate() {
      if (!saveButton) return;
      saveButton.disabled = true;
      setStatus("Сохраняем…", "pending");
      try {
        var response = await fetch("/api/settings/price-template", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken(),
          },
          body: JSON.stringify({ price_template: collectTemplate() }),
        });
        if (!response.ok) throw new Error("save");
        dirty = false;
        setStatus("Шаблон сохранён", "success");
      } catch (error) {
        setStatus("Не удалось сохранить. Попробуйте ещё раз.", "error");
      } finally {
        saveButton.disabled = false;
      }
    }

    var initial = {};
    var initialNode = root.querySelector("[data-price-template-initial]");
    if (initialNode) {
      try {
        initial = JSON.parse(initialNode.textContent || "{}");
      } catch (error) {
        initial = {};
      }
    }
    applyTemplate(Object.keys(initial).length ? initial : DEFAULT_TEMPLATE);

    root.addEventListener("click", function (event) {
      var remove = event.target.closest("[data-price-template-remove-row]");
      if (remove) {
        var row = remove.closest("[data-price-template-row]");
        if (row && rowsRoot.children.length > 1) {
          if (row.contains(selectedCell)) selectCell(null);
          row.remove();
          updateRowAddresses();
          recalculateTotals();
          markDirty();
        }
        return;
      }

      var image = event.target.closest("[data-price-template-image]");
      if (image) {
        var kinds = ["monitor", "scale", "printer", "empty"];
        var current = image.getAttribute("data-price-template-image") || "empty";
        var next = kinds[(kinds.indexOf(current) + 1) % kinds.length];
        image.replaceWith(createImage(next));
        markDirty();
        return;
      }

      var cell = event.target.closest("[data-price-cell]");
      if (cell && root.contains(cell)) selectCell(cell);
    });

    root.addEventListener("input", function (event) {
      var cell = event.target.closest("[data-price-cell]");
      if (!cell) return;
      if (selectedCell === cell) formula.value = cell.textContent || "";
      var field = cell.getAttribute("data-price-template-row-field");
      var row = cell.closest("[data-price-template-row]");
      if (row && ["qty", "price", "discount"].indexOf(field) >= 0) {
        recalculateRow(row);
      } else if (row && field === "total") {
        recalculateTotals();
      }
      markDirty();
    });

    root.addEventListener("paste", function (event) {
      var cell = event.target.closest("[data-price-cell]");
      if (!cell) return;
      event.preventDefault();
      var pasted = (event.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, pasted);
    });

    formula.addEventListener("input", function () {
      if (!selectedCell) return;
      selectedCell.textContent = formula.value;
      var row = selectedCell.closest("[data-price-template-row]");
      var field = selectedCell.getAttribute("data-price-template-row-field");
      if (row && ["qty", "price", "discount"].indexOf(field) >= 0) {
        recalculateRow(row);
      } else if (row && field === "total") {
        recalculateTotals();
      }
      markDirty();
    });

    if (addButton) {
      addButton.addEventListener("click", function () {
        if (rowsRoot.children.length >= 50) {
          setStatus("Можно добавить не больше 50 строк", "error");
          return;
        }
        rowsRoot.appendChild(
          createRow({
            name: "Новый товар",
            image: "empty",
            qty: "1 шт",
            price: "0",
            discount: "0",
            total: "0",
          }),
        );
        updateRowAddresses();
        recalculateTotals();
        markDirty();
        var newCell = rowsRoot.lastElementChild.querySelector(
          '[data-price-template-row-field="name"]',
        );
        selectCell(newCell);
        newCell.focus();
      });
    }

    if (resetButton) {
      resetButton.addEventListener("click", function () {
        applyTemplate(DEFAULT_TEMPLATE);
        markDirty();
      });
    }

    if (saveButton) saveButton.addEventListener("click", saveTemplate);

    window.addEventListener("beforeunload", function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function boot() {
    document.querySelectorAll("[data-price-template-editor]").forEach(initEditor);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
