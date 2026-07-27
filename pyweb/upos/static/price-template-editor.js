(function () {
  var GRID_SIZE = 6;

  var DEFAULT_VISIBILITY = {
    logo: true,
    title: true,
    table: true,
    name: true,
    category: false,
    photo: true,
    qty: true,
    price: true,
    discount: true,
    custom_text: false,
    seller: true,
    customer: true,
    date: true,
    id: true,
    seller_phone: true,
    customer_phone: true,
    address: false,
    comment: true,
  };

  var DEFAULT_TEMPLATE = {
    version: 2,
    title: "BIZNES DASTURLASH TAKLIFI",
    logo: "",
    layout: {},
    extra_tables: [],
    visible: DEFAULT_VISIBILITY,
    meta: {
      date: "27-07-2026",
      id: "CLI-741751",
      customer: "dilshod aka gulchexra market",
      customer_phone: "",
      seller: "Расул Бабаев",
      seller_phone: "+998978910550",
      address: "Ташкент",
    },
    headers: [
      "№",
      "TOVAR NOMI",
      "KATEGORIYA",
      "RASMI",
      "SONI",
      "NARXI",
      "CHEGIRMA",
      "JAMI",
    ],
    custom_text: "Дополнительный текст предложения",
    total_label: "Umumiy:",
    note: "IZOH:",
    rows: [
      {
        name: "MONOBLOK SMART I5 6A METALLIK WIFI",
        category: "Моноблок",
        image: "monitor",
        photo: "",
        photo_x: 0,
        photo_y: 0,
        photo_scale: 1,
        qty: "1 шт",
        price: "350",
        discount: "320",
        total: "320",
      },
      {
        name: "Весы без этикетор",
        category: "Весы",
        image: "scale",
        photo: "",
        photo_x: 0,
        photo_y: 0,
        photo_scale: 1,
        qty: "1 шт",
        price: "220",
        discount: "200",
        total: "200",
      },
      {
        name: "Чек Принтер XPRINTER 80C",
        category: "Принтер",
        image: "printer",
        photo: "",
        photo_x: 0,
        photo_y: 0,
        photo_scale: 1,
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

  function clamp(value, minimum, maximum, fallback) {
    var number = Number.parseFloat(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.max(minimum, Math.min(number, maximum));
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute("content") || "";
    var input = document.querySelector('input[name="csrf_token"]');
    return input ? input.value || "" : "";
  }

  function setNodeText(root, selector, value) {
    var node = root.querySelector(selector);
    if (node) node.textContent = text(value);
  }

  function createEditableCell(field, value, options) {
    var span = document.createElement("span");
    span.contentEditable = "true";
    span.setAttribute("data-price-template-row-field", field);
    span.setAttribute("data-price-cell", "");
    if (options && options.oldPrice) span.className = "price-template-old";
    span.textContent = text(value);
    return span;
  }

  function createImage(row) {
    var allowed = ["monitor", "scale", "printer", "empty"];
    var kind = text(row && row.image) || "empty";
    var safeKind = allowed.indexOf(kind) >= 0 ? kind : "empty";
    var photo = /^data:image\/(?:png|jpeg|webp);base64,/i.test(text(row && row.photo))
      ? text(row.photo)
      : "";
    var photoX = Math.max(-80, Math.min(numericValue(row && row.photo_x), 80));
    var photoY = Math.max(-80, Math.min(numericValue(row && row.photo_y), 80));
    var photoScale = Math.max(
      0.5,
      Math.min(numericValue(row && row.photo_scale) || 1, 4),
    );
    var image = document.createElement("button");
    image.type = "button";
    image.className =
      "price-template-product-img price-template-product-img--" +
      (photo ? "custom" : safeKind);
    image.setAttribute("data-price-template-image", safeKind);
    image.setAttribute("data-price-template-photo", photo);
    image.setAttribute("data-price-template-photo-x", String(photoX));
    image.setAttribute("data-price-template-photo-y", String(photoY));
    image.setAttribute("data-price-template-photo-scale", String(photoScale));
    image.setAttribute("aria-label", "Выбрать фотографию");
    image.title = "Выбрать фотографию для редактирования";
    image.style.setProperty("--photo-x", photoX + "px");
    image.style.setProperty("--photo-y", photoY + "px");
    image.style.setProperty("--photo-scale", String(photoScale));
    if (photo) {
      var customImage = document.createElement("img");
      customImage.src = photo;
      customImage.alt = "";
      image.appendChild(customImage);
    } else if (safeKind === "monitor" || safeKind === "printer") {
      var label = document.createElement("span");
      label.textContent = safeKind === "monitor" ? "Monoblok A2" : "XP-Q80AS";
      image.appendChild(label);
    }
    return image;
  }

  function createDataCell(component, child) {
    var td = document.createElement("td");
    if (component) td.setAttribute("data-price-component", component);
    td.appendChild(child);
    return td;
  }

  function spreadsheetColumn(index) {
    var name = "";
    var value = index + 1;
    while (value > 0) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  }

  function createExtraTable(data, tableIndex) {
    var source = data && typeof data === "object" ? data : {};
    var id = text(source.id).replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
    if (!id) id = "table_" + String(Date.now()) + "_" + String(tableIndex);
    var cells = Array.isArray(source.cells) ? source.cells : [];
    if (!cells.length) {
      cells = [
        ["Заголовок 1", "Заголовок 2", "Заголовок 3"],
        ["", "", ""],
        ["", "", ""],
      ];
    }
    var columnCount = Math.max(
      1,
      Math.min(
        10,
        cells.reduce(function (maximum, row) {
          return Math.max(maximum, Array.isArray(row) ? row.length : 0);
        }, 0),
      ),
    );
    var key = "extra_table_" + id;
    var wrapper = document.createElement("div");
    wrapper.className = "price-template-extra-table-wrap";
    wrapper.setAttribute("data-price-template-extra-table", "");
    wrapper.setAttribute("data-price-template-extra-table-id", id);
    wrapper.setAttribute("data-price-layout-key", key);

    var handle = document.createElement("button");
    handle.type = "button";
    handle.className = "price-template-layout-handle price-template-extra-table-handle";
    handle.setAttribute("data-price-template-select-layout", key);
    handle.setAttribute("aria-label", "Выбрать дополнительную таблицу");
    handle.title = "Выбрать таблицу";
    handle.textContent = "↔";
    wrapper.appendChild(handle);

    var table = document.createElement("table");
    table.className = "price-template-extra-table";
    var body = document.createElement("tbody");
    cells.slice(0, 20).forEach(function (rawRow, rowIndex) {
      var row = document.createElement("tr");
      var values = Array.isArray(rawRow) ? rawRow : [];
      for (var columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        var cell = document.createElement(rowIndex === 0 ? "th" : "td");
        var value = document.createElement("span");
        value.contentEditable = "true";
        value.setAttribute("data-price-template-extra-cell", "");
        value.setAttribute("data-price-cell", "");
        value.setAttribute(
          "data-cell-address",
          "T" +
            String(tableIndex + 2) +
            ":" +
            spreadsheetColumn(columnIndex) +
            String(rowIndex + 1),
        );
        value.textContent = text(values[columnIndex]);
        cell.appendChild(value);
        row.appendChild(cell);
      }
      body.appendChild(row);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    return wrapper;
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

    tr.appendChild(createDataCell("name", createEditableCell("name", row.name)));
    tr.appendChild(createDataCell("category", createEditableCell("category", row.category)));
    tr.appendChild(createDataCell("photo", createImage(row)));
    tr.appendChild(createDataCell("qty", createEditableCell("qty", row.qty)));
    tr.appendChild(
      createDataCell("price", createEditableCell("price", row.price, { oldPrice: true })),
    );
    tr.appendChild(
      createDataCell("discount", createEditableCell("discount", row.discount)),
    );
    tr.appendChild(createDataCell("", createEditableCell("total", row.total)));
    return tr;
  }

  function normalizeHeaders(rawHeaders) {
    var defaults = DEFAULT_TEMPLATE.headers;
    var headers = Array.isArray(rawHeaders) ? rawHeaders.slice(0, 8) : [];
    if (headers.length === 7) {
      headers = [headers[0], headers[1], defaults[2]].concat(headers.slice(2));
    }
    while (headers.length < 8) headers.push(defaults[headers.length]);
    return headers.map(text);
  }

  function normalizeTemplate(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var defaults = cloneDefault();
    var meta = source.meta && typeof source.meta === "object" ? source.meta : {};
    var date = text(meta.date != null ? meta.date : defaults.meta.date);
    var id = text(meta.id != null ? meta.id : "");
    if (!id && date.indexOf("№") >= 0) {
      var dateParts = date.split("№");
      date = dateParts.shift().trim();
      id = dateParts.join("№").trim();
    }
    if (!id) id = defaults.meta.id;

    var rawVisible =
      source.visible && typeof source.visible === "object" ? source.visible : {};
    var visible = {};
    Object.keys(DEFAULT_VISIBILITY).forEach(function (key) {
      visible[key] =
        typeof rawVisible[key] === "boolean" ? rawVisible[key] : DEFAULT_VISIBILITY[key];
    });

    var rows =
      Array.isArray(source.rows) && source.rows.length
        ? source.rows.slice(0, 50)
        : defaults.rows;
    var extraTables = (
      Array.isArray(source.extra_tables) ? source.extra_tables : []
    )
      .slice(0, 8)
      .map(function (table, tableIndex) {
        var item = table && typeof table === "object" ? table : {};
        var id = text(item.id).replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
        if (!id) id = "table_" + String(tableIndex + 1);
        var cells = (Array.isArray(item.cells) ? item.cells : [])
          .slice(0, 20)
          .map(function (row) {
            return (Array.isArray(row) ? row : []).slice(0, 10).map(text);
          });
        return {
          id: id,
          cells: cells.length
            ? cells
            : [
                ["Заголовок 1", "Заголовок 2", "Заголовок 3"],
                ["", "", ""],
                ["", "", ""],
              ],
        };
      });
    var rawLayout =
      source.layout && typeof source.layout === "object" ? source.layout : {};
    var layout = {};
    Object.keys(rawLayout).forEach(function (key) {
      if (
        !/^(?:logo|title|table|custom_text|comment|total_label|date|id|customer|customer_phone|seller|seller_phone|address|header_[0-7]|row_(?:[0-9]|[1-4][0-9])_(?:name|category|qty|price|discount|total)|extra_table_[a-z0-9_-]{1,32})$/.test(
          key,
        )
      ) {
        return;
      }
      var adjustment =
        rawLayout[key] && typeof rawLayout[key] === "object" ? rawLayout[key] : {};
      layout[key] = {
        x: clamp(adjustment.x, -300, 300, 0),
        y: clamp(adjustment.y, -300, 300, 0),
        scale: clamp(adjustment.scale, 0.5, 2, 1),
      };
    });
    return {
      version: 2,
      title: text(source.title || defaults.title),
      logo: /^data:image\/(?:png|jpeg|webp);base64,/i.test(text(source.logo))
        ? text(source.logo)
        : "",
      layout: layout,
      extra_tables: extraTables,
      visible: visible,
      meta: {
        date: date,
        id: id,
        customer: text(meta.customer != null ? meta.customer : defaults.meta.customer),
        customer_phone: text(
          meta.customer_phone != null
            ? meta.customer_phone
            : defaults.meta.customer_phone,
        ),
        seller: text(meta.seller != null ? meta.seller : defaults.meta.seller),
        seller_phone: text(
          meta.seller_phone != null ? meta.seller_phone : defaults.meta.seller_phone,
        ),
        address: text(meta.address != null ? meta.address : defaults.meta.address),
      },
      headers: normalizeHeaders(source.headers),
      custom_text: text(
        source.custom_text != null ? source.custom_text : defaults.custom_text,
      ),
      total_label: text(source.total_label || defaults.total_label),
      note: text(source.note || defaults.note),
      rows: rows.map(function (row) {
        var item = row && typeof row === "object" ? row : {};
        return {
          name: text(item.name),
          category: text(item.category),
          image: text(item.image || "empty"),
          photo: /^data:image\/(?:png|jpeg|webp);base64,/i.test(text(item.photo))
            ? text(item.photo)
            : "",
          photo_x: clamp(item.photo_x, -80, 80, 0),
          photo_y: clamp(item.photo_y, -80, 80, 0),
          photo_scale: clamp(item.photo_scale, 0.5, 4, 1),
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
    var extraTablesRoot = root.querySelector("[data-price-template-extra-tables]");
    var formula = root.querySelector("[data-price-template-formula]");
    var address = root.querySelector("[data-price-template-address]");
    var status = document.querySelector("[data-price-template-status]");
    var saveButton = document.querySelector("[data-price-template-save]");
    var addButton = document.querySelector("[data-price-template-add-row]");
    var resetButton = document.querySelector("[data-price-template-reset]");
    var logoFile = root.querySelector("[data-price-template-logo-file]");
    var logoImage = root.querySelector("[data-price-template-logo-image]");
    var defaultLogo = root.querySelector("[data-price-template-default-logo]");
    var selectedName = root.querySelector("[data-price-template-selected-name]");
    var photoTools = root.querySelector("[data-price-template-photo-tools]");
    var extraTableTools = root.querySelector(
      "[data-price-template-extra-table-tools]",
    );
    var photoFile = root.querySelector("[data-price-template-photo-file]");
    var gridToggle = root.querySelector("[data-price-template-grid-toggle]");
    var dragHandle = root.querySelector("[data-price-template-drag-handle]");
    if (!preview || !rowsRoot || !extraTablesRoot || !formula || !address) return;

    var selectedCell = null;
    var selectedTarget = null;
    var dragState = null;
    var currentLogo = "";
    var layout = {};
    var gridEnabled = true;
    var visibility = Object.assign({}, DEFAULT_VISIBILITY);
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

    function setLogo(value) {
      currentLogo = /^data:image\/(?:png|jpeg|webp);base64,/i.test(text(value))
        ? text(value)
        : "";
      if (logoImage) {
        logoImage.hidden = !currentLogo;
        if (currentLogo) logoImage.src = currentLogo;
        else logoImage.removeAttribute("src");
      }
      if (defaultLogo) defaultLogo.hidden = Boolean(currentLogo);
    }

    function layoutLabel(key, node) {
      var labels = {
        logo: "Логотип",
        title: "Заголовок",
        table: "Таблица",
        custom_text: "Текст",
        comment: "Комментарий",
        total_label: "Итог",
        date: "Дата",
        id: "ID",
        customer: "Имя клиента",
        customer_phone: "Номер клиента",
        seller: "Имя продавца",
        seller_phone: "Номер продавца",
        address: "Адрес",
      };
      if (labels[key]) return labels[key];
      if (key.indexOf("header_") === 0) return "Заголовок колонки";
      if (key.indexOf("extra_table_") === 0) return "Дополнительная таблица";
      if (key.indexOf("row_") === 0) {
        var cell = node && node.getAttribute("data-cell-address");
        return cell ? "Текст " + cell : "Текст товара";
      }
      return "Элемент";
    }

    function applyLayoutAdjustment(key) {
      var adjustment = layout[key] || { x: 0, y: 0, scale: 1 };
      preview
        .querySelectorAll('[data-price-layout-key="' + key + '"]')
        .forEach(function (node) {
          node.style.setProperty("--layout-x", adjustment.x + "px");
          node.style.setProperty("--layout-y", adjustment.y + "px");
          node.style.setProperty("--layout-scale", String(adjustment.scale));
        });
    }

    function applyAllLayout() {
      preview.querySelectorAll("[data-price-layout-key]").forEach(function (node) {
        node.style.setProperty("--layout-x", "0px");
        node.style.setProperty("--layout-y", "0px");
        node.style.setProperty("--layout-scale", "1");
      });
      Object.keys(layout).forEach(applyLayoutAdjustment);
    }

    function snapToGrid(value, minimum, maximum) {
      var step = gridEnabled ? GRID_SIZE : 1;
      return clamp(Math.round(value / step) * step, minimum, maximum, 0);
    }

    function updateToolbarState() {
      root.querySelectorAll("[data-price-template-adjust]").forEach(function (button) {
        button.disabled = !selectedTarget;
      });
      if (selectedName && !selectedTarget) {
        selectedName.textContent = "Выберите элемент";
      }
    }

    function positionDragHandle() {
      if (!dragHandle || !selectedTarget || !selectedTarget.node.isConnected) {
        if (dragHandle) dragHandle.hidden = true;
        return;
      }
      var previewRect = preview.getBoundingClientRect();
      var nodeRect = selectedTarget.node.getBoundingClientRect();
      var left = nodeRect.left - previewRect.left - 12;
      var top = nodeRect.top - previewRect.top - 12;
      dragHandle.style.left =
        clamp(left, 2, Math.max(2, preview.clientWidth - 34), 2) + "px";
      dragHandle.style.top =
        clamp(top, 2, Math.max(2, preview.scrollHeight - 34), 2) + "px";
      dragHandle.hidden = false;
    }

    function clearTargetSelection() {
      preview
        .querySelectorAll(".is-layout-selected, .is-photo-selected")
        .forEach(function (node) {
          node.classList.remove("is-layout-selected", "is-photo-selected");
        });
      selectedTarget = null;
      if (photoTools) photoTools.hidden = true;
      if (extraTableTools) extraTableTools.hidden = true;
      if (dragHandle) dragHandle.hidden = true;
      updateToolbarState();
    }

    function selectLayoutTarget(node, key) {
      if (!node || !key) {
        clearTargetSelection();
        return;
      }
      clearTargetSelection();
      selectedTarget = { type: "layout", key: key, node: node };
      node.classList.add("is-layout-selected");
      if (selectedName) selectedName.textContent = layoutLabel(key, node);
      if (extraTableTools) {
        extraTableTools.hidden = key.indexOf("extra_table_") !== 0;
      }
      updateToolbarState();
      window.requestAnimationFrame(positionDragHandle);
    }

    function selectPhotoTarget(node) {
      if (!node) {
        clearTargetSelection();
        return;
      }
      clearTargetSelection();
      selectedTarget = { type: "photo", node: node };
      node.classList.add("is-photo-selected");
      if (selectedName) selectedName.textContent = "Фото товара";
      if (photoTools) photoTools.hidden = false;
      updateToolbarState();
      window.requestAnimationFrame(positionDragHandle);
    }

    function updatePhotoTransform(node, values) {
      if (!node) return;
      var x = clamp(values.x, -80, 80, 0);
      var y = clamp(values.y, -80, 80, 0);
      var scale = clamp(values.scale, 0.5, 4, 1);
      node.setAttribute("data-price-template-photo-x", String(x));
      node.setAttribute("data-price-template-photo-y", String(y));
      node.setAttribute("data-price-template-photo-scale", String(scale));
      node.style.setProperty("--photo-x", x + "px");
      node.style.setProperty("--photo-y", y + "px");
      node.style.setProperty("--photo-scale", String(scale));
    }

    function photoValues(node) {
      return {
        x: clamp(node && node.getAttribute("data-price-template-photo-x"), -80, 80, 0),
        y: clamp(node && node.getAttribute("data-price-template-photo-y"), -80, 80, 0),
        scale: clamp(
          node && node.getAttribute("data-price-template-photo-scale"),
          0.5,
          4,
          1,
        ),
      };
    }

    function replaceSelectedPhoto(photo) {
      if (!selectedTarget || selectedTarget.type !== "photo") return;
      var oldNode = selectedTarget.node;
      var replacement = createImage({
        image: oldNode.getAttribute("data-price-template-image") || "empty",
        photo: photo || "",
        photo_x: 0,
        photo_y: 0,
        photo_scale: 1,
      });
      oldNode.replaceWith(replacement);
      selectPhotoTarget(replacement);
      markDirty();
    }

    function adjustSelected(action) {
      if (!selectedTarget) return;
      var moveStep = gridEnabled ? GRID_SIZE : 1;
      if (selectedTarget.type === "layout") {
        var key = selectedTarget.key;
        var current = layout[key] || { x: 0, y: 0, scale: 1 };
        var next = {
          x: clamp(current.x, -300, 300, 0),
          y: clamp(current.y, -300, 300, 0),
          scale: clamp(current.scale, 0.5, 2, 1),
        };
        if (action === "left") next.x -= moveStep;
        if (action === "right") next.x += moveStep;
        if (action === "up") next.y -= moveStep;
        if (action === "down") next.y += moveStep;
        if (action === "smaller") next.scale -= 0.05;
        if (action === "larger") next.scale += 0.05;
        if (action === "reset") next = { x: 0, y: 0, scale: 1 };
        next.x = snapToGrid(next.x, -300, 300);
        next.y = snapToGrid(next.y, -300, 300);
        next.scale = clamp(next.scale, 0.5, 2, 1);
        layout[key] = next;
        applyLayoutAdjustment(key);
      } else {
        var photo = photoValues(selectedTarget.node);
        if (action === "left") photo.x -= moveStep;
        if (action === "right") photo.x += moveStep;
        if (action === "up") photo.y -= moveStep;
        if (action === "down") photo.y += moveStep;
        if (action === "smaller") photo.scale -= 0.1;
        if (action === "larger") photo.scale += 0.1;
        if (action === "reset") photo = { x: 0, y: 0, scale: 1 };
        photo.x = snapToGrid(photo.x, -80, 80);
        photo.y = snapToGrid(photo.y, -80, 80);
        updatePhotoTransform(selectedTarget.node, photo);
      }
      window.requestAnimationFrame(positionDragHandle);
      markDirty();
    }

    function selectedPosition(target) {
      if (target.type === "layout") {
        var current = layout[target.key] || { x: 0, y: 0, scale: 1 };
        return {
          x: clamp(current.x, -300, 300, 0),
          y: clamp(current.y, -300, 300, 0),
        };
      }
      var photo = photoValues(target.node);
      return { x: photo.x, y: photo.y };
    }

    function applyDraggedPosition(target, x, y) {
      if (!target || !target.node.isConnected) return;
      if (target.type === "layout") {
        var current = layout[target.key] || { x: 0, y: 0, scale: 1 };
        layout[target.key] = {
          x: snapToGrid(x, -300, 300),
          y: snapToGrid(y, -300, 300),
          scale: clamp(current.scale, 0.5, 2, 1),
        };
        applyLayoutAdjustment(target.key);
      } else {
        var photo = photoValues(target.node);
        photo.x = snapToGrid(x, -80, 80);
        photo.y = snapToGrid(y, -80, 80);
        updatePhotoTransform(target.node, photo);
      }
      positionDragHandle();
    }

    function finishDrag(event) {
      if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
      var changed = dragState.changed;
      dragState = null;
      preview.classList.remove("is-grid-dragging");
      if (dragHandle) dragHandle.classList.remove("is-dragging");
      if (changed) markDirty();
    }

    if (dragHandle) {
      dragHandle.addEventListener("pointerdown", function (event) {
        if (!selectedTarget || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        var position = selectedPosition(selectedTarget);
        dragState = {
          pointerId: event.pointerId,
          target: selectedTarget,
          startX: event.clientX,
          startY: event.clientY,
          x: position.x,
          y: position.y,
          changed: false,
        };
        dragHandle.setPointerCapture(event.pointerId);
        dragHandle.classList.add("is-dragging");
        preview.classList.add("is-grid-dragging");
      });
      dragHandle.addEventListener("pointermove", function (event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        event.preventDefault();
        var previewRect = preview.getBoundingClientRect();
        var coordinateScale = previewRect.width
          ? preview.offsetWidth / previewRect.width
          : 1;
        var nextX =
          dragState.x + (event.clientX - dragState.startX) * coordinateScale;
        var nextY =
          dragState.y + (event.clientY - dragState.startY) * coordinateScale;
        applyDraggedPosition(dragState.target, nextX, nextY);
        dragState.changed = true;
      });
      dragHandle.addEventListener("pointerup", finishDrag);
      dragHandle.addEventListener("pointercancel", finishDrag);
      dragHandle.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    function updateRowAddresses() {
      var rows = rowsRoot.querySelectorAll("[data-price-template-row]");
      var columns = {
        name: "B",
        category: "C",
        qty: "E",
        price: "F",
        discount: "G",
        total: "H",
      };
      rows.forEach(function (row, index) {
        var rowNumber = index + 2;
        var number = row.querySelector("[data-price-template-number]");
        if (number) number.textContent = String(index + 1);
        Object.keys(columns).forEach(function (field) {
          var cell = row.querySelector(
            '[data-price-template-row-field="' + field + '"]',
          );
          if (cell) {
            cell.setAttribute("data-cell-address", columns[field] + rowNumber);
            cell.setAttribute(
              "data-price-layout-key",
              "row_" + index + "_" + field,
            );
          }
        });
        var remove = row.querySelector("[data-price-template-remove-row]");
        if (remove) remove.disabled = rows.length <= 1;
      });
    }

    function removeRowLayout(rowIndex) {
      var nextLayout = {};
      Object.keys(layout).forEach(function (key) {
        var match = /^row_(\d+)_(.+)$/.exec(key);
        if (!match) {
          nextLayout[key] = layout[key];
          return;
        }
        var index = Number(match[1]);
        if (index === rowIndex) return;
        var nextKey =
          index > rowIndex ? "row_" + (index - 1) + "_" + match[2] : key;
        nextLayout[nextKey] = layout[key];
      });
      layout = nextLayout;
    }

    function updateExtraTableAddresses() {
      extraTablesRoot
        .querySelectorAll("[data-price-template-extra-table]")
        .forEach(function (wrapper, tableIndex) {
          var handle = wrapper.querySelector("[data-price-template-select-layout]");
          if (handle) {
            handle.setAttribute(
              "aria-label",
              "Выбрать дополнительную таблицу " + String(tableIndex + 1),
            );
          }
          wrapper.querySelectorAll("tr").forEach(function (row, rowIndex) {
            row
              .querySelectorAll("[data-price-template-extra-cell]")
              .forEach(function (cell, columnIndex) {
                cell.setAttribute(
                  "data-cell-address",
                  "T" +
                    String(tableIndex + 2) +
                    ":" +
                    spreadsheetColumn(columnIndex) +
                    String(rowIndex + 1),
                );
              });
          });
        });
    }

    function appendExtraCell(row, header) {
      var cell = document.createElement(header ? "th" : "td");
      var value = document.createElement("span");
      value.contentEditable = "true";
      value.setAttribute("data-price-template-extra-cell", "");
      value.setAttribute("data-price-cell", "");
      value.textContent = "";
      cell.appendChild(value);
      row.appendChild(cell);
    }

    function addExtraTable() {
      if (extraTablesRoot.children.length >= 8) {
        setStatus("Можно добавить не больше 8 таблиц", "error");
        return;
      }
      var id =
        "table_" +
        Date.now().toString(36) +
        "_" +
        String(extraTablesRoot.children.length + 1);
      var wrapper = createExtraTable(
        {
          id: id,
          cells: [
            ["Заголовок 1", "Заголовок 2", "Заголовок 3"],
            ["", "", ""],
            ["", "", ""],
          ],
        },
        extraTablesRoot.children.length,
      );
      extraTablesRoot.appendChild(wrapper);
      updateExtraTableAddresses();
      selectLayoutTarget(wrapper, "extra_table_" + id);
      markDirty();
      wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function selectedExtraTable() {
      if (!selectedTarget || selectedTarget.type !== "layout") return null;
      return selectedTarget.node.closest("[data-price-template-extra-table]");
    }

    function addExtraTableRow() {
      var wrapper = selectedExtraTable();
      if (!wrapper) return;
      var body = wrapper.querySelector("tbody");
      var rows = body ? body.querySelectorAll("tr") : [];
      if (!body || rows.length >= 20) {
        setStatus("В таблице может быть не больше 20 строк", "error");
        return;
      }
      var columnCount = rows.length ? rows[0].children.length : 3;
      var row = document.createElement("tr");
      for (var index = 0; index < columnCount; index += 1) {
        appendExtraCell(row, false);
      }
      body.appendChild(row);
      updateExtraTableAddresses();
      positionDragHandle();
      markDirty();
    }

    function removeExtraTableRow() {
      var wrapper = selectedExtraTable();
      if (!wrapper) return;
      var rows = wrapper.querySelectorAll("tr");
      if (rows.length <= 1) {
        setStatus("В таблице должна остаться хотя бы одна строка", "error");
        return;
      }
      var lastRow = rows[rows.length - 1];
      if (lastRow.contains(selectedCell)) selectCell(null);
      lastRow.remove();
      updateExtraTableAddresses();
      positionDragHandle();
      markDirty();
    }

    function addExtraTableColumn() {
      var wrapper = selectedExtraTable();
      if (!wrapper) return;
      var rows = wrapper.querySelectorAll("tr");
      if (!rows.length || rows[0].children.length >= 10) {
        setStatus("В таблице может быть не больше 10 столбцов", "error");
        return;
      }
      rows.forEach(function (row, rowIndex) {
        appendExtraCell(row, rowIndex === 0);
      });
      updateExtraTableAddresses();
      positionDragHandle();
      markDirty();
    }

    function removeExtraTableColumn() {
      var wrapper = selectedExtraTable();
      if (!wrapper) return;
      var rows = wrapper.querySelectorAll("tr");
      if (!rows.length || rows[0].children.length <= 1) {
        setStatus("В таблице должен остаться хотя бы один столбец", "error");
        return;
      }
      rows.forEach(function (row) {
        var lastCell = row.lastElementChild;
        if (!lastCell) return;
        if (lastCell.contains(selectedCell)) selectCell(null);
        lastCell.remove();
      });
      updateExtraTableAddresses();
      positionDragHandle();
      markDirty();
    }

    function removeExtraTable() {
      var wrapper = selectedExtraTable();
      if (!wrapper) return;
      var key = wrapper.getAttribute("data-price-layout-key") || "";
      if (key) delete layout[key];
      clearTargetSelection();
      wrapper.remove();
      updateExtraTableAddresses();
      markDirty();
    }

    function updateFooterLayout() {
      var labelCell = preview.querySelector("[data-price-template-total-label-cell]");
      var priceCell = preview.querySelector("[data-price-template-price-summary-cell]");
      var qtyCell = preview.querySelector("[data-price-template-qty-total]");
      var labelSpan =
        1 +
        (visibility.name ? 1 : 0) +
        (visibility.category ? 1 : 0) +
        (visibility.photo ? 1 : 0);
      var priceSpan = (visibility.price ? 1 : 0) + (visibility.discount ? 1 : 0);
      if (labelCell) labelCell.colSpan = Math.max(1, labelSpan);
      if (qtyCell) qtyCell.hidden = !visibility.qty;
      if (priceCell) {
        priceCell.hidden = priceSpan === 0;
        priceCell.colSpan = Math.max(1, priceSpan);
      }
    }

    function applyVisibility(key, on) {
      visibility[key] = Boolean(on);
      preview
        .querySelectorAll('[data-price-component="' + key + '"]')
        .forEach(function (node) {
          node.hidden = !visibility[key];
        });
      var toggle = root.querySelector(
        '[data-price-template-visibility="' + key + '"]',
      );
      if (toggle) toggle.checked = visibility[key];
      if (key === "discount") {
        preview
          .querySelectorAll(
            '[data-price-template-row-field="price"], [data-price-template-price-total]',
          )
          .forEach(function (node) {
            node.classList.toggle("price-template-old", visibility.discount);
          });
      }
      if (selectedCell && selectedCell.closest("[hidden]")) selectCell(null);
      if (
        selectedTarget &&
        selectedTarget.node &&
        selectedTarget.node.closest("[hidden]")
      ) {
        clearTargetSelection();
      }
      updateFooterLayout();
      window.requestAnimationFrame(positionDragHandle);
    }

    function applyAllVisibility() {
      Object.keys(DEFAULT_VISIBILITY).forEach(function (key) {
        applyVisibility(key, visibility[key]);
      });
    }

    function recalculateTotals() {
      var qtyTotal = 0;
      var priceTotal = 0;
      var grandTotal = 0;
      rowsRoot.querySelectorAll("[data-price-template-row]").forEach(function (row) {
        var qty = numericValue(
          row.querySelector('[data-price-template-row-field="qty"]').textContent,
        );
        qtyTotal += qty;
        priceTotal +=
          qty *
          numericValue(
            row.querySelector('[data-price-template-row-field="price"]').textContent,
          );
        grandTotal += numericValue(
          row.querySelector('[data-price-template-row-field="total"]').textContent,
        );
      });
      setNodeText(preview, "[data-price-template-qty-total]", numberText(qtyTotal));
      setNodeText(preview, "[data-price-template-price-total]", numberText(priceTotal));
      setNodeText(preview, "[data-price-template-grand-total]", numberText(grandTotal));
    }

    function recalculateRow(row) {
      if (!row) return;
      var qty = numericValue(
        row.querySelector('[data-price-template-row-field="qty"]').textContent,
      );
      var discountCell = row.querySelector(
        '[data-price-template-row-field="discount"]',
      );
      var discountText = discountCell.textContent || "";
      var discount = numericValue(discountText);
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
      address.textContent =
        selectedCell.getAttribute("data-cell-address") || "Ячейка";
    }

    function applyTemplate(payload) {
      var data = normalizeTemplate(payload);
      setNodeText(preview, '[data-price-template-field="title"]', data.title);
      setNodeText(preview, '[data-price-template-meta="date"]', data.meta.date);
      setNodeText(preview, '[data-price-template-meta="id"]', data.meta.id);
      setNodeText(
        preview,
        '[data-price-template-meta="customer"]',
        data.meta.customer,
      );
      setNodeText(
        preview,
        '[data-price-template-meta="customer_phone"]',
        data.meta.customer_phone,
      );
      setNodeText(preview, '[data-price-template-meta="seller"]', data.meta.seller);
      setNodeText(
        preview,
        '[data-price-template-meta="seller_phone"]',
        data.meta.seller_phone,
      );
      setNodeText(preview, '[data-price-template-meta="address"]', data.meta.address);
      setNodeText(
        preview,
        '[data-price-template-field="custom_text"]',
        data.custom_text,
      );
      data.headers.forEach(function (header, index) {
        setNodeText(
          preview,
          '[data-price-template-header="' + index + '"]',
          header,
        );
      });
      setNodeText(
        preview,
        '[data-price-template-field="total_label"]',
        data.total_label,
      );
      setNodeText(preview, '[data-price-template-field="note"]', data.note);
      rowsRoot.replaceChildren();
      data.rows.forEach(function (row) {
        rowsRoot.appendChild(createRow(row));
      });
      extraTablesRoot.replaceChildren();
      data.extra_tables.forEach(function (table, tableIndex) {
        extraTablesRoot.appendChild(createExtraTable(table, tableIndex));
      });
      setLogo(data.logo);
      layout = Object.assign({}, data.layout);
      visibility = Object.assign({}, data.visible);
      updateRowAddresses();
      updateExtraTableAddresses();
      recalculateTotals();
      applyAllVisibility();
      applyAllLayout();
      selectCell(null);
      clearTargetSelection();
    }

    function collectTemplate() {
      var headers = [];
      preview
        .querySelectorAll("[data-price-template-header]")
        .forEach(function (header) {
          headers[Number(header.getAttribute("data-price-template-header"))] =
            header.textContent || "";
        });
      var rows = [];
      rowsRoot.querySelectorAll("[data-price-template-row]").forEach(function (row) {
        var image = row.querySelector("[data-price-template-image]");
        rows.push({
          name:
            row.querySelector('[data-price-template-row-field="name"]').textContent ||
            "",
          category:
            row.querySelector('[data-price-template-row-field="category"]')
              .textContent || "",
          image: image
            ? image.getAttribute("data-price-template-image") || "empty"
            : "empty",
          photo: image
            ? image.getAttribute("data-price-template-photo") || ""
            : "",
          photo_x: image
            ? clamp(
                image.getAttribute("data-price-template-photo-x"),
                -80,
                80,
                0,
              )
            : 0,
          photo_y: image
            ? clamp(
                image.getAttribute("data-price-template-photo-y"),
                -80,
                80,
                0,
              )
            : 0,
          photo_scale: image
            ? clamp(
                image.getAttribute("data-price-template-photo-scale"),
                0.5,
                4,
                1,
              )
            : 1,
          qty:
            row.querySelector('[data-price-template-row-field="qty"]').textContent ||
            "",
          price:
            row.querySelector('[data-price-template-row-field="price"]').textContent ||
            "",
          discount:
            row.querySelector('[data-price-template-row-field="discount"]')
              .textContent || "",
          total:
            row.querySelector('[data-price-template-row-field="total"]').textContent ||
            "",
        });
      });
      var extraTables = [];
      extraTablesRoot
        .querySelectorAll("[data-price-template-extra-table]")
        .forEach(function (wrapper) {
          var cells = [];
          wrapper.querySelectorAll("tr").forEach(function (row) {
            var values = [];
            row
              .querySelectorAll("[data-price-template-extra-cell]")
              .forEach(function (cell) {
                values.push(cell.textContent || "");
              });
            cells.push(values);
          });
          extraTables.push({
            id: wrapper.getAttribute("data-price-template-extra-table-id") || "",
            cells: cells,
          });
        });
      return {
        version: 2,
        title:
          preview.querySelector('[data-price-template-field="title"]').textContent ||
          "",
        logo: currentLogo,
        layout: Object.assign({}, layout),
        extra_tables: extraTables,
        visible: Object.assign({}, visibility),
        meta: {
          date:
            preview.querySelector('[data-price-template-meta="date"]').textContent ||
            "",
          id:
            preview.querySelector('[data-price-template-meta="id"]').textContent || "",
          customer:
            preview.querySelector('[data-price-template-meta="customer"]')
              .textContent || "",
          customer_phone:
            preview.querySelector('[data-price-template-meta="customer_phone"]')
              .textContent || "",
          seller:
            preview.querySelector('[data-price-template-meta="seller"]').textContent ||
            "",
          seller_phone:
            preview.querySelector('[data-price-template-meta="seller_phone"]')
              .textContent || "",
          address:
            preview.querySelector('[data-price-template-meta="address"]').textContent ||
            "",
        },
        headers: headers,
        custom_text:
          preview.querySelector('[data-price-template-field="custom_text"]')
            .textContent || "",
        total_label:
          preview.querySelector('[data-price-template-field="total_label"]')
            .textContent || "",
        note:
          preview.querySelector('[data-price-template-field="note"]').textContent || "",
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

    function readImageFile(file, options) {
      return new Promise(function (resolve, reject) {
        if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
          reject(new Error("type"));
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          reject(new Error("size"));
          return;
        }
        var reader = new FileReader();
        reader.onerror = reject;
        reader.onload = function () {
          var image = new Image();
          image.onerror = reject;
          image.onload = function () {
            var settings = options || {};
            var maxWidth = settings.maxWidth || 640;
            var maxHeight = settings.maxHeight || 280;
            var scale = Math.min(
              1,
              maxWidth / image.naturalWidth,
              maxHeight / image.naturalHeight,
            );
            var canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            var context = canvas.getContext("2d");
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(
              canvas.toDataURL(
                settings.outputType || "image/png",
                settings.quality == null ? 0.9 : settings.quality,
              ),
            );
          };
          image.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
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
    preview.classList.add("is-grid-editing");
    if (gridToggle) {
      gridToggle.classList.add("is-active");
      gridToggle.setAttribute("aria-pressed", "true");
    }
    applyTemplate(Object.keys(initial).length ? initial : DEFAULT_TEMPLATE);

    root.addEventListener("click", function (event) {
      var gridButton = event.target.closest("[data-price-template-grid-toggle]");
      if (gridButton) {
        gridEnabled = !gridEnabled;
        preview.classList.toggle("is-grid-editing", gridEnabled);
        gridButton.classList.toggle("is-active", gridEnabled);
        gridButton.setAttribute("aria-pressed", gridEnabled ? "true" : "false");
        gridButton.title = gridEnabled ? "Выключить сетку" : "Включить сетку";
        return;
      }

      if (event.target.closest("[data-price-template-add-table]")) {
        addExtraTable();
        return;
      }

      if (event.target.closest("[data-price-template-extra-row]")) {
        addExtraTableRow();
        return;
      }

      if (event.target.closest("[data-price-template-extra-remove-row]")) {
        removeExtraTableRow();
        return;
      }

      if (event.target.closest("[data-price-template-extra-column]")) {
        addExtraTableColumn();
        return;
      }

      if (event.target.closest("[data-price-template-extra-remove-column]")) {
        removeExtraTableColumn();
        return;
      }

      if (event.target.closest("[data-price-template-extra-remove]")) {
        removeExtraTable();
        return;
      }

      var remove = event.target.closest("[data-price-template-remove-row]");
      if (remove) {
        var row = remove.closest("[data-price-template-row]");
        if (row && rowsRoot.children.length > 1) {
          var rowIndex = Array.prototype.indexOf.call(rowsRoot.children, row);
          if (row.contains(selectedCell)) selectCell(null);
          if (
            selectedTarget &&
            selectedTarget.node &&
            row.contains(selectedTarget.node)
          ) {
            clearTargetSelection();
          }
          removeRowLayout(rowIndex);
          row.remove();
          updateRowAddresses();
          applyAllLayout();
          recalculateTotals();
          markDirty();
        }
        return;
      }

      var image = event.target.closest("[data-price-template-image]");
      if (image) {
        selectPhotoTarget(image);
        return;
      }

      if (event.target.closest("[data-price-template-logo-upload]")) {
        if (logoFile) logoFile.click();
        return;
      }

      if (event.target.closest(".price-template-logo-edit")) {
        if (logoFile) logoFile.click();
        return;
      }

      var logoTrigger = event.target.closest("[data-price-template-logo-trigger]");
      if (logoTrigger) {
        selectLayoutTarget(logoTrigger, "logo");
        return;
      }

      if (event.target.closest("[data-price-template-logo-reset]")) {
        setLogo("");
        markDirty();
        return;
      }

      var tableHandle = event.target.closest("[data-price-template-select-layout]");
      if (tableHandle) {
        var tableKey = tableHandle.getAttribute("data-price-template-select-layout");
        selectLayoutTarget(
          preview.querySelector('[data-price-layout-key="' + tableKey + '"]'),
          tableKey,
        );
        return;
      }

      var adjustment = event.target.closest("[data-price-template-adjust]");
      if (adjustment) {
        adjustSelected(adjustment.getAttribute("data-price-template-adjust"));
        return;
      }

      if (event.target.closest("[data-price-template-photo-upload]")) {
        if (photoFile) photoFile.click();
        return;
      }

      if (event.target.closest("[data-price-template-photo-remove]")) {
        replaceSelectedPhoto("");
        return;
      }

      var cell = event.target.closest("[data-price-cell]");
      if (cell && root.contains(cell)) {
        selectCell(cell);
        var layoutNode = cell.closest("[data-price-layout-key]");
        if (layoutNode) {
          selectLayoutTarget(
            layoutNode,
            layoutNode.getAttribute("data-price-layout-key"),
          );
        }
      }
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
      window.requestAnimationFrame(positionDragHandle);
      markDirty();
    });

    root.addEventListener("change", function (event) {
      var toggle = event.target.closest("[data-price-template-visibility]");
      if (!toggle) return;
      var key = toggle.getAttribute("data-price-template-visibility");
      applyVisibility(key, toggle.checked);
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
      window.requestAnimationFrame(positionDragHandle);
      markDirty();
    });

    if (logoFile) {
      logoFile.addEventListener("change", async function () {
        var file = logoFile.files && logoFile.files[0];
        if (!file) return;
        setStatus("Подготавливаем логотип…", "pending");
        try {
          var logo = await readImageFile(file, {
            maxWidth: 640,
            maxHeight: 280,
            outputType: "image/png",
          });
          setLogo(logo);
          visibility.logo = true;
          applyVisibility("logo", true);
          markDirty();
        } catch (error) {
          setStatus(
            error && error.message === "size"
              ? "Файл логотипа должен быть меньше 5 МБ"
              : "Выберите PNG, JPG или WEBP",
            "error",
          );
        } finally {
          logoFile.value = "";
        }
      });
    }

    if (photoFile) {
      photoFile.addEventListener("change", async function () {
        var file = photoFile.files && photoFile.files[0];
        if (!file || !selectedTarget || selectedTarget.type !== "photo") return;
        setStatus("Подготавливаем фото…", "pending");
        try {
          var photo = await readImageFile(file, {
            maxWidth: 700,
            maxHeight: 700,
            outputType: "image/webp",
            quality: 0.82,
          });
          replaceSelectedPhoto(photo);
        } catch (error) {
          setStatus(
            error && error.message === "size"
              ? "Файл фото должен быть меньше 5 МБ"
              : "Выберите PNG, JPG или WEBP",
            "error",
          );
        } finally {
          photoFile.value = "";
        }
      });
    }

    if (addButton) {
      addButton.addEventListener("click", function () {
        if (rowsRoot.children.length >= 50) {
          setStatus("Можно добавить не больше 50 строк", "error");
          return;
        }
        rowsRoot.appendChild(
          createRow({
            name: "Новый товар",
            category: "",
            image: "empty",
            photo: "",
            photo_x: 0,
            photo_y: 0,
            photo_scale: 1,
            qty: "1 шт",
            price: "0",
            discount: "0",
            total: "0",
          }),
        );
        visibility.table = true;
        applyVisibility("table", true);
        updateRowAddresses();
        recalculateTotals();
        applyAllVisibility();
        applyAllLayout();
        markDirty();
        var newCell = rowsRoot.lastElementChild.querySelector(
          '[data-price-template-row-field="name"]',
        );
        if (!newCell.closest("[hidden]")) {
          selectCell(newCell);
          newCell.focus();
        }
      });
    }

    if (resetButton) {
      resetButton.addEventListener("click", function () {
        applyTemplate(DEFAULT_TEMPLATE);
        markDirty();
      });
    }

    if (saveButton) saveButton.addEventListener("click", saveTemplate);

    window.addEventListener("resize", function () {
      window.requestAnimationFrame(positionDragHandle);
    });

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
