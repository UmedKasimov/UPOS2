(() => {
  function postStage(root, recordId, stageId, lostReasons = []) {
    const template = root.dataset.crmStageUrlTemplate || "/crm/__record__/stage";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || "");
    body.set("stage_id", stageId);
    // Причин может быть несколько — отправляем повторяющимся ключом, сервер
    // собирает их через form.getlist.
    (Array.isArray(lostReasons) ? lostReasons : [lostReasons])
      .filter(Boolean)
      .forEach((reason) => body.append("lost_reasons", reason));
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    }).then((response) =>
      response
        .json()
        .catch(() => ({}))
        .then((body) => {
          // Причину отказа показываем пользователю, поэтому код ошибки
          // сервера доносим до вызывающего кода как есть.
          if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
          return body;
        })
    );
  }

  function postArchive(root, recordId) {
    const template = root.dataset.crmArchiveUrlTemplate || "/crm/__record__/archive";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || "");
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  }

  function postTag(root, recordId, tag) {
    const template = root.dataset.crmTagUrlTemplate || "/crm/__record__/tag";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || "");
    body.set("tag", tag);
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  }

  function postActivity(root, recordId, payload) {
    const template = root.dataset.crmActivityUrlTemplate || "/crm/__record__/activity";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || "");
    Object.entries(payload).forEach(([key, value]) => body.set(key, String(value || "")));
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  }

  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.map((item) => String(item || "").trim()).filter(Boolean);
    return String(tags || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function fillTagList(list, tags) {
    if (!list) return;
    const normalizedTags = normalizeTags(tags);
    list.innerHTML = "";
    normalizedTags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.textContent = tag;
      list.appendChild(chip);
    });
  }

  function updateCardTags(card, tags) {
    if (!card) return [];
    const normalizedTags = normalizeTags(tags);
    const tagText = normalizedTags.join(", ");
    card.dataset.crmTags = tagText;
    fillTagList(card.querySelector("[data-crm-card-tags]"), normalizedTags);
    try {
      const payload = JSON.parse(card.dataset.crmEditPayload || "{}");
      payload.tags = tagText;
      card.dataset.crmEditPayload = JSON.stringify(payload);
    } catch {
      // Ignore malformed payload; the visible tag is still updated.
    }
    return normalizedTags;
  }

  function parseCardAmount(card) {
    const raw = String(card?.dataset.crmAmountValue || "").trim().replace(",", ".");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  }

  function formatColumnMoney(value, currency = "UZS") {
    const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const options = Number.isInteger(rounded)
      ? { maximumFractionDigits: 0 }
      : { minimumFractionDigits: 0, maximumFractionDigits: 2 };
    const formatted = rounded.toLocaleString("ru-RU", options).replace(/\u00a0/g, " ");
    return `${formatted} ${currency || "UZS"}`;
  }

  function updateColumnState(column) {
    // При активном поиске шапка считает только найденные карточки: раньше
    // число и сумма оставались полными и противоречили экрану.
    const query = String(document.querySelector('.crm-kanban-filters input[name="q"]')?.value || "").trim();
    const cards = Array.from(column.querySelectorAll(".crm-kanban-card")).filter((card) => !query || !card.hidden);
    const count = column.querySelector("header strong");
    if (count) count.textContent = String(cards.length);
    const total = column.querySelector(".crm-kanban-column-total");
    if (total) {
      // Сумма всегда в UZS: значения карточек конвертированы сервером,
      // подпись валютой первой карточки давала «1 000 000 USD» из сумов.
      const amount = cards.reduce((sum, card) => sum + parseCardAmount(card), 0);
      total.textContent = formatColumnMoney(amount, "UZS");
    }
    const empty = column.querySelector(".crm-kanban-empty");
    if (empty) empty.hidden = cards.length > 0;
    const showMore = column.querySelector("[data-crm-show-more]");
    if (showMore) {
      const remaining = cards.filter((card) => card.dataset.crmDeferred === "true").length;
      const badge = showMore.querySelector("span");
      if (badge) badge.textContent = String(remaining);
      showMore.hidden = remaining === 0;
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function animateCardMove(card, fromRect) {
    if (!card || !fromRect || prefersReducedMotion()) return;
    const toRect = card.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      card.classList.add("is-stage-saved");
      window.setTimeout(() => card.classList.remove("is-stage-saved"), 900);
      return;
    }

    card.classList.remove("is-stage-saved");
    card.classList.add("is-moving");
    card.style.transition = "none";
    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.985)`;
    card.style.zIndex = "5";

    card.getBoundingClientRect();
    window.requestAnimationFrame(() => {
      card.style.transition = "transform 420ms cubic-bezier(.2,.85,.2,1), box-shadow 420ms ease, opacity 220ms ease";
      card.style.transform = "";
    });

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      card.classList.remove("is-moving");
      card.classList.add("is-stage-saved");
      card.style.transition = "";
      card.style.transform = "";
      card.style.zIndex = "";
      window.setTimeout(() => card.classList.remove("is-stage-saved"), 900);
    };

    card.addEventListener(
      "transitionend",
      (event) => {
        if (event.propertyName === "transform") finish();
      },
      { once: true },
    );
    window.setTimeout(finish, 520);
  }

  function moveCardToTop(dropzone, card) {
    if (!dropzone || !card) return;
    card.hidden = false;
    delete card.dataset.crmDeferred;
    const firstCard =
      Array.from(dropzone.querySelectorAll(".crm-kanban-card")).find((candidate) => candidate !== card && !candidate.hidden) ||
      Array.from(dropzone.querySelectorAll(".crm-kanban-card")).find((candidate) => candidate !== card) ||
      null;
    dropzone.insertBefore(card, firstCard);
  }

  function valueOrDash(value) {
    const normalized = String(value || "").trim();
    return normalized || "-";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .toLocaleLowerCase()
      .replaceAll("ё", "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function searchTokens(value) {
    return normalizeSearchText(value).split(/\s+/).filter(Boolean);
  }

  function editDistanceWithin(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return false;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      let rowMin = current[0];
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        current[j] = value;
        rowMin = Math.min(rowMin, value);
      }
      if (rowMin > limit) return false;
      previous = current;
    }
    return previous[b.length] <= limit;
  }

  function tokenLooksLike(needle, word) {
    if (!needle || !word) return false;
    if (/^\d+$/.test(needle) || /^\d+$/.test(word)) return word.includes(needle);
    if (word.includes(needle) || needle.includes(word)) return true;
    if (needle.length < 3 || word.length < 3) return false;
    const limit = needle.length <= 4 ? 1 : 2;
    return editDistanceWithin(needle, word, limit);
  }

  function cardMatchesSearch(card, query) {
    const tokens = searchTokens(query);
    if (!tokens.length) return true;
    const title = card.dataset.crmDetailTitle || "";
    const client = card.dataset.crmDetailClient || "";
    const tags = card.dataset.crmTags || "";
    const haystack = normalizeSearchText(`${title} ${client} ${tags}`);
    if (haystack.includes(normalizeSearchText(query))) return true;
    const words = haystack.split(/\s+/).filter(Boolean);
    return tokens.every((token) => words.some((word) => tokenLooksLike(token, word)));
  }

  function highlightText(value, query) {
    const text = String(value || "");
    const term = String(query || "").trim();
    if (!term) return escapeHtml(text);
    const lowerText = text.toLocaleLowerCase();
    const lowerTerm = term.toLocaleLowerCase();
    const tokens = searchTokens(term);
    let cursor = 0;
    let result = "";
    while (cursor < text.length) {
      const index = lowerText.indexOf(lowerTerm, cursor);
      if (index === -1) {
        result += escapeHtml(text.slice(cursor));
        break;
      }
      result += escapeHtml(text.slice(cursor, index));
      result += `<mark class="crm-search-hit">${escapeHtml(text.slice(index, index + term.length))}</mark>`;
      cursor = index + term.length;
    }
    if (result !== escapeHtml(text)) return result;
    return text
      .split(/([\p{L}\p{N}_]+)/gu)
      .map((part) => {
        const normalized = normalizeSearchText(part);
        const isHit = normalized && tokens.some((token) => tokenLooksLike(token, normalized));
        return isHit ? `<mark class="crm-search-hit">${escapeHtml(part)}</mark>` : escapeHtml(part);
      })
      .join("");
  }

  function initSearchDropdowns() {
    const inputs = Array.from(document.querySelectorAll("[data-crm-search-dropdown]"));
    if (!inputs.length) return;
    const dropdowns = [];

    const uniqueOptions = (options) => {
      const seen = new Set();
      return options.filter((option) => {
        const key = normalizeSearchText(option.value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const optionsFor = (input) => {
      const source = input.dataset.crmSearchDropdown;
      if (source === "datalist") {
        const list = document.getElementById(input.dataset.crmSearchList || "");
        return uniqueOptions(
          Array.from(list?.querySelectorAll("option") || []).map((option) => ({
            value: option.value,
            main: option.value,
            meta: input.dataset.crmSearchMeta || "Вариант",
          })),
        );
      }
      if (source === "tasks") {
        return uniqueOptions(
          Array.from(document.querySelectorAll("[data-crm-task-row]")).map((row) => ({
            value: row.dataset.taskTitle || "",
            main: row.dataset.taskTitle || "",
            meta: [row.dataset.taskClient, row.dataset.taskResponsible].filter(Boolean).join(" · ") || "Задача",
          })),
        );
      }
      if (source === "archive") {
        return uniqueOptions(
          Array.from(document.querySelectorAll("[data-crm-archive-card]")).map((card) => ({
            value: card.dataset.crmDetailTitle || "",
            main: card.dataset.crmDetailTitle || "",
            meta: card.dataset.crmDetailClient || "Архив",
          })),
        );
      }
      return uniqueOptions(
        Array.from(document.querySelectorAll(".crm-kanban-card")).map((card) => ({
          value: card.dataset.crmDetailTitle || "",
          main: card.dataset.crmDetailTitle || "",
          meta: [card.dataset.crmDetailClient, card.dataset.crmDetailResponsible].filter(Boolean).join(" · ") || "Сделка",
        })),
      );
    };

    const matchesQuery = (option, query) => {
      const tokens = searchTokens(query);
      if (!tokens.length) return true;
      const words = normalizeSearchText(`${option.main} ${option.meta}`).split(/\s+/).filter(Boolean);
      return tokens.every((token) => words.some((word) => tokenLooksLike(token, word)));
    };

    inputs.forEach((input, inputIndex) => {
      const field = input.closest("label") || input.parentElement;
      if (!field || field.dataset.crmSearchReady === "true") return;
      field.dataset.crmSearchReady = "true";
      field.classList.add("crm-search-combo");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "crm-search-combo-toggle";
      toggle.setAttribute("aria-label", "Открыть список");
      toggle.setAttribute("title", "Открыть список");
      toggle.textContent = "⌄";

      const panel = document.createElement("div");
      panel.className = "sales-combo-panel crm-search-combo-panel";
      panel.id = `crm-search-options-${inputIndex}`;
      panel.setAttribute("role", "listbox");
      panel.hidden = true;
      field.append(toggle, panel);

      input.setAttribute("autocomplete", "off");
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-controls", panel.id);
      input.setAttribute("aria-expanded", "false");

      const close = () => {
        panel.hidden = true;
        input.setAttribute("aria-expanded", "false");
        field.classList.remove("is-open");
      };

      const position = () => {
        if (panel.hidden) return;
        const rect = input.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        const panelHeight = Math.min(panel.scrollHeight, 288);
        const hasRoomBelow = window.innerHeight - rect.bottom >= Math.min(panelHeight + 8, 180);
        const top = hasRoomBelow ? rect.bottom + 4 : Math.max(12, rect.top - panelHeight - 4);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.width = `${width}px`;
      };

      const choose = (option) => {
        input.value = option.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        close();
        input.focus();
      };

      const render = () => {
        const query = input.value.trim();
        const options = optionsFor(input).filter((option) => matchesQuery(option, query)).slice(0, 40);
        panel.replaceChildren();
        if (!options.length) {
          const empty = document.createElement("div");
          empty.className = "sales-combo-empty";
          empty.textContent = "Ничего не найдено";
          panel.append(empty);
          return;
        }
        options.forEach((option) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "sales-combo-option crm-search-combo-option";
          button.setAttribute("role", "option");
          const main = document.createElement("span");
          main.className = "sales-combo-main";
          main.innerHTML = highlightText(option.main, query);
          const meta = document.createElement("span");
          meta.className = "sales-combo-meta";
          meta.textContent = option.meta;
          button.append(main, meta);
          button.addEventListener("click", () => choose(option));
          panel.append(button);
        });
      };

      const open = () => {
        render();
        panel.hidden = false;
        input.setAttribute("aria-expanded", "true");
        field.classList.add("is-open");
        position();
      };

      input.addEventListener("focus", open);
      input.addEventListener("input", open);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          close();
          return;
        }
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        if (panel.hidden) open();
        panel.querySelector("button")?.focus();
      });
      toggle.addEventListener("click", () => {
        if (panel.hidden) {
          input.focus();
          open();
        } else {
          close();
          input.focus();
        }
      });
      panel.addEventListener("keydown", (event) => {
        const buttons = Array.from(panel.querySelectorAll("button"));
        const current = buttons.indexOf(document.activeElement);
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          input.focus();
        } else if (event.key === "ArrowDown" && current >= 0) {
          event.preventDefault();
          buttons[(current + 1) % buttons.length]?.focus();
        } else if (event.key === "ArrowUp" && current >= 0) {
          event.preventDefault();
          buttons[(current - 1 + buttons.length) % buttons.length]?.focus();
        }
      });
      dropdowns.push({ field, panel, position, close });
    });

    document.addEventListener("click", (event) => {
      dropdowns.forEach((dropdown) => {
        if (!dropdown.field.contains(event.target)) dropdown.close();
      });
    });
    window.addEventListener("resize", () => dropdowns.forEach((dropdown) => dropdown.position()));
    window.addEventListener("scroll", () => dropdowns.forEach((dropdown) => dropdown.position()), true);
  }

  function initCardDetails() {
    const dialog = document.getElementById("crm-card-detail-dialog");
    if (!dialog) return;
    const title = dialog.querySelector("#crm-card-detail-title");
    const subtitle = dialog.querySelector("[data-crm-card-detail-subtitle]");
    const client = dialog.querySelector("[data-crm-card-detail-client]");
    const clientLink = dialog.querySelector("[data-crm-card-detail-client-link]");
    const editButton = dialog.querySelector("[data-crm-card-detail-edit]");
    const orderButton = dialog.querySelector("[data-crm-card-detail-order]");
    const orderDialog = document.getElementById("crm-order-dialog");
    const orderFrame = orderDialog?.querySelector("[data-crm-order-dialog-frame]");
    const chat = dialog.querySelector("[data-crm-card-detail-chat]");
    const history = dialog.querySelector("[data-crm-card-detail-history]");
    const documents = dialog.querySelector("[data-crm-card-detail-documents]");
    const detailTags = dialog.querySelector("[data-crm-card-detail-tags]");
    const detailTagForm = dialog.querySelector("[data-crm-card-detail-tag-form]");
    const detailTabs = Array.from(dialog.querySelectorAll("[data-crm-detail-tab]"));
    const detailPanes = Array.from(dialog.querySelectorAll("[data-crm-detail-pane]"));
    const messengerList = dialog.querySelector("[data-crm-card-detail-messengers]");
    const chatFeed = dialog.querySelector("[data-crm-card-detail-chat-feed]");
    const taskFeed = dialog.querySelector("[data-crm-card-detail-task-feed]");
    const commentFeed = dialog.querySelector("[data-crm-card-detail-comment-feed]");
    const activityForms = Array.from(dialog.querySelectorAll("[data-crm-activity-form]"));
    let detailCard = null;
    const fields = {
      title: dialog.querySelector('[data-crm-card-detail-field="title"]'),
      type: dialog.querySelector('[data-crm-card-detail-field="type"]'),
      source: dialog.querySelector('[data-crm-card-detail-field="source"]'),
      stage: dialog.querySelector('[data-crm-card-detail-field="stage"]'),
      status: dialog.querySelector('[data-crm-card-detail-field="status"]'),
      service: dialog.querySelector('[data-crm-card-detail-field="service"]'),
      priority: dialog.querySelector('[data-crm-card-detail-field="priority"]'),
      probability: dialog.querySelector('[data-crm-card-detail-field="probability"]'),
      amount: dialog.querySelector('[data-crm-card-detail-field="amount"]'),
      responsible: dialog.querySelector('[data-crm-card-detail-field="responsible"]'),
      date: dialog.querySelector('[data-crm-card-detail-field="date"]'),
      dueDate: dialog.querySelector('[data-crm-card-detail-field="dueDate"]'),
      nextStep: dialog.querySelector('[data-crm-card-detail-field="nextStep"]'),
      note: dialog.querySelector('[data-crm-card-detail-field="note"]'),
      lostReason: dialog.querySelector('[data-crm-card-detail-field="lostReason"]'),
    };

    const setText = (node, value) => {
      if (node) node.textContent = valueOrDash(value);
    };

    const showDetailPane = (name) => {
      detailTabs.forEach((button) => button.classList.toggle("is-active", button.dataset.crmDetailTab === name));
      detailPanes.forEach((pane) => {
        pane.hidden = pane.dataset.crmDetailPane !== name;
      });
    };

    const fillFeed = (feed, card, selector, emptyText) => {
      if (!feed) return;
      const template = card.querySelector(selector);
      const content = template?.innerHTML?.trim() || "";
      feed.innerHTML = content || `<p class="crm-card-detail-empty">${escapeHtml(emptyText)}</p>`;
    };

    const documentText = (value) => {
      const normalized = String(value == null ? "" : value).trim();
      return normalized || "-";
    };

    const documentNumber = (value, maximumFractionDigits = 2) => {
      const raw = String(value == null ? "" : value)
        .replace(/\b(UZS|USD)\b/gi, "")
        .replace(/\u00a0/g, " ")
        .trim();
      const normalized = raw.replace(/\s+/g, "").replace(",", ".");
      const numeric = Number(normalized);
      if (!normalized || !Number.isFinite(numeric)) return documentText(raw);
      return new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits,
      }).format(numeric);
    };

    const documentMoney = (value, currency) => {
      const amount = documentNumber(value);
      const suffix = documentText(currency || "UZS");
      return `${amount} ${suffix}`;
    };

    const lineValue = (line, names, fallback) => {
      for (const name of names) {
        const value = line && line[name];
        if (value != null && String(value).trim() !== "") return value;
      }
      return fallback;
    };

    const renderDocumentLines = (root, documentData) => {
      if (!root) return;
      const lines = Array.isArray(documentData.lines) ? documentData.lines : [];
      if (!lines.length) {
        root.innerHTML = '<p class="crm-card-detail-empty">Состав документа не указан.</p>';
        return;
      }
      root.innerHTML = lines.map((line, index) => {
        const name = lineValue(line, ["product", "product_name", "name", "service", "title"], "Позиция");
        const quantity = documentNumber(lineValue(line, ["quantity", "qty", "count"], "-"), 3);
        const price = lineValue(line, ["price", "unit_price", "price_label"], "");
        const total = lineValue(line, ["total", "sum", "amount", "line_total"], "");
        return (
          '<div class="crm-document-line">' +
          `<span class="crm-document-line-index">${escapeHtml(index + 1)}</span>` +
          `<strong>${escapeHtml(name)}</strong>` +
          '<dl class="crm-document-line-values">' +
          `<div><dt>Кол-во</dt><dd>${escapeHtml(quantity)}</dd></div>` +
          `<div><dt>Цена</dt><dd>${escapeHtml(price ? documentMoney(price, documentData.currency) : "-")}</dd></div>` +
          `<div><dt>Сумма</dt><dd>${escapeHtml(total ? documentMoney(total, documentData.currency) : "-")}</dd></div>` +
          "</dl>" +
          "</div>"
        );
      }).join("");
    };

    const closeDocumentDetail = (article) => {
      if (!article) return;
      const trigger = article.querySelector("[data-crm-document-open]");
      const content = article.querySelector("[data-crm-document-expand]");
      article.classList.remove("is-open");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (content) content.hidden = true;
    };

    const documentFilterOptions = [
      { type: "order", brand: "order", logo: "ЗК", label: "Заказы", empty: "Заказов по клиенту пока нет." },
      { type: "sale", brand: "sale", logo: "ОТ", label: "Отгрузки", empty: "Отгрузок по клиенту пока нет." },
      { type: "return", brand: "return", logo: "ВЗ", label: "Возвраты", empty: "Возвратов по клиенту пока нет." },
    ];

    const normalizeDocumentType = (value) => {
      const type = String(value || "").trim().toLowerCase();
      return type === "order" || type === "return" ? type : "sale";
    };

    const applyDocumentFilter = (type) => {
      if (!documents) return;
      const activeType = normalizeDocumentType(type);
      let visibleCount = 0;
      documents.querySelectorAll(".crm-card-detail-document").forEach((article) => {
        const visible = normalizeDocumentType(article.dataset.crmDocumentType) === activeType;
        article.hidden = !visible;
        if (visible) {
          visibleCount += 1;
        } else {
          closeDocumentDetail(article);
        }
      });
      documents.querySelectorAll("[data-crm-document-filter]").forEach((button) => {
        const active = button.dataset.crmDocumentFilter === activeType;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      const empty = documents.querySelector("[data-crm-document-filter-empty]");
      if (empty) {
        empty.textContent = documentFilterOptions.find((option) => option.type === activeType)?.empty || "";
        empty.hidden = visibleCount > 0;
      }
    };

    const setupDocumentFilters = () => {
      if (!documents) return;
      Array.from(documents.children).forEach((child) => {
        if (child.classList.contains("crm-card-detail-empty")) child.remove();
      });
      const counts = { order: 0, sale: 0, return: 0 };
      documents.querySelectorAll(".crm-card-detail-document").forEach((article) => {
        counts[normalizeDocumentType(article.dataset.crmDocumentType)] += 1;
      });
      const tabs = document.createElement("nav");
      tabs.className = "messenger-channel-tabs sales-document-tabs crm-document-type-tabs";
      tabs.setAttribute("aria-label", "Типы документов клиента");
      tabs.innerHTML =
        '<span class="sales-document-tabs-title">Разделы документов</span>' +
        documentFilterOptions.map((option) => (
          `<button type="button" class="messenger-channel-tab sales-document-tab" ` +
          `data-channel-brand="${option.brand}" data-crm-document-filter="${option.type}" aria-pressed="false">` +
          `<span class="messenger-channel-logo" aria-hidden="true">${option.logo}</span>` +
          `<span class="messenger-channel-label">${option.label}</span>` +
          `<b>${counts[option.type]}</b>` +
          "</button>"
        )).join("");
      const empty = document.createElement("p");
      empty.className = "crm-card-detail-empty crm-document-filter-empty";
      empty.dataset.crmDocumentFilterEmpty = "";
      documents.prepend(tabs);
      documents.append(empty);
      applyDocumentFilter("order");
    };

    const toggleDocumentDetail = (trigger) => {
      if (!trigger) return;
      const article = trigger.closest(".crm-card-detail-document");
      const content = article?.querySelector("[data-crm-document-expand]");
      if (!article || !content) return;
      const willOpen = trigger.getAttribute("aria-expanded") !== "true";
      documents?.querySelectorAll(".crm-card-detail-document.is-open").forEach((item) => {
        if (item !== article) closeDocumentDetail(item);
      });
      if (!willOpen) {
        closeDocumentDetail(article);
        return;
      }
      let documentData = {};
      try {
        documentData = JSON.parse(trigger.dataset.crmDocument || "{}");
      } catch {
        documentData = {};
      }
      const label = trigger.dataset.crmDocumentLabel || documentData.doc_type_label || "Документ";
      const note = String(documentData.note || "").trim();
      content.innerHTML =
        '<div class="crm-document-expand-head">' +
        `<strong>${escapeHtml(label)} ${escapeHtml(documentText(documentData.number))}</strong>` +
        "</div>" +
        '<div class="crm-document-metrics">' +
        `<div><span>Сумма</span><strong>${escapeHtml(documentMoney(documentData.amount, documentData.currency))}</strong></div>` +
        `<div><span>Оплачено</span><strong>${escapeHtml(documentMoney(documentData.paid_amount, documentData.currency))}</strong></div>` +
        `<div><span>Остаток</span><strong>${escapeHtml(documentMoney(documentData.debt_amount, documentData.currency))}</strong></div>` +
        "</div>" +
        '<dl class="crm-document-meta">' +
        `<div><dt>Дата</dt><dd>${escapeHtml(documentText(documentData.date_label || documentData.date))}</dd></div>` +
        `<div><dt>Статус</dt><dd>${escapeHtml(documentText(documentData.status_label))}</dd></div>` +
        `<div><dt>Склад</dt><dd>${escapeHtml(documentText(documentData.warehouse))}</dd></div>` +
        `<div><dt>Ответственный</dt><dd>${escapeHtml(documentText(documentData.manager || "Не назначен"))}</dd></div>` +
        (note ? `<div class="wide"><dt>Комментарий</dt><dd>${escapeHtml(note)}</dd></div>` : "") +
        "</dl>" +
        '<div class="crm-document-lines crm-document-lines--inline">' +
        "<h4>Позиции</h4>" +
        '<div data-crm-document-lines></div>' +
        "</div>" +
        '<div class="crm-document-expand-actions"><a class="btn btn-secondary btn-sm" data-crm-document-go>Перейти к документу</a></div>';
      renderDocumentLines(content.querySelector("[data-crm-document-lines]"), documentData);
      const goLink = content.querySelector("[data-crm-document-go]");
      if (goLink) {
        goLink.href = trigger.dataset.crmDocumentHref || "/sales#sales-journal";
      }
      content.hidden = false;
      article.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
    };

    const showMessengerThread = (threadId) => {
      if (!messengerList || !chatFeed) return;
      const tabs = Array.from(messengerList.querySelectorAll("[data-crm-thread-tab]"));
      const panes = Array.from(chatFeed.querySelectorAll("[data-crm-thread-chat]"));
      const fallbackId = tabs[0]?.dataset.crmThreadTab || panes[0]?.dataset.crmThreadChat || "";
      const activeId = String(threadId || fallbackId || "");
      tabs.forEach((tab) => {
        const active = tab.dataset.crmThreadTab === activeId;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-pressed", active ? "true" : "false");
      });
      panes.forEach((pane) => {
        pane.hidden = pane.dataset.crmThreadChat !== activeId;
      });
      const activePane = panes.find((pane) => pane.dataset.crmThreadChat === activeId);
      const heading = activePane?.querySelector(".crm-card-detail-thread-head strong")?.textContent || "Обычный чат";
      setText(chat, heading);
    };

    const renderActivityEvent = (event, kind) => {
      const at = String(event?.at || "-").slice(0, 16).replace("T", " ");
      const actor = String(event?.actor || "UPOS");
      const detail = String(event?.detail || "");
      if (kind === "task") {
        const priorityLabels = { low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочно" };
        const due = [event?.due_date || at.slice(0, 10), event?.due_time].filter(Boolean).join(" ");
        const assignee = event?.assignee || actor || "Без ответственного";
        const participants = String(event?.participants || "").trim();
        const reminder = String(event?.reminder_at || "").trim().replace("T", " ");
        const priority = priorityLabels[event?.priority] || priorityLabels.normal;
        const completed = Boolean(event?.completed);
        const checklist = Array.isArray(event?.checklist) ? event.checklist.filter(Boolean) : [];
        const checklistHtml = checklist.length
          ? `<ul class="crm-task-checklist">${checklist.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>`
          : "";
        const extra = [
          participants ? `Участники: ${participants}` : "",
          reminder ? `Напомнить: ${reminder}` : "",
        ].filter(Boolean);
        return `<article class="crm-card-detail-event crm-card-detail-event--task${completed ? " crm-card-detail-event--done" : ""}">
          <div class="crm-task-detail-row"><strong>${escapeHtml(detail)}</strong><em class="crm-task-status${completed ? " crm-task-status--done" : ""}">${completed ? "Выполнено" : "В работе"}</em></div>
          <span class="crm-task-meta">${escapeHtml(due)} · ${escapeHtml(assignee)} · ${escapeHtml(priority)}</span>
          ${extra.length ? `<p>${escapeHtml(extra.join(" · "))}</p>` : ""}
          ${checklistHtml}
        </article>`;
      }
      return `<article class="crm-card-detail-event crm-card-detail-event--${kind}"><strong>${escapeHtml(at)}</strong><span>${escapeHtml(actor)}</span><p>${escapeHtml(detail)}</p></article>`;
    };

    const openDetails = (card) => {
      if (!card) return;
      detailCard = card;
      const data = card.dataset;
      setText(title, data.crmDetailTitle || "Карточка клиента");
      setText(subtitle, `${valueOrDash(data.crmDetailStage)} · ${valueOrDash(data.crmDetailStatus)}`);
      setText(client, data.crmDetailClient || "Клиент не указан");
      if (clientLink) {
        if (data.crmDetailClientHref) {
          clientLink.href = data.crmDetailClientHref;
          clientLink.hidden = false;
        } else {
          clientLink.hidden = true;
          clientLink.removeAttribute("href");
        }
      }
      if (editButton) {
        const payload = data.crmEditPayload || "";
        editButton.hidden = !payload;
        editButton.dataset.crmEditPayload = payload;
      }
      if (orderButton) {
        if (data.crmDetailOrderHref) {
          orderButton.dataset.crmOrderHref = data.crmDetailOrderHref;
          orderButton.hidden = false;
        } else {
          orderButton.hidden = true;
          delete orderButton.dataset.crmOrderHref;
        }
      }
      setText(chat, data.crmDetailChat || "Не привязан");
      setText(fields.title, data.crmDetailTitle);
      setText(fields.type, data.crmDetailType);
      setText(fields.source, data.crmDetailSource);
      setText(fields.stage, data.crmDetailStage);
      setText(fields.status, data.crmDetailStatus);
      setText(fields.service, data.crmDetailService);
      setText(fields.priority, data.crmDetailPriority);
      setText(fields.probability, data.crmDetailProbability);
      setText(fields.amount, data.crmDetailAmount);
      setText(fields.responsible, data.crmDetailResponsible);
      setText(fields.date, data.crmDetailDate);
      setText(fields.dueDate, data.crmDetailDueDate);
      setText(fields.nextStep, data.crmDetailNextStep);
      setText(fields.note, data.crmDetailNote);
      setText(fields.lostReason, data.crmDetailLostReason);
      fillTagList(detailTags, data.crmTags || "");
      if (history) {
        const historyTemplate = card.querySelector("template[data-crm-card-history]");
        const content = historyTemplate?.innerHTML?.trim() || "";
        history.innerHTML = content || '<p class="crm-card-detail-empty">История по клиенту пока пустая.</p>';
      }
      fillFeed(chatFeed, card, "template[data-crm-card-chat]", "Сообщений пока нет.");
      fillFeed(documents, card, "template[data-crm-card-documents]", "Заказов и отгрузок по клиенту пока нет.");
      setupDocumentFilters();
      fillFeed(messengerList, card, "template[data-crm-card-messengers]", "Связанных мессенджеров пока нет.");
      showMessengerThread("");
      fillFeed(taskFeed, card, "template[data-crm-card-tasks]", "Задач пока нет.");
      fillFeed(commentFeed, card, "template[data-crm-card-comments]", "Комментариев пока нет.");
      showDetailPane("comments");
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    };

    const closeDetails = () => {
      detailCard = null;
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    };

    const closeOrderDialog = () => {
      if (!orderDialog) return;
      if (orderDialog.open && typeof orderDialog.close === "function") {
        orderDialog.close();
      } else {
        orderDialog.removeAttribute("open");
      }
      if (orderFrame) orderFrame.src = "about:blank";
    };

    const openOrderDialog = () => {
      const href = orderButton?.dataset.crmOrderHref || "";
      if (!href || !orderDialog || !orderFrame) return;
      const url = new URL(href, window.location.origin);
      url.searchParams.set("embed", "1");
      url.hash = "sales-form";
      orderFrame.src = url.toString();
      if (typeof orderDialog.showModal === "function") {
        orderDialog.showModal();
      } else {
        orderDialog.setAttribute("open", "");
      }
    };

    document.querySelectorAll(".crm-kanban-card").forEach((card) => {
      card.querySelectorAll("a.crm-kanban-client").forEach((link) => {
        // Ссылка на клиента выглядела кликабельной, но переход был отменён.
        // Оставляем переход и не даём карточке открыться поверх него.
        link.addEventListener("click", (event) => {
          event.stopPropagation();
        });
      });
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        openDetails(card);
      });
      // На телефоне и планшете двойного клика нет, с клавиатуры карточка тоже
      // была недостижима — открываем и одиночным кликом, и Enter.
      card.addEventListener("click", (event) => {
        if (event.detail > 1) return;
        if (event.target.closest("a, button, input, select, textarea")) return;
        openDetails(card);
      });
      if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "0");
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target !== card) return;
        event.preventDefault();
        openDetails(card);
      });
    });
    dialog.querySelectorAll("[data-crm-card-detail-close]").forEach((button) => {
      button.addEventListener("click", closeDetails);
    });
    editButton?.addEventListener("click", () => {
      const raw = editButton.dataset.crmEditPayload || "{}";
      closeDetails();
      document.dispatchEvent(new CustomEvent("crm:edit-record", { detail: { payload: raw } }));
    });
    orderButton?.addEventListener("click", openOrderDialog);
    orderDialog?.querySelectorAll("[data-crm-order-dialog-close]").forEach((button) => {
      button.addEventListener("click", closeOrderDialog);
    });
    orderDialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeOrderDialog();
    });
    orderDialog?.addEventListener("click", (event) => {
      if (event.target === orderDialog) closeOrderDialog();
    });
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin || event.source !== orderFrame?.contentWindow) return;
      if (event.data?.type === "upos:sales-order-cancel") {
        closeOrderDialog();
      }
      if (event.data?.type === "upos:sales-order-saved") {
        closeOrderDialog();
        window.location.reload();
      }
    });
    detailTabs.forEach((button) => {
      button.addEventListener("click", () => showDetailPane(button.dataset.crmDetailTab || "history"));
    });
    messengerList?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-crm-thread-tab]");
      if (tab) showMessengerThread(tab.dataset.crmThreadTab || "");
    });
    messengerList?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const tab = event.target.closest("[data-crm-thread-tab]");
      if (!tab) return;
      event.preventDefault();
      showMessengerThread(tab.dataset.crmThreadTab || "");
    });
    documents?.addEventListener("click", (event) => {
      const filter = event.target.closest("[data-crm-document-filter]");
      if (filter) {
        applyDocumentFilter(filter.dataset.crmDocumentFilter);
        return;
      }
      const trigger = event.target.closest("[data-crm-document-open]");
      if (trigger) toggleDocumentDetail(trigger);
    });
    activityForms.forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const root = document.querySelector("[data-crm-activity-url-template]");
        const recordId = detailCard?.dataset.crmRecordId || "";
        const kind = form.dataset.crmActivityForm || "comment";
        const textInput = form.querySelector('[name="text"]');
        const payload = {
          kind,
          text: String(textInput?.value || "").trim(),
          due_date: String(form.querySelector('[name="due_date"]')?.value || ""),
          due_time: String(form.querySelector('[name="due_time"]')?.value || ""),
          assignee: String(form.querySelector('[name="assignee"]')?.value || "").trim(),
          participants: String(form.querySelector('[name="participants"]')?.value || "").trim(),
          reminder_at: String(form.querySelector('[name="reminder_at"]')?.value || ""),
          priority: String(form.querySelector('[name="priority"]')?.value || "normal"),
          checklist: String(form.querySelector('[name="checklist"]')?.value || ""),
          completed: form.querySelector('[name="completed"]')?.checked ? "1" : "",
        };
        if (!root || !recordId || !payload.text || form.classList.contains("is-saving")) return;
        // Сообщение в чате уходит клиенту в Instagram, если у карточки есть
        // привязанная переписка Direct: раньше кнопка «Отправить» только
        // писала в историю, и клиент ничего не получал.
        if (kind === "chat") {
          const activeThread = dialog.querySelector('[data-crm-thread-chat]:not([hidden])');
          const threadKey = String(activeThread?.dataset.crmThreadChat || "");
          const instagramId = threadKey.indexOf("instagram-thread-") === 0
            ? threadKey.slice("instagram-thread-".length)
            : "";
          if (instagramId) {
            form.classList.add("is-saving");
            fetch("/api/messengers/instagram/send", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": root.dataset.crmCsrf || "",
              },
              body: JSON.stringify({ thread_id: instagramId, text: payload.text }),
            })
              .then((response) =>
                response.json().catch(() => ({})).then((body) => {
                  if (!response.ok || body.ok === false) throw new Error(body.error || "Не удалось отправить сообщение");
                  return body;
                })
              )
              .then(() => postActivity(root, recordId, payload))
              .then((result) => {
                const eventData = result?.event || payload;
                if (chatFeed) {
                  chatFeed.querySelector(".crm-card-detail-empty")?.remove();
                  chatFeed.insertAdjacentHTML("afterbegin", renderActivityEvent(eventData, "chat"));
                }
                form.reset();
              })
              .catch((error) => {
                window.alert(error.message || "Не удалось отправить сообщение");
              })
              .finally(() => form.classList.remove("is-saving"));
            return;
          }
        }
        form.classList.add("is-saving");
        postActivity(root, recordId, payload)
          .then((result) => {
            if (!result?.ok) throw new Error(result?.error || "activity_failed");
            const eventData = result.event || payload;
            const feed = kind === "chat" ? chatFeed : kind === "task" ? taskFeed : commentFeed;
            const html = renderActivityEvent(eventData, kind);
            if (feed) {
              feed.querySelector(".crm-card-detail-empty")?.remove();
              feed.insertAdjacentHTML("afterbegin", html);
            }
            const templateSelector = kind === "chat" ? "template[data-crm-card-chat]" : kind === "task" ? "template[data-crm-card-tasks]" : "template[data-crm-card-comments]";
            const cardTemplate = detailCard?.querySelector(templateSelector);
            if (cardTemplate) cardTemplate.innerHTML = html + cardTemplate.innerHTML;
            if (history) {
              history.querySelector(".crm-card-detail-empty")?.remove();
              history.insertAdjacentHTML("afterbegin", renderActivityEvent(eventData, kind));
            }
            form.reset();
          })
          .catch(() => window.location.reload())
          .finally(() => form.classList.remove("is-saving"));
      });
    });
    detailTagForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const root = document.querySelector("[data-crm-tag-url-template]");
      const input = detailTagForm.querySelector('input[name="tag"]');
      const tag = String(input?.value || "").trim();
      const recordId = detailCard?.dataset.crmRecordId || "";
      if (!root || !detailCard || !recordId || !tag || detailTagForm.classList.contains("is-saving")) return;
      detailTagForm.classList.add("is-saving");
      postTag(root, recordId, tag)
        .then((result) => {
          if (!result?.ok) throw new Error(result?.error || "tag_failed");
          const tags = updateCardTags(detailCard, result.tags || []);
          fillTagList(detailTags, tags);
          if (input) input.value = "";
        })
        .catch(() => {
          window.location.reload();
        })
        .finally(() => {
          detailTagForm.classList.remove("is-saving");
        });
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDetails();
    });
  }

  function initKanban(root) {
    let dragged = null;
    let selectedCard = null;
    const archiveList = document.querySelector("[data-crm-archive-card-row]");
    const archiveCount = document.querySelector("[data-crm-archive-count]");
    const archiveSearch = document.querySelector("[data-crm-archive-search]");
    const searchInput = document.querySelector('.crm-kanban-filters input[name="q"]');
    const trashDrop = document.querySelector("[data-crm-trash-drop]");
    const lostDialog = document.getElementById("crm-lost-reason-dialog");

    // Резолвится списком причин: пустой список означает отмену.
    const requestLostReason = () =>
      new Promise((resolve) => {
        if (!lostDialog) {
          const typed = String(window.prompt("Почему сделка потеряна?") || "").trim();
          resolve(typed ? [typed] : []);
          return;
        }
        const form = lostDialog.querySelector("[data-crm-lost-reason-form]");
        const checkboxes = Array.from(form?.querySelectorAll('[name="lost_reasons"]') || []);
        const custom = form?.querySelector('[name="lost_reason_custom"]');
        const hint = form?.querySelector("[data-crm-lost-hint]");
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          form?.removeEventListener("submit", onSubmit);
          lostDialog.querySelectorAll("[data-crm-lost-cancel]").forEach((button) => button.removeEventListener("click", onCancel));
          lostDialog.removeEventListener("cancel", onCancel);
          if (lostDialog.open) lostDialog.close();
          resolve(value);
        };
        const onSubmit = (event) => {
          event.preventDefault();
          const picked = checkboxes.filter((box) => box.checked).map((box) => box.value.trim());
          const typed = String(custom?.value || "").trim();
          if (typed) picked.push(typed);
          if (!picked.length) {
            if (hint) hint.hidden = false;
            (checkboxes[0] || custom)?.focus();
            return;
          }
          finish(picked);
        };
        const onCancel = (event) => {
          event?.preventDefault?.();
          finish([]);
        };
        checkboxes.forEach((box) => {
          box.checked = false;
        });
        if (custom) custom.value = "";
        if (hint) hint.hidden = true;
        form?.addEventListener("submit", onSubmit);
        lostDialog.querySelectorAll("[data-crm-lost-cancel]").forEach((button) => button.addEventListener("click", onCancel));
        lostDialog.addEventListener("cancel", onCancel);
        if (typeof lostDialog.showModal === "function") lostDialog.showModal();
        else lostDialog.setAttribute("open", "");
        (checkboxes[0] || custom)?.focus();
      });

    const setSelectedCard = (card) => {
      if (selectedCard && selectedCard !== card) selectedCard.classList.remove("is-selected");
      selectedCard = card;
      if (selectedCard) selectedCard.classList.add("is-selected");
    };

    const appendArchivedItem = (card) => {
      if (!archiveList || !card) return;
      const empty = archiveList.querySelector("[data-crm-archive-empty]");
      if (empty) empty.remove();
      const item = document.createElement("article");
      item.className = "crm-archive-card";
      item.setAttribute("data-crm-archive-card", "");
      item.dataset.crmRecordId = card.dataset.crmRecordId || "";
      const title = valueOrDash(card.dataset.crmDetailTitle);
      const client = valueOrDash(card.dataset.crmDetailClient);
      const amount = valueOrDash(card.dataset.crmDetailAmount);
      const orderCount = Number.parseInt(card.dataset.crmOrderCount || "0", 10) || 0;
      const date = valueOrDash(card.dataset.crmDetailDate || card.dataset.crmDetailDueDate);
      const type = valueOrDash(card.dataset.crmDetailType);
      item.dataset.crmDetailTitle = title;
      item.dataset.crmDetailClient = client === "-" ? "" : client;
      item.innerHTML = `
        <div class="crm-kanban-card-date"></div>
        <div class="crm-kanban-card-top">
          <strong></strong>
          <span></span>
        </div>
        <span class="crm-kanban-client"></span>
        <div class="crm-kanban-card-money">
          <div class="crm-kanban-card-money-main">
            <strong></strong>
            <span class="crm-kanban-order-count" hidden></span>
          </div>
        </div>
        <form method="post" class="crm-archive-restore-form">
          <input type="hidden" name="csrf_token" />
          <button class="btn btn-secondary" type="submit">Вернуть из архива</button>
        </form>
      `;
      item.querySelector(".crm-kanban-card-date").textContent = date;
      item.querySelector(".crm-kanban-card-top strong").textContent = title;
      item.querySelector(".crm-kanban-card-top span").textContent = type;
      item.querySelector(".crm-kanban-client").textContent = client === "-" ? "" : client;
      item.querySelector(".crm-kanban-card-money strong").textContent = amount;
      const orderBadge = item.querySelector(".crm-kanban-order-count");
      if (orderBadge && orderCount > 0) {
        orderBadge.hidden = false;
        orderBadge.textContent = `${orderCount}+`;
        orderBadge.setAttribute("aria-label", `${orderCount} заказов`);
      }
      const restoreForm = item.querySelector(".crm-archive-restore-form");
      const restoreTemplate = root.dataset.crmRestoreUrlTemplate || "/crm/__record__/restore";
      if (restoreForm) {
        restoreForm.action = restoreTemplate.replace("__record__", encodeURIComponent(item.dataset.crmRecordId));
        restoreForm.querySelector('input[name="csrf_token"]').value = root.dataset.crmCsrf || "";
      }
      archiveList.prepend(item);
      applyArchiveSearch();
    };

    const updateArchiveCount = () => {
      if (!archiveCount) return;
      archiveCount.textContent = String(archiveList?.querySelectorAll("[data-crm-archive-card]").length || 0);
    };

    const showTrashDrop = () => {
      if (trashDrop) trashDrop.hidden = false;
    };

    const hideTrashDrop = () => {
      if (!trashDrop) return;
      trashDrop.hidden = true;
      trashDrop.classList.remove("is-over", "is-saving");
    };

    const archiveCard = (card) => {
      const recordId = card?.dataset.crmRecordId || "";
      if (!card || !recordId || card.classList.contains("is-archiving")) return Promise.resolve(false);
      const previousColumn = card.closest(".crm-kanban-column");
      card.classList.add("is-archiving");
      if (trashDrop) trashDrop.classList.add("is-saving");
      return postArchive(root, recordId)
        .then(() => {
          appendArchivedItem(card);
          updateArchiveCount();
          card.remove();
          if (previousColumn) updateColumnState(previousColumn);
          setSelectedCard(null);
          return true;
        })
        .catch(() => {
          window.location.reload();
          return false;
        })
        .finally(() => {
          card.classList.remove("is-archiving");
          if (trashDrop) trashDrop.classList.remove("is-over", "is-saving");
        });
    };

    const renderSearchMatch = (card, query) => {
      const title = card.dataset.crmDetailTitle || "";
      const client = card.dataset.crmDetailClient || "";
      const titleNode = card.querySelector(".crm-kanban-card-titleline strong, .crm-kanban-card-top > strong");
      const clientNode = card.querySelector(".crm-kanban-client");
      if (titleNode) titleNode.innerHTML = highlightText(title, query);
      if (clientNode) clientNode.innerHTML = highlightText(client, query);
    };

    const renderTags = (card, tags) => {
      updateCardTags(card, tags);
    };

    const applyArchiveSearch = () => {
      const query = String(archiveSearch?.value || "").trim();
      let visibleCount = 0;
      archiveList?.querySelectorAll("[data-crm-archive-card]").forEach((card) => {
        const visible = cardMatchesSearch(card, query);
        card.hidden = !visible;
        renderSearchMatch(card, visible ? query : "");
        if (visible) visibleCount += 1;
      });
      const empty = archiveList?.querySelector("[data-crm-archive-empty]");
      if (empty) {
        const hasCards = Boolean(archiveList?.querySelector("[data-crm-archive-card]"));
        empty.hidden = hasCards && visibleCount > 0;
        if (hasCards && visibleCount === 0) empty.textContent = "Ничего не найдено.";
        if (!hasCards) empty.textContent = "Архив пока пустой.";
      }
    };

    const applySearch = () => {
      const query = String(searchInput?.value || "").trim();
      root.querySelectorAll(".crm-kanban-card").forEach((card) => {
        const visible = cardMatchesSearch(card, query);
        card.hidden = query ? !visible : card.dataset.crmDeferred === "true";
        renderSearchMatch(card, visible ? query : "");
        if (!visible && selectedCard === card) setSelectedCard(null);
      });
      root.querySelectorAll(".crm-kanban-column").forEach(updateColumnState);
    };

    root.querySelectorAll("[data-crm-show-more]").forEach((button) => {
      button.addEventListener("click", () => {
        const column = button.closest(".crm-kanban-column");
        const deferred = Array.from(column?.querySelectorAll('.crm-kanban-card[data-crm-deferred="true"]') || []).slice(0, 20);
        deferred.forEach((card) => {
          delete card.dataset.crmDeferred;
          card.hidden = false;
        });
        if (column) updateColumnState(column);
      });
    });

    root.addEventListener("submit", (event) => {
      const form = event.target?.closest?.("[data-crm-tag-form]");
      if (!form || !root.contains(form)) return;
      event.preventDefault();
      const card = form.closest(".crm-kanban-card");
      const input = form.querySelector('input[name="tag"]');
      const tag = String(input?.value || "").trim();
      const recordId = card?.dataset.crmRecordId || "";
      if (!tag || !card || !recordId || form.classList.contains("is-saving")) return;
      form.classList.add("is-saving");
      postTag(root, recordId, tag)
        .then((result) => {
          if (!result?.ok) throw new Error(result?.error || "tag_failed");
          renderTags(card, result.tags || []);
          if (input) input.value = "";
        })
        .catch(() => {
          window.location.reload();
        })
        .finally(() => {
          form.classList.remove("is-saving");
        });
    });

    root.querySelectorAll(".crm-kanban-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input, select, textarea")) return;
        setSelectedCard(card);
      });
      card.addEventListener("dragstart", (event) => {
        dragged = card;
        setSelectedCard(card);
        showTrashDrop();
        card.classList.add("is-dragging");
        root.classList.add("is-drag-active");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.crmRecordId || "");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        root.classList.remove("is-drag-active");
        root.querySelectorAll(".crm-kanban-column.is-over").forEach((column) => column.classList.remove("is-over"));
        window.setTimeout(hideTrashDrop, 80);
        dragged = null;
      });
    });

    if (trashDrop) {
      trashDrop.addEventListener("dragover", (event) => {
        event.preventDefault();
        trashDrop.classList.add("is-over");
        event.dataTransfer.dropEffect = "move";
      });
      trashDrop.addEventListener("dragleave", (event) => {
        if (!trashDrop.contains(event.relatedTarget)) trashDrop.classList.remove("is-over");
      });
      trashDrop.addEventListener("drop", (event) => {
        event.preventDefault();
        const recordId = event.dataTransfer.getData("text/plain") || dragged?.dataset.crmRecordId || "";
        const card = dragged || root.querySelector(`[data-crm-record-id="${CSS.escape(recordId)}"]`);
        archiveCard(card).finally(hideTrashDrop);
      });
    }

    root.querySelectorAll(".crm-kanban-column").forEach((column) => {
      const dropzone = column.querySelector("[data-crm-dropzone]");
      if (!dropzone) return;
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        column.classList.add("is-over");
        event.dataTransfer.dropEffect = "move";
      });
      dropzone.addEventListener("dragleave", (event) => {
        if (!column.contains(event.relatedTarget)) column.classList.remove("is-over");
      });
      dropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        column.classList.remove("is-over");
        const recordId = event.dataTransfer.getData("text/plain") || dragged?.dataset.crmRecordId || "";
        const card = dragged || root.querySelector(`[data-crm-record-id="${CSS.escape(recordId)}"]`);
        const stageId = column.dataset.crmStageId || "";
        if (!card || !recordId || !stageId) return;
        // Пока прошлый перенос не сохранён, новый игнорируем: два запроса
        // подряд приходили вразнобой и на сервере оставался не тот этап.
        if (card.dataset.crmStageSaving === "1") return;
        const lostReasons = column.dataset.crmStageOutcome === "lost" ? await requestLostReason() : [];
        if (column.dataset.crmStageOutcome === "lost" && !lostReasons.length) return;
        const previousColumn = card.closest(".crm-kanban-column");
        const previousDropzone = card.parentElement;
        const previousSibling = card.nextElementSibling;
        const previousRect = card.getBoundingClientRect();
        card.dataset.crmStageSaving = "1";
        moveCardToTop(dropzone, card);
        card.classList.remove("is-dragging");
        column.classList.add("is-committing");
        if (previousColumn) updateColumnState(previousColumn);
        updateColumnState(column);
        animateCardMove(card, previousRect);
        postStage(root, recordId, stageId, lostReasons)
          .then((result) => {
            if (result && result.ok === false) throw new Error(result.error || "stage_failed");
            column.classList.add("is-saved");
            window.setTimeout(() => column.classList.remove("is-saved"), 900);
          })
          .catch((error) => {
            // Сервер не принял этап — возвращаем карточку на место, чтобы
            // экран не расходился с базой.
            if (previousDropzone) {
              if (previousSibling && previousSibling.parentElement === previousDropzone) {
                previousDropzone.insertBefore(card, previousSibling);
              } else {
                previousDropzone.append(card);
              }
            }
            if (previousColumn) updateColumnState(previousColumn);
            updateColumnState(column);
            const reason = String(error?.message || "");
            window.alert(
              reason === "forbidden"
                ? "Нет прав на изменение этапа."
                : reason === "lost_reason_required"
                ? "Укажите причину потери."
                : "Не удалось сохранить этап. Попробуйте ещё раз."
            );
          })
          .finally(() => {
            delete card.dataset.crmStageSaving;
            column.classList.remove("is-committing");
          });
      });
    });

    root.querySelectorAll(".crm-kanban-column").forEach(updateColumnState);
    if (searchInput) {
      searchInput.addEventListener("input", applySearch);
      applySearch();
    }
    if (archiveSearch) {
      archiveSearch.addEventListener("input", applyArchiveSearch);
      applyArchiveSearch();
    }
  }

  function initDialog() {
    const dialog = document.getElementById("crm-record-dialog");
    if (!dialog) return;
    const form = dialog.querySelector("form");
    const defaultAction = form?.getAttribute("action") || "/crm/save";
    const title = dialog.querySelector("#crm-record-dialog-title");
    const subtitle = dialog.querySelector(".settings-profile-modal-sub");
    const submit = dialog.querySelector('.crm-record-form-actions button[type="submit"]');
    const clientInput = form?.querySelector('input[name="client"]');
    const responsibleInput = form?.querySelector('input[name="responsible"]');
    const dealSelect = form?.querySelector("[data-crm-deal-select]");
    const dealInput = form?.querySelector("[data-crm-deal-input]");
    const orderSelect = form?.querySelector("[data-crm-order-select]");
    const orderInput = form?.querySelector("[data-crm-order-input]");
    const contactInput = form?.querySelector('input[name="contact"]');
    const duplicateNote = dialog.querySelector("[data-crm-client-duplicate]");
    const contactMatchNote = dialog.querySelector("[data-crm-contact-match]");
    const clientPanel = dialog.querySelector("[data-crm-client-panel]");
    const responsiblePanel = dialog.querySelector("[data-crm-responsible-panel]");
    const dealPanel = dialog.querySelector("[data-crm-deal-panel]");
    const orderPanel = dialog.querySelector("[data-crm-order-panel]");
    const clientCreateDialog = document.querySelector("#crm-client-create-dialog");
    const clientCreateForm = clientCreateDialog?.querySelector("[data-crm-client-create-form]");
    const clientCreateStatus = clientCreateDialog?.querySelector("[data-crm-client-create-status]");
    const taskTypeSelect = form?.querySelector("[data-crm-task-type-select]");
    const taskChecklist = form?.querySelector("[data-crm-task-checklist]");
    const clientRows = Array.from(document.querySelectorAll("#crm-client-list option"))
      .map((option) => ({
        name: String(option.value || "").trim(),
        meta: String(option.textContent || "").trim(),
      }))
      .filter((item) => item.name);
    const responsibleRows = Array.from(document.querySelectorAll("#crm-responsible-list option"))
      .map((option) => String(option.value || option.textContent || "").trim())
      .filter(Boolean)
      .filter((value, index, list) => list.findIndex((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
      .sort((a, b) => a.localeCompare(b, "ru"));
    const dealRows = Array.from(dealSelect?.options || [])
      .map((option) => ({
        id: String(option.value || "").trim(),
        label: String(option.textContent || "").trim(),
        title: String(option.dataset.title || option.textContent || "").trim(),
        client: String(option.dataset.client || "").trim(),
        amount: String(option.dataset.amount || "").trim(),
      }))
      .filter((item) => item.id);
    const orderRows = Array.from(orderSelect?.options || [])
      .map((option) => ({
        id: String(option.value || "").trim(),
        label: String(option.textContent || "").trim(),
        number: String(option.dataset.number || "").trim(),
        client: String(option.dataset.client || "").trim(),
        amount: String(option.dataset.amount || "").trim(),
        currency: String(option.dataset.currency || "").trim(),
        date: String(option.dataset.date || "").trim(),
      }))
      .filter((item) => item.id);
    const existingClients = new Set(clientRows.map((item) => item.name.toLocaleLowerCase()));
    const normalizePhone = (value) => {
      const digits = String(value || "").replace(/\D+/g, "");
      if (digits.length < 7) return "";
      return digits.length >= 9 ? digits.slice(-9) : digits;
    };
    const clientsByPhone = new Map(
      Array.from(document.querySelectorAll("#crm-contact-list option"))
        .map((option) => [
          normalizePhone(option.value),
          {
            name: String(option.dataset.clientName || option.textContent || "").trim(),
            phone: String(option.value || "").trim(),
          },
        ])
        .filter(([phone, client]) => phone && client.name),
    );

    const syncDuplicateNotice = () => {
      if (!duplicateNote || !clientInput) return;
      duplicateNote.hidden = !existingClients.has(String(clientInput.value || "").trim().toLocaleLowerCase());
    };

    const positionClientPanel = () => {
      if (!clientInput || !clientPanel || clientPanel.hidden) return;
      const rect = clientInput.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
      clientPanel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      clientPanel.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 96)}px`;
      clientPanel.style.width = `${width}px`;
    };

    const closeClientPanel = () => {
      if (!clientPanel) return;
      clientPanel.hidden = true;
      clientPanel.innerHTML = "";
    };

    const closeClientCreateDialog = () => {
      if (!clientCreateDialog) return;
      if (clientCreateDialog.open && typeof clientCreateDialog.close === "function") {
        clientCreateDialog.close();
      } else {
        clientCreateDialog.removeAttribute("open");
      }
    };

    const openClientCreateDialog = () => {
      if (!clientCreateDialog || !clientCreateForm) return;
      const suggestedName = String(clientInput?.value || "").trim();
      clientCreateForm.reset();
      const nameInput = clientCreateForm.querySelector("[data-crm-client-create-name]");
      if (nameInput) nameInput.value = suggestedName;
      if (clientCreateStatus) {
        clientCreateStatus.textContent = "";
        clientCreateStatus.dataset.status = "";
      }
      closeClientPanel();
      if (typeof clientCreateDialog.showModal === "function") {
        clientCreateDialog.showModal();
      } else {
        clientCreateDialog.setAttribute("open", "");
      }
      setTimeout(() => {
        nameInput?.focus();
        nameInput?.select();
      }, 0);
    };

    const renderClientPanel = () => {
      if (!clientInput || !clientPanel) return;
      const query = String(clientInput.value || "").trim().toLocaleLowerCase();
      const rows = clientRows
        .filter((item) => {
          const hay = `${item.name} ${item.meta}`.toLocaleLowerCase();
          return !query || hay.includes(query);
        })
        .slice(0, 80);
      clientPanel.innerHTML =
        '<button type="button" class="sales-combo-option crm-client-create-option" data-crm-client-create-open>' +
        '<span class="sales-combo-main">+ Добавить клиента</span>' +
        '<span class="sales-combo-meta"><span>Создать новую карточку</span><strong></strong></span>' +
        "</button>" +
        (rows.length
        ? rows
            .map((item) => {
              const meta = item.meta && item.meta !== item.name ? item.meta : "Клиент";
              return (
                '<button type="button" class="sales-combo-option" data-crm-client-choice>' +
                `<span class="sales-combo-main">${escapeHtml(item.name)}</span>` +
                `<span class="sales-combo-meta"><span>${escapeHtml(meta)}</span><strong></strong></span>` +
                "</button>"
              );
            })
            .join("")
        : '<div class="sales-combo-empty">Ничего не найдено</div>');
      clientPanel.hidden = false;
      positionClientPanel();
      const createButton = clientPanel.querySelector("[data-crm-client-create-open]");
      createButton?.addEventListener("mousedown", (event) => event.preventDefault());
      createButton?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openClientCreateDialog();
      });
      clientPanel.querySelectorAll("[data-crm-client-choice]").forEach((button, index) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          clientInput.value = rows[index]?.name || "";
          clientInput.dispatchEvent(new Event("input", { bubbles: true }));
          clientInput.dispatchEvent(new Event("change", { bubbles: true }));
          closeClientPanel();
        });
      });
    };

    const positionResponsiblePanel = () => {
      if (!responsibleInput || !responsiblePanel || responsiblePanel.hidden) return;
      const rect = responsibleInput.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
      responsiblePanel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      responsiblePanel.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 96)}px`;
      responsiblePanel.style.width = `${width}px`;
    };

    const closeResponsiblePanel = () => {
      if (!responsiblePanel) return;
      responsiblePanel.hidden = true;
      responsiblePanel.innerHTML = "";
    };

    const renderResponsiblePanel = () => {
      if (!responsibleInput || !responsiblePanel) return;
      const query = String(responsibleInput.value || "").trim().toLocaleLowerCase();
      const rows = responsibleRows
        .filter((name) => !query || name.toLocaleLowerCase().includes(query))
        .slice(0, 80);
      responsiblePanel.innerHTML = rows.length
        ? rows
            .map((name) => (
              '<button type="button" class="sales-combo-option" data-crm-responsible-choice>' +
              `<span class="sales-combo-main">${escapeHtml(name)}</span>` +
              '<span class="sales-combo-meta"><span>Ответственный</span><strong></strong></span>' +
              "</button>"
            ))
            .join("")
        : '<div class="sales-combo-empty">Ничего не найдено</div>';
      responsiblePanel.hidden = false;
      positionResponsiblePanel();
      responsiblePanel.querySelectorAll("[data-crm-responsible-choice]").forEach((button, index) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          responsibleInput.value = rows[index] || "";
          responsibleInput.dispatchEvent(new Event("input", { bubbles: true }));
          responsibleInput.dispatchEvent(new Event("change", { bubbles: true }));
          closeResponsiblePanel();
        });
      });
    };

    const positionDealPanel = () => {
      if (!dealInput || !dealPanel || dealPanel.hidden) return;
      const rect = dealInput.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
      dealPanel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      dealPanel.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 96)}px`;
      dealPanel.style.width = `${width}px`;
    };

    const closeDealPanel = () => {
      if (!dealPanel) return;
      dealPanel.hidden = true;
      dealPanel.innerHTML = "";
    };

    const syncDealDisplay = () => {
      if (!dealInput || !dealSelect) return;
      const selected = dealRows.find((item) => item.id === String(dealSelect.value || ""));
      dealInput.value = selected ? [selected.title, selected.client].filter(Boolean).join(" · ") : "";
    };

    const chooseDeal = (item) => {
      if (!dealSelect || !dealInput) return;
      dealSelect.value = item?.id || "";
      dealInput.value = item ? [item.title, item.client].filter(Boolean).join(" · ") : "";
      dealSelect.dispatchEvent(new Event("change", { bubbles: true }));
      closeDealPanel();
    };

    const applyTaskTypeChecklist = (force) => {
      if (!taskTypeSelect || !taskChecklist) return;
      const selected = taskTypeSelect.selectedOptions?.[0];
      const checklist = String(selected?.dataset.checklist || "");
      const canReplace = force || !taskChecklist.value.trim() || taskChecklist.dataset.crmTaskAutofilled === "1";
      if (!canReplace) return;
      taskChecklist.value = checklist;
      if (checklist) {
        taskChecklist.dataset.crmTaskAutofilled = "1";
      } else {
        delete taskChecklist.dataset.crmTaskAutofilled;
      }
      taskChecklist.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const renderDealPanel = () => {
      if (!dealInput || !dealPanel) return;
      const query = String(dealInput.value || "").trim().toLocaleLowerCase();
      const rows = dealRows
        .filter((item) => {
          const hay = `${item.title} ${item.client} ${item.amount} ${item.id} ${item.label}`.toLocaleLowerCase();
          return !query || hay.includes(query);
        })
        .slice(0, 80);
      dealPanel.innerHTML =
        '<button type="button" class="sales-combo-option" data-crm-deal-choice data-deal-index="-1">' +
        '<span class="sales-combo-main">Не выбрано</span>' +
        '<span class="sales-combo-meta"><span>Без привязки</span><strong></strong></span>' +
        "</button>" +
        (rows.length
          ? rows
              .map((item, index) => {
                const title = item.title || item.label;
                const meta = item.client || "Клиент не указан";
                const amount = item.amount || "0";
                return (
                  `<button type="button" class="sales-combo-option" data-crm-deal-choice data-deal-index="${index}">` +
                  `<span class="sales-combo-main">${escapeHtml(title)}</span>` +
                  `<span class="sales-combo-meta"><span>${escapeHtml(meta)}</span><strong>Отгрузка: ${escapeHtml(amount)}</strong></span>` +
                  "</button>"
                );
              })
              .join("")
          : '<div class="sales-combo-empty">Ничего не найдено</div>');
      dealPanel.hidden = false;
      positionDealPanel();
      dealPanel.querySelectorAll("[data-crm-deal-choice]").forEach((button) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          const index = Number.parseInt(button.dataset.dealIndex || "-1", 10);
          chooseDeal(index >= 0 ? rows[index] : null);
        });
      });
    };

    const positionOrderPanel = () => {
      if (!orderInput || !orderPanel || orderPanel.hidden) return;
      const rect = orderInput.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 24);
      orderPanel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      orderPanel.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 96)}px`;
      orderPanel.style.width = `${width}px`;
    };

    const closeOrderPanel = () => {
      if (!orderPanel) return;
      orderPanel.hidden = true;
      orderPanel.innerHTML = "";
    };

    const syncOrderDisplay = () => {
      if (!orderInput || !orderSelect) return;
      const selected = orderRows.find((item) => item.id === String(orderSelect.value || ""));
      orderInput.value = selected ? [`№ ${selected.number}`, selected.client].filter(Boolean).join(" · ") : "";
    };

    const chooseOrder = (item) => {
      if (!orderSelect || !orderInput) return;
      orderSelect.value = item?.id || "";
      syncOrderDisplay();
      orderSelect.dispatchEvent(new Event("change", { bubbles: true }));
      if (item?.client && clientInput) {
        clientInput.value = item.client;
        clientInput.dispatchEvent(new Event("input", { bubbles: true }));
        clientInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      closeOrderPanel();
    };

    const renderOrderPanel = () => {
      if (!orderInput || !orderPanel) return;
      const query = String(orderInput.value || "").trim().toLocaleLowerCase();
      const rows = orderRows
        .filter((item) => {
          const hay = `${item.number} ${item.client} ${item.amount} ${item.currency} ${item.date}`.toLocaleLowerCase();
          return !query || hay.includes(query);
        })
        .slice(0, 80);
      orderPanel.innerHTML =
        '<button type="button" class="sales-combo-option" data-crm-order-choice data-order-index="-1">' +
        '<span class="sales-combo-main">Не выбрано</span>' +
        '<span class="sales-combo-meta"><span>Без привязки к заказу</span><strong></strong></span>' +
        "</button>" +
        (rows.length
          ? rows
              .map((item, index) => (
                `<button type="button" class="sales-combo-option" data-crm-order-choice data-order-index="${index}">` +
                `<span class="sales-combo-main">№ ${escapeHtml(item.number)}</span>` +
                `<span class="sales-combo-meta"><span>${escapeHtml(item.client || "Клиент не указан")}</span>` +
                `<strong>${escapeHtml([item.amount, item.currency, item.date].filter(Boolean).join(" · "))}</strong></span>` +
                "</button>"
              ))
              .join("")
          : '<div class="sales-combo-empty">Заказы не найдены</div>');
      orderPanel.hidden = false;
      positionOrderPanel();
      orderPanel.querySelectorAll("[data-crm-order-choice]").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const index = Number.parseInt(button.dataset.orderIndex || "-1", 10);
          chooseOrder(index >= 0 ? rows[index] : null);
        });
      });
    };

    const syncContactMatch = () => {
      if (!contactInput || !contactMatchNote || !clientInput) return;
      const match = clientsByPhone.get(normalizePhone(contactInput.value));
      const previousMatch = String(clientInput.dataset.crmContactMatch || "");
      if (!match) {
        contactMatchNote.hidden = true;
        contactMatchNote.textContent = "";
        if (previousMatch && clientInput.value === previousMatch) clientInput.value = "";
        delete clientInput.dataset.crmContactMatch;
        syncDuplicateNotice();
        return;
      }
      clientInput.value = match.name;
      clientInput.dataset.crmContactMatch = match.name;
      contactMatchNote.textContent = `Номер уже есть: ${match.name}. Сделка будет привязана к этому клиенту.`;
      contactMatchNote.hidden = false;
      syncDuplicateNotice();
    };

    const syncConditionalFields = () => {
      if (!form) return;
      const kind = form.querySelector('input[name="item_type"]:checked')?.value || "deal";
      const isCompactDeal = form.classList.contains("is-compact-deal-create");
      const status = form.querySelector('select[name="status"]')?.value || "new";
      const stage = form.querySelector('select[name="stage_id"]');
      const stageText = String(stage?.selectedOptions?.[0]?.textContent || "").toLocaleLowerCase();
      const isLost = status === "lost" || stage?.value === "lost" || stageText.includes("потер");
      const isOpenWork = kind !== "history" && !isLost && !["done", "won", "lost", "archived"].includes(status);
      const nextStep = form.querySelector('input[name="next_step"]');
      const dueDate = form.querySelector('input[name="due_date"]');
      const lostBoxes = Array.from(form.querySelectorAll('[name="lost_reasons"]'));
      const lostCustom = form.querySelector('[name="lost_reason_custom"]');
      const lostField = form.querySelector("[data-crm-lost-reason-field]");
      if (nextStep) nextStep.required = !isCompactDeal && isOpenWork;
      if (dueDate) dueDate.required = !isCompactDeal && isOpenWork;
      // Причин может быть несколько: required вешаем на поле «своя причина»
      // и только пока ни одна галочка не отмечена — иначе браузер требовал бы
      // заполнить его даже при выбранной причине из списка.
      if (lostCustom) lostCustom.required = !isCompactDeal && isLost && !lostBoxes.some((box) => box.checked);
      if (lostField) lostField.hidden = !isLost;
    };

    const setKind = (kind) => {
      if (!kind) return;
      const input = dialog.querySelector(`input[name="item_type"][value="${CSS.escape(kind)}"]`);
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };

    const setField = (name, value) => {
      if (!form || value == null) return;
      const fields = Array.from(form.querySelectorAll(`[name="${CSS.escape(name)}"]`));
      if (!fields.length) return;
      if (fields[0].type === "radio") {
        fields.forEach((field) => {
          field.checked = field.value === String(value);
          field.dispatchEvent(new Event("change", { bubbles: true }));
        });
        return;
      }
      const field = fields[0];
      field.value = value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const syncFormPresentation = (mode, kind) => {
      if (!form) return;
      const isCompactDeal = mode === "create" && kind === "deal";
      const isTaskMode = kind === "task";
      form.classList.toggle("is-compact-deal-create", isCompactDeal);
      form.classList.toggle("is-task-mode", isTaskMode);
      form.querySelectorAll("[data-crm-task-hidden]").forEach((field) => {
        field.hidden = isTaskMode;
      });
      form.querySelectorAll("[data-crm-task-only]").forEach((field) => {
        field.hidden = !isTaskMode;
      });
      if (contactInput) contactInput.required = isCompactDeal;
      if (isCompactDeal) {
        if (title) title.textContent = "Новая сделка";
        if (subtitle) subtitle.textContent = "Основные данные сделки";
        if (submit) submit.textContent = "Создать сделку";
        const nextStep = form.querySelector('input[name="next_step"]');
        if (nextStep && !nextStep.value) setField("next_step", "Связаться с клиентом");
      } else if (isTaskMode) {
        if (title) title.textContent = mode === "edit" ? "Редактировать задачу" : "Новая задача";
        if (subtitle) subtitle.textContent = "Клиент, ответственный, срок и следующий шаг";
        if (submit) submit.textContent = mode === "edit" ? "Сохранить задачу" : "Создать задачу";
        const titleInput = form.querySelector('input[name="title"]');
        if (titleInput) titleInput.placeholder = "Название задачи";
        applyTaskTypeChecklist(false);
      }
      syncConditionalFields();
    };

    const resetDialog = () => {
      if (!form) return;
      form.reset();
      form.dataset.crmDialogMode = "create";
      form.classList.remove("is-compact-deal-create", "is-task-mode");
      form.setAttribute("action", defaultAction);
      setField("record_id", "");
      if (taskChecklist) delete taskChecklist.dataset.crmTaskAutofilled;
      syncDealDisplay();
      syncOrderDisplay();
      if (title) title.textContent = "Новая запись";
      if (subtitle) subtitle.textContent = "Сделка, задача или история контакта";
      if (submit) submit.textContent = "Сохранить запись";
      syncConditionalFields();
      syncDuplicateNotice();
      syncContactMatch();
    };

    const fillPayload = (payload) => {
      if (!payload || typeof payload !== "object") return;
      Object.entries(payload).forEach(([name, value]) => {
        if (name === "id") {
          setField("record_id", value || "");
        } else if (name === "amount_input") {
          setField("amount", value || "");
        } else {
          setField(name, value || "");
        }
      });
    };

    const parsePayload = (raw) => {
      try {
        return JSON.parse(raw || "{}");
      } catch {
        return {};
      }
    };

    const openDialog = (kind, payload = null, mode = "create") => {
      resetDialog();
      form.dataset.crmDialogMode = mode;
      setKind(kind);
      if (payload) fillPayload(payload);
      if (mode === "edit" && payload?.id && form) {
        form.setAttribute("action", `/crm/${encodeURIComponent(payload.id)}/update`);
        if (title) title.textContent = "Редактировать CRM";
        if (subtitle) subtitle.textContent = "Карточка клиента, этап, следующий шаг и история";
        if (submit) submit.textContent = "Сохранить изменения";
      }
      syncFormPresentation(mode, kind);
      syncDuplicateNotice();
      syncContactMatch();
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      const firstField = dialog.querySelector('input[name="title"]');
      if (firstField) firstField.focus();
    };
    const closeDialog = () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    };

    document.querySelectorAll("[data-crm-open-dialog]").forEach((button) => {
      button.addEventListener("click", () => openDialog(button.dataset.crmKind || "deal"));
    });
    document.querySelectorAll("[data-crm-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const payload = parsePayload(button.getAttribute("data-crm-edit"));
        openDialog(payload.item_type || "deal", payload, "edit");
      });
    });
    form?.querySelectorAll('input[name="item_type"]').forEach((field) => {
      field.addEventListener("change", () => {
        const kind = form.querySelector('input[name="item_type"]:checked')?.value || "deal";
        syncFormPresentation(form.dataset.crmDialogMode || "create", kind);
      });
    });
    form?.querySelectorAll('select[name="status"], select[name="stage_id"], [name="lost_reasons"]').forEach((field) => {
      field.addEventListener("change", syncConditionalFields);
    });
    clientInput?.addEventListener("input", () => {
      syncDuplicateNotice();
      renderClientPanel();
    });
    clientInput?.addEventListener("focus", renderClientPanel);
    clientInput?.addEventListener("click", renderClientPanel);
    responsibleInput?.addEventListener("input", renderResponsiblePanel);
    responsibleInput?.addEventListener("focus", renderResponsiblePanel);
    responsibleInput?.addEventListener("click", renderResponsiblePanel);
    dealInput?.addEventListener("input", () => {
      if (dealSelect) dealSelect.value = "";
      renderDealPanel();
    });
    dealInput?.addEventListener("focus", renderDealPanel);
    dealInput?.addEventListener("click", renderDealPanel);
    dealSelect?.addEventListener("change", syncDealDisplay);
    orderInput?.addEventListener("input", () => {
      if (orderSelect) orderSelect.value = "";
      renderOrderPanel();
    });
    orderInput?.addEventListener("focus", renderOrderPanel);
    orderInput?.addEventListener("click", renderOrderPanel);
    orderSelect?.addEventListener("change", syncOrderDisplay);
    taskTypeSelect?.addEventListener("change", () => applyTaskTypeChecklist(true));
    taskChecklist?.addEventListener("input", () => {
      if (document.activeElement === taskChecklist) delete taskChecklist.dataset.crmTaskAutofilled;
    });
    window.addEventListener("resize", positionClientPanel);
    window.addEventListener("resize", positionResponsiblePanel);
    window.addEventListener("resize", positionDealPanel);
    window.addEventListener("resize", positionOrderPanel);
    window.addEventListener("scroll", positionClientPanel, true);
    window.addEventListener("scroll", positionResponsiblePanel, true);
    window.addEventListener("scroll", positionDealPanel, true);
    window.addEventListener("scroll", positionOrderPanel, true);
    document.addEventListener("mousedown", (event) => {
      if (!clientPanel || !clientInput) return;
      if (event.target === clientInput || clientPanel.contains(event.target)) return;
      closeClientPanel();
    });
    document.addEventListener("mousedown", (event) => {
      if (!responsiblePanel || !responsibleInput) return;
      if (event.target === responsibleInput || responsiblePanel.contains(event.target)) return;
      closeResponsiblePanel();
    });
    document.addEventListener("mousedown", (event) => {
      if (!dealPanel || !dealInput) return;
      if (event.target === dealInput || dealPanel.contains(event.target)) return;
      closeDealPanel();
    });
    document.addEventListener("mousedown", (event) => {
      if (!orderPanel || !orderInput) return;
      if (event.target === orderInput || orderPanel.contains(event.target)) return;
      closeOrderPanel();
    });
    contactInput?.addEventListener("input", syncContactMatch);
    clientCreateDialog?.querySelectorAll("[data-crm-client-create-close]").forEach((button) => {
      button.addEventListener("click", closeClientCreateDialog);
    });
    clientCreateDialog?.addEventListener("click", (event) => {
      if (event.target === clientCreateDialog) closeClientCreateDialog();
    });
    clientCreateForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!clientCreateForm.checkValidity()) {
        clientCreateForm.reportValidity();
        return;
      }
      const submitButton = clientCreateForm.querySelector("[data-crm-client-create-submit]");
      if (submitButton) submitButton.disabled = true;
      if (clientCreateStatus) {
        clientCreateStatus.textContent = "Сохраняю...";
        clientCreateStatus.dataset.status = "";
      }
      fetch("/clients/save", {
        method: "POST",
        body: new FormData(clientCreateForm),
        headers: { Accept: "application/json" },
      })
        .then((response) => response.json().catch(() => ({})).then((body) => {
          if (!response.ok || !body.client) throw new Error(body.error || "Не удалось сохранить клиента");
          return body.client;
        }))
        .then((client) => {
          const name = String(client.name || "").trim();
          const phone = String(client.phone || "").trim();
          if (name && !clientRows.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            clientRows.push({ name, meta: phone || "Клиент" });
            clientRows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
          }
          if (name) existingClients.add(name.toLocaleLowerCase());
          const phoneKey = normalizePhone(phone);
          if (phoneKey && name) clientsByPhone.set(phoneKey, { name, phone });
          if (clientInput) {
            clientInput.value = name;
            clientInput.dispatchEvent(new Event("change", { bubbles: true }));
          }
          syncDuplicateNotice();
          closeClientCreateDialog();
          clientInput?.focus();
        })
        .catch((error) => {
          if (clientCreateStatus) {
            clientCreateStatus.textContent = error.message || "Не удалось сохранить клиента";
            clientCreateStatus.dataset.status = "err";
          }
        })
        .finally(() => {
          if (submitButton) submitButton.disabled = false;
        });
    });
    document.addEventListener("crm:edit-record", (event) => {
      const payload = parsePayload(event.detail?.payload);
      if (!payload?.id) return;
      openDialog(payload.item_type || "deal", payload, "edit");
    });
    document.addEventListener("crm:create-task", (event) => {
      const dueDate = String(event.detail?.dueDate || new Date().toISOString().slice(0, 10));
      openDialog("task", {
        item_type: "task",
        date: dueDate,
        due_date: dueDate,
        status: "planned",
        priority: "normal",
        currency: "UZS",
      }, "create");
    });
    document.querySelectorAll("[data-crm-followup]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.crmFollowup || "task";
        const base = parsePayload(button.getAttribute("data-crm-base"));
        const isHistory = kind === "history";
        const payload = {
          item_type: kind,
          title: isHistory ? `Контакт: ${base.client || base.title || ""}` : `Следующий шаг: ${base.client || base.title || ""}`,
          client: base.client || "",
          responsible: base.responsible || "",
          lead_source: base.lead_source || "",
          stage_id: base.stage_id || "",
          related_deal_id: base.item_type === "deal" ? base.id || "" : base.related_deal_id || "",
          service_type: base.service_type || "",
          priority: isHistory ? "normal" : base.priority || "normal",
          contact_type: isHistory ? "Звонок" : "",
          chat_ref: base.chat_ref || "",
          date: new Date().toISOString().slice(0, 10),
          due_date: new Date().toISOString().slice(0, 10),
          status: isHistory ? "done" : "planned",
          currency: base.currency || "UZS",
          next_step: isHistory ? base.next_step || "" : "",
          note: isHistory ? base.next_step || "" : "",
        };
        openDialog(kind, payload, "create");
      });
    });
    dialog.querySelectorAll("[data-crm-close-dialog]").forEach((button) => {
      button.addEventListener("click", closeDialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });

    const setSelectByValueOrText = (name, value, textNeedle) => {
      if (!form) return;
      const select = form.querySelector(`select[name="${CSS.escape(name)}"]`);
      if (!select) {
        setField(name, value);
        return;
      }
      const normalizedValue = String(value || "").toLowerCase();
      const normalizedText = String(textNeedle || value || "").toLowerCase();
      const match = Array.from(select.options).find((option) => {
        return (
          String(option.value || "").toLowerCase() === normalizedValue ||
          String(option.textContent || "").toLowerCase().includes(normalizedText)
        );
      });
      if (match) {
        select.value = match.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };

    const openFromQuery = () => {
      const params = new URLSearchParams(window.location.search || "");
      const requestedKind = String(params.get("crm_open") || "");
      if (!["deal", "task", "history"].includes(requestedKind)) return;
      if (requestedKind !== "deal") {
        openDialog(requestedKind, {
          item_type: requestedKind,
          date: new Date().toISOString().slice(0, 10),
          due_date: new Date().toISOString().slice(0, 10),
          status: requestedKind === "history" ? "done" : "planned",
          priority: "normal",
          currency: "UZS",
        }, "create");
        return;
      }
      resetDialog();
      setKind("deal");
      setField("title", params.get("crm_title") || "Сделка из мессенджера");
      setField("client", params.get("crm_client") || "");
      setField("contact_type", params.get("crm_contact_type") || "Чат Telegram");
      setField("chat_ref", params.get("crm_chat_ref") || "");
      setField("note", params.get("crm_note") || "Создано из диалога мессенджера");
      setSelectByValueOrText("lead_source", params.get("crm_source") || "Telegram", params.get("crm_source") || "Telegram");
      setSelectByValueOrText("stage_id", params.get("crm_stage") || "leads", "лид");
      setSelectByValueOrText("status", params.get("crm_status") || "new", "нов");
      syncFormPresentation("create", "deal");
      syncContactMatch();
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      const firstField = dialog.querySelector('input[name="title"]');
      if (firstField) firstField.focus();
    };

    openFromQuery();
  }

  function initTaskWorkspace() {
    const workspace = document.querySelector("[data-crm-task-workspace]");
    if (!workspace) return;

    const rows = Array.from(workspace.querySelectorAll("[data-crm-task-row]"));
    const filters = Object.fromEntries(
      Array.from(workspace.querySelectorAll("[data-crm-task-filter]")).map((control) => [
        control.dataset.crmTaskFilter,
        control,
      ]),
    );
    const panes = Object.fromEntries(
      Array.from(workspace.querySelectorAll("[data-crm-task-pane]")).map((pane) => [
        pane.dataset.crmTaskPane,
        pane,
      ]),
    );
    const viewButtons = Array.from(workspace.querySelectorAll("[data-crm-task-view]"));
    const empty = workspace.querySelector("[data-crm-task-empty]");
    const serverEmpty = workspace.querySelector("[data-crm-task-server-empty]");
    const calendar = workspace.querySelector("[data-crm-task-calendar]");
    const calendarTitle = workspace.querySelector("[data-crm-calendar-title]");
    const dayDialog = document.querySelector("#crm-task-day-dialog");
    const dayDialogTitle = dayDialog?.querySelector("[data-crm-task-day-title]");
    const dayDialogSubtitle = dayDialog?.querySelector("[data-crm-task-day-subtitle]");
    const dayDialogList = dayDialog?.querySelector("[data-crm-task-day-list]");
    const dayDialogAdd = dayDialog?.querySelector("[data-crm-task-day-add]");
    const taskInfoDialog = document.querySelector("#crm-task-info-dialog");
    const taskInfoTitle = taskInfoDialog?.querySelector("[data-crm-task-info-title]");
    const taskInfoSubtitle = taskInfoDialog?.querySelector("[data-crm-task-info-subtitle]");
    const taskInfoChecklistWrap = taskInfoDialog?.querySelector("[data-crm-task-info-checklist-wrap]");
    const taskInfoChecklist = taskInfoDialog?.querySelector("[data-crm-task-info-checklist]");
    const taskInfoEdit = taskInfoDialog?.querySelector("[data-crm-task-info-edit]");
    let activeTaskRow = null;
    let currentView = "list";
    let calendarMonth = new Date();
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);

    const normalize = (value) => String(value || "").trim().toLocaleLowerCase("ru");
    const isoDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const filteredRows = () => {
      const search = normalize(filters.search?.value);
      const responsible = filters.responsible?.value || "";
      const status = filters.status?.value || "";
      const priority = filters.priority?.value || "";
      const date = filters.date?.value || "";

      return rows.filter((row) => {
        const isComplete = row.dataset.taskComplete === "true";
        const matchesSearch =
          !search ||
          normalize(row.dataset.taskTitle).includes(search) ||
          normalize(row.dataset.taskClient).includes(search) ||
          normalize(row.dataset.taskOrder).includes(search);
        const matchesResponsible = !responsible || row.dataset.taskResponsible === responsible;
        const matchesPriority = !priority || row.dataset.taskPriority === priority;
        const matchesDate = !date || row.dataset.taskDueDate === date;
        let matchesStatus = true;
        if (status === "open") matchesStatus = !isComplete;
        if (status === "done") matchesStatus = isComplete;
        if (status === "overdue" || status === "today") {
          matchesStatus = !isComplete && row.dataset.taskActionState === status;
        }
        return matchesSearch && matchesResponsible && matchesPriority && matchesDate && matchesStatus;
      });
    };

    const openTask = (row) => {
      row.querySelector("[data-crm-edit]")?.click();
    };

    const taskEditPayload = (row) => {
      try {
        return JSON.parse(row.querySelector("[data-crm-edit]")?.getAttribute("data-crm-edit") || "{}");
      } catch {
        return {};
      }
    };

    const closeTaskInfoDialog = () => {
      if (!taskInfoDialog) return;
      if (taskInfoDialog.open && typeof taskInfoDialog.close === "function") {
        taskInfoDialog.close();
      } else {
        taskInfoDialog.removeAttribute("open");
      }
    };

    const openTaskInfoDialog = (row) => {
      if (!taskInfoDialog || !row) return;
      activeTaskRow = row;
      const payload = taskEditPayload(row);
      if (taskInfoTitle) taskInfoTitle.textContent = row.dataset.taskTitle || payload.title || "Задача";
      if (taskInfoSubtitle) {
        taskInfoSubtitle.textContent = [row.dataset.taskClient, row.dataset.taskResponsible]
          .filter(Boolean)
          .join(" · ") || "Информация о задаче";
      }
      const values = {
        client: row.dataset.taskClient || payload.client,
        order: row.dataset.taskOrder ? `№ ${row.dataset.taskOrder}` : "",
        responsible: row.dataset.taskResponsible || payload.responsible,
        taskType: payload.task_type,
        priority: row.querySelector(".crm-task-priority")?.textContent?.trim() || payload.priority,
        status: row.querySelector(".crm-task-state")?.textContent?.trim() || payload.status,
        date: payload.date,
        dueDate: row.dataset.taskDueDate || payload.due_date,
        nextStep: payload.next_step,
        note: payload.note,
      };
      Object.entries(values).forEach(([name, value]) => {
        const field = taskInfoDialog.querySelector(`[data-crm-task-info-field="${name}"]`);
        if (field) field.textContent = String(value || "—");
      });
      const checklist = String(payload.checklist || "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (taskInfoChecklist && taskInfoChecklistWrap) {
        taskInfoChecklist.replaceChildren();
        checklist.forEach((text) => {
          const item = document.createElement("li");
          item.textContent = text;
          taskInfoChecklist.append(item);
        });
        taskInfoChecklistWrap.hidden = checklist.length === 0;
      }
      if (typeof taskInfoDialog.showModal === "function") {
        taskInfoDialog.showModal();
      } else {
        taskInfoDialog.setAttribute("open", "");
      }
    };

    const closeDayDialog = () => {
      if (!dayDialog) return;
      if (dayDialog.open && typeof dayDialog.close === "function") {
        dayDialog.close();
      } else {
        dayDialog.removeAttribute("open");
      }
    };

    const openDayDialog = (dateKey, dayTasks) => {
      if (!dayDialog || !dayDialogList) return;
      const selectedDate = new Date(`${dateKey}T00:00:00`);
      if (dayDialogTitle) {
        dayDialogTitle.textContent = new Intl.DateTimeFormat("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(selectedDate);
      }
      if (dayDialogSubtitle) dayDialogSubtitle.textContent = `Задач: ${dayTasks.length}`;
      if (dayDialogAdd) dayDialogAdd.dataset.dueDate = dateKey;
      dayDialogList.replaceChildren();
      if (!dayTasks.length) {
        const emptyState = document.createElement("p");
        emptyState.className = "crm-task-day-empty";
        emptyState.textContent = "На этот день задач пока нет.";
        dayDialogList.append(emptyState);
      } else {
        dayTasks.forEach((row) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "crm-task-day-item";
          if (row.dataset.taskComplete === "true") item.classList.add("is-complete");
          if (row.dataset.taskActionState === "overdue") item.classList.add("is-overdue");

          const main = document.createElement("span");
          main.className = "crm-task-day-item-main";
          const taskTitle = document.createElement("strong");
          taskTitle.textContent = row.dataset.taskTitle || "Задача";
          const meta = document.createElement("small");
          meta.textContent = [
            row.dataset.taskClient,
            row.dataset.taskResponsible,
            row.dataset.taskOrder ? `Заказ № ${row.dataset.taskOrder}` : "",
          ].filter(Boolean).join(" · ") || "Без клиента и ответственного";
          main.append(taskTitle, meta);

          const state = document.createElement("span");
          state.className = "crm-task-day-item-state";
          state.textContent = row.querySelector(".crm-task-state")?.textContent?.trim() || "Открыта";
          item.append(main, state);
          item.addEventListener("click", () => {
            openTaskInfoDialog(row);
          });
          dayDialogList.append(item);
        });
      }
      if (typeof dayDialog.showModal === "function") {
        dayDialog.showModal();
      } else {
        dayDialog.setAttribute("open", "");
      }
    };

    const renderCalendar = (visibleRows) => {
      if (!calendar) return;
      calendar.replaceChildren();
      const year = calendarMonth.getFullYear();
      const month = calendarMonth.getMonth();
      if (calendarTitle) {
        calendarTitle.textContent = new Intl.DateTimeFormat("ru-RU", {
          month: "long",
          year: "numeric",
        }).format(calendarMonth);
      }
      const firstDay = new Date(year, month, 1);
      const mondayOffset = (firstDay.getDay() + 6) % 7;
      const gridStart = new Date(year, month, 1 - mondayOffset);
      const today = isoDate(new Date());
      const rowsByDate = new Map();
      visibleRows.forEach((row) => {
        const dueDate = row.dataset.taskDueDate;
        if (!dueDate) return;
        if (!rowsByDate.has(dueDate)) rowsByDate.set(dueDate, []);
        rowsByDate.get(dueDate).push(row);
      });

      for (let index = 0; index < 42; index += 1) {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + index);
        const dateKey = isoDate(date);
        const day = document.createElement("div");
        day.className = "crm-task-calendar-day";
        if (date.getMonth() !== month) day.classList.add("is-outside");
        if (dateKey === today) day.classList.add("is-today");
        if (date.getDay() === 0 || date.getDay() === 6) day.classList.add("is-weekend");
        day.dataset.date = dateKey;
        day.tabIndex = 0;
        day.title = `Открыть задачи на ${dateKey}`;

        const number = document.createElement("span");
        number.className = "crm-task-calendar-date";
        number.textContent = String(date.getDate());
        day.append(number);

        const dayTasks = rowsByDate.get(dateKey) || [];
        dayTasks.slice(0, 4).forEach((row) => {
          const task = document.createElement("button");
          task.type = "button";
          task.className = "crm-task-calendar-event";
          if (row.dataset.taskComplete === "true") task.classList.add("is-complete");
          if (row.dataset.taskActionState === "overdue") task.classList.add("is-overdue");
          task.textContent = row.dataset.taskTitle || "Задача";
          task.title = [row.dataset.taskTitle, row.dataset.taskResponsible]
            .filter(Boolean)
            .join(" · ");
          task.addEventListener("click", (event) => {
            event.stopPropagation();
            openDayDialog(dateKey, dayTasks);
          });
          day.append(task);
        });
        if (dayTasks.length > 4) {
          const more = document.createElement("small");
          more.className = "crm-task-calendar-more";
          more.textContent = `Ещё ${dayTasks.length - 4}`;
          day.append(more);
        }
        const showDayTasks = () => openDayDialog(dateKey, dayTasks);
        day.addEventListener("click", showDayTasks);
        day.addEventListener("keydown", (event) => {
          if (event.target !== day || !["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          showDayTasks();
        });
        calendar.append(day);
      }
    };

    const applyFilters = () => {
      const visibleRows = filteredRows();
      rows.forEach((row) => {
        row.hidden = !visibleRows.includes(row);
      });
      if (serverEmpty) serverEmpty.hidden = rows.length > 0;
      if (empty) empty.hidden = rows.length === 0 || visibleRows.length > 0 || currentView !== "list";
      renderCalendar(visibleRows);
    };

    const setView = (view) => {
      currentView = view === "calendar" ? "calendar" : "list";
      Object.entries(panes).forEach(([name, pane]) => {
        pane.hidden = name !== currentView;
      });
      viewButtons.forEach((button) => {
        const isActive = button.dataset.crmTaskView === currentView;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });
      applyFilters();
    };

    Object.values(filters).forEach((control) => {
      control.addEventListener(control.matches("input[type='search']") ? "input" : "change", () => {
        if (control === filters.date && control.value) {
          const selected = new Date(`${control.value}T00:00:00`);
          calendarMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
        }
        applyFilters();
      });
    });
    viewButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.crmTaskView));
    });
    workspace.querySelectorAll("[data-crm-calendar-step]").forEach((button) => {
      button.addEventListener("click", () => {
        calendarMonth = new Date(
          calendarMonth.getFullYear(),
          calendarMonth.getMonth() + Number(button.dataset.crmCalendarStep || 0),
          1,
        );
        applyFilters();
      });
    });
    workspace.querySelector("[data-crm-calendar-today]")?.addEventListener("click", () => {
      const today = new Date();
      calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      applyFilters();
    });
    dayDialog?.querySelectorAll("[data-crm-task-day-close]").forEach((button) => {
      button.addEventListener("click", closeDayDialog);
    });
    dayDialog?.addEventListener("click", (event) => {
      if (event.target === dayDialog) closeDayDialog();
    });
    dayDialogAdd?.addEventListener("click", () => {
      const dueDate = String(dayDialogAdd.dataset.dueDate || isoDate(new Date()));
      closeDayDialog();
      document.dispatchEvent(new CustomEvent("crm:create-task", { detail: { dueDate } }));
    });
    taskInfoDialog?.querySelectorAll("[data-crm-task-info-close]").forEach((button) => {
      button.addEventListener("click", closeTaskInfoDialog);
    });
    taskInfoDialog?.addEventListener("click", (event) => {
      if (event.target === taskInfoDialog) closeTaskInfoDialog();
    });
    taskInfoEdit?.addEventListener("click", () => {
      const row = activeTaskRow;
      closeTaskInfoDialog();
      closeDayDialog();
      if (row) openTask(row);
    });

    setView("list");
  }

  function init() {
    initSearchDropdowns();
    document.querySelectorAll("[data-crm-kanban]").forEach(initKanban);
    initDialog();
    initCardDetails();
    initTaskWorkspace();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
