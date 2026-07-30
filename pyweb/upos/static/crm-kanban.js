(() => {
  function postStage(root, recordId, stageId, lostReason = "") {
    const template = root.dataset.crmStageUrlTemplate || "/crm/__record__/stage";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || "");
    body.set("stage_id", stageId);
    if (lostReason) body.set("lost_reason", lostReason);
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
    const cards = Array.from(column.querySelectorAll(".crm-kanban-card"));
    const count = column.querySelector("header strong");
    if (count) count.textContent = String(cards.length);
    const total = column.querySelector(".crm-kanban-column-total");
    if (total) {
      const amount = cards.reduce((sum, card) => sum + parseCardAmount(card), 0);
      const currency = cards.find((card) => card.dataset.crmAmountCurrency)?.dataset.crmAmountCurrency || "UZS";
      total.textContent = formatColumnMoney(amount, currency);
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
      showDetailPane("history");
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
        link.addEventListener("click", (event) => {
          event.preventDefault();
        });
      });
      card.addEventListener("dblclick", (event) => {
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

    const requestLostReason = () =>
      new Promise((resolve) => {
        if (!lostDialog) {
          resolve(window.prompt("Почему сделка потеряна?") || "");
          return;
        }
        const form = lostDialog.querySelector("[data-crm-lost-reason-form]");
        const input = form?.querySelector('[name="lost_reason"]');
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
          const value = String(input?.value || "").trim();
          if (!value) {
            input?.focus();
            return;
          }
          finish(value);
        };
        const onCancel = (event) => {
          event?.preventDefault?.();
          finish("");
        };
        if (input) input.value = "";
        form?.addEventListener("submit", onSubmit);
        lostDialog.querySelectorAll("[data-crm-lost-cancel]").forEach((button) => button.addEventListener("click", onCancel));
        lostDialog.addEventListener("cancel", onCancel);
        if (typeof lostDialog.showModal === "function") lostDialog.showModal();
        else lostDialog.setAttribute("open", "");
        input?.focus();
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
        const lostReason = column.dataset.crmStageOutcome === "lost" ? await requestLostReason() : "";
        if (column.dataset.crmStageOutcome === "lost" && !lostReason) return;
        const previousColumn = card.closest(".crm-kanban-column");
        const previousRect = card.getBoundingClientRect();
        moveCardToTop(dropzone, card);
        card.classList.remove("is-dragging");
        column.classList.add("is-committing");
        if (previousColumn) updateColumnState(previousColumn);
        updateColumnState(column);
        animateCardMove(card, previousRect);
        postStage(root, recordId, stageId, lostReason)
          .then(() => {
            column.classList.add("is-saved");
            window.setTimeout(() => column.classList.remove("is-saved"), 900);
          })
          .catch(() => {
            window.location.reload();
          })
          .finally(() => {
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
    const contactInput = form?.querySelector('input[name="contact"]');
    const duplicateNote = dialog.querySelector("[data-crm-client-duplicate]");
    const contactMatchNote = dialog.querySelector("[data-crm-contact-match]");
    const existingClients = new Set(
      Array.from(document.querySelectorAll("#crm-client-list option"))
        .map((option) => String(option.value || "").trim().toLocaleLowerCase())
        .filter(Boolean),
    );
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
      const lostReason = form.querySelector('input[name="lost_reason"]');
      const lostField = form.querySelector("[data-crm-lost-reason-field]");
      if (nextStep) nextStep.required = !isCompactDeal && isOpenWork;
      if (dueDate) dueDate.required = !isCompactDeal && isOpenWork;
      if (lostReason) lostReason.required = !isCompactDeal && isLost;
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
      form.classList.toggle("is-compact-deal-create", isCompactDeal);
      if (contactInput) contactInput.required = isCompactDeal;
      if (isCompactDeal) {
        if (title) title.textContent = "Новая сделка";
        if (subtitle) subtitle.textContent = "Основные данные сделки";
        if (submit) submit.textContent = "Создать сделку";
        const nextStep = form.querySelector('input[name="next_step"]');
        if (nextStep && !nextStep.value) setField("next_step", "Связаться с клиентом");
      }
      syncConditionalFields();
    };

    const resetDialog = () => {
      if (!form) return;
      form.reset();
      form.dataset.crmDialogMode = "create";
      form.classList.remove("is-compact-deal-create");
      form.setAttribute("action", defaultAction);
      setField("record_id", "");
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
    form?.querySelectorAll('select[name="status"], select[name="stage_id"]').forEach((field) => {
      field.addEventListener("change", syncConditionalFields);
    });
    clientInput?.addEventListener("input", syncDuplicateNotice);
    contactInput?.addEventListener("input", syncContactMatch);
    document.addEventListener("crm:edit-record", (event) => {
      const payload = parsePayload(event.detail?.payload);
      if (!payload?.id) return;
      openDialog(payload.item_type || "deal", payload, "edit");
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

    const openFromMessenger = () => {
      const params = new URLSearchParams(window.location.search || "");
      if (params.get("crm_open") !== "deal") return;
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

    openFromMessenger();
  }

  function init() {
    document.querySelectorAll("[data-crm-kanban]").forEach(initKanban);
    initDialog();
    initCardDetails();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
