(() => {
  function postStage(root, recordId, stageId) {
    const template = root.dataset.crmStageUrlTemplate || "/crm/__record__/stage";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || "");
    body.set("stage_id", stageId);
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
    const cards = Array.from(column.querySelectorAll(".crm-kanban-card")).filter((card) => !card.hidden);
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
    const chat = dialog.querySelector("[data-crm-card-detail-chat]");
    const history = dialog.querySelector("[data-crm-card-detail-history]");
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
    };

    const setText = (node, value) => {
      if (node) node.textContent = valueOrDash(value);
    };

    const openDetails = (card) => {
      if (!card) return;
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
      if (history) {
        const historyTemplate = card.querySelector("template[data-crm-card-history]");
        const content = historyTemplate?.innerHTML?.trim() || "";
        history.innerHTML = content || '<p class="crm-card-detail-empty">История по клиенту пока пустая.</p>';
      }
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    };

    const closeDetails = () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
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
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDetails();
    });
  }

  function initKanban(root) {
    let dragged = null;
    let selectedCard = null;
    const archiveToggle = document.querySelector("[data-crm-archive-toggle]");
    const archiveRow = document.querySelector("[data-crm-archive-row]");
    const archiveList = document.querySelector("[data-crm-archive-card-row]");
    const archiveCount = document.querySelector("[data-crm-archive-count]");
    const archiveSearch = document.querySelector("[data-crm-archive-search]");
    const searchInput = document.querySelector('.crm-kanban-filters input[name="q"]');
    const trashDrop = document.querySelector("[data-crm-trash-drop]");

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
      const title = valueOrDash(card.dataset.crmDetailTitle);
      const client = valueOrDash(card.dataset.crmDetailClient);
      const amount = valueOrDash(card.dataset.crmDetailAmount);
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
        <div class="crm-kanban-card-money"><strong></strong></div>
      `;
      item.querySelector(".crm-kanban-card-date").textContent = date;
      item.querySelector(".crm-kanban-card-top strong").textContent = title;
      item.querySelector(".crm-kanban-card-top span").textContent = type;
      item.querySelector(".crm-kanban-client").textContent = client === "-" ? "" : client;
      item.querySelector(".crm-kanban-card-money strong").textContent = amount;
      archiveList.prepend(item);
      applyArchiveSearch();
    };

    const updateArchiveCount = () => {
      if (!archiveCount) return;
      const current = Number.parseInt(archiveCount.textContent || "0", 10) || 0;
      archiveCount.textContent = String(current + 1);
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
      const titleNode = card.querySelector(".crm-kanban-card-top > strong");
      const clientNode = card.querySelector(".crm-kanban-client");
      if (titleNode) titleNode.innerHTML = highlightText(title, query);
      if (clientNode) clientNode.innerHTML = highlightText(client, query);
    };

    const renderTags = (card, tags) => {
      const normalizedTags = Array.isArray(tags) ? tags.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const tagText = normalizedTags.join(", ");
      card.dataset.crmTags = tagText;
      const list = card.querySelector("[data-crm-card-tags]");
      if (list) {
        list.innerHTML = "";
        normalizedTags.forEach((tag) => {
          const chip = document.createElement("span");
          chip.textContent = tag;
          list.appendChild(chip);
        });
      }
      try {
        const payload = JSON.parse(card.dataset.crmEditPayload || "{}");
        payload.tags = tagText;
        card.dataset.crmEditPayload = JSON.stringify(payload);
      } catch {
        // Ignore malformed payload; the visible tag is still updated.
      }
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
        card.hidden = !visible;
        renderSearchMatch(card, visible ? query : "");
        if (!visible && selectedCard === card) setSelectedCard(null);
      });
      root.querySelectorAll(".crm-kanban-column").forEach(updateColumnState);
    };

    archiveToggle?.addEventListener("click", () => {
      if (!archiveRow) return;
      archiveRow.hidden = !archiveRow.hidden;
      if (!archiveRow.hidden) {
        applyArchiveSearch();
        archiveSearch?.focus();
      }
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
      dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        column.classList.remove("is-over");
        const recordId = event.dataTransfer.getData("text/plain") || dragged?.dataset.crmRecordId || "";
        const card = dragged || root.querySelector(`[data-crm-record-id="${CSS.escape(recordId)}"]`);
        const stageId = column.dataset.crmStageId || "";
        if (!card || !recordId || !stageId) return;
        const previousColumn = card.closest(".crm-kanban-column");
        const previousRect = card.getBoundingClientRect();
        moveCardToTop(dropzone, card);
        card.classList.remove("is-dragging");
        column.classList.add("is-committing");
        if (previousColumn) updateColumnState(previousColumn);
        updateColumnState(column);
        animateCardMove(card, previousRect);
        postStage(root, recordId, stageId)
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

    const setKind = (kind) => {
      if (!kind) return;
      const input = dialog.querySelector(`input[name="item_type"][value="${CSS.escape(kind)}"]`);
      if (input) input.checked = true;
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

    const resetDialog = () => {
      if (!form) return;
      form.reset();
      form.setAttribute("action", defaultAction);
      setField("record_id", "");
      if (title) title.textContent = "Новая запись";
      if (subtitle) subtitle.textContent = "Сделка, задача или история контакта";
      if (submit) submit.textContent = "Сохранить запись";
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
      setKind(kind);
      if (payload) fillPayload(payload);
      if (mode === "edit" && payload?.id && form) {
        form.setAttribute("action", `/crm/${encodeURIComponent(payload.id)}/update`);
        if (title) title.textContent = "Редактировать CRM";
        if (subtitle) subtitle.textContent = "Карточка клиента, этап, следующий шаг и история";
        if (submit) submit.textContent = "Сохранить изменения";
      }
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
