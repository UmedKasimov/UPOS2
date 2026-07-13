(function () {
  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function localDateTimeValue(date) {
    var offset = date.getTimezoneOffset();
    var local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  function highlightCallSearchMatches() {
    var query = String(new URLSearchParams(window.location.search).get("q") || "").trim();
    if (!query) return;
    var needle = query.toLocaleLowerCase("ru-RU");
    document.querySelectorAll("[data-telephony-search-highlight]").forEach(function (node) {
      var text = node.textContent || "";
      var lower = text.toLocaleLowerCase("ru-RU");
      var start = lower.indexOf(needle);
      if (start < 0) return;
      var fragment = document.createDocumentFragment();
      var cursor = 0;
      while (start >= 0) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
        var mark = document.createElement("mark");
        mark.className = "telephony-search-hit";
        mark.textContent = text.slice(start, start + query.length);
        fragment.appendChild(mark);
        cursor = start + query.length;
        start = lower.indexOf(needle, cursor);
      }
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
      node.replaceChildren(fragment);
    });
  }

  function normalizedSearchValue(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("ru-RU")
      .replace(/\s+/g, " ");
  }

  function highlightContactText(node, query) {
    if (!node) return;
    if (!node.dataset.telephonyOriginalText) {
      node.dataset.telephonyOriginalText = node.textContent || "";
    }
    var text = node.dataset.telephonyOriginalText;
    node.textContent = text;
    if (!query) return;
    var lower = normalizedSearchValue(text);
    var start = lower.indexOf(query);
    if (start < 0) return;
    var fragment = document.createDocumentFragment();
    var cursor = 0;
    while (start >= 0) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
      var mark = document.createElement("mark");
      mark.className = "telephony-search-hit";
      mark.textContent = text.slice(start, start + query.length);
      fragment.appendChild(mark);
      cursor = start + query.length;
      start = lower.indexOf(query, cursor);
    }
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.replaceChildren(fragment);
  }

  function telephonyContacts() {
    var node = document.getElementById("telephony-contacts-data");
    if (!node) return [];
    try {
      var parsed = JSON.parse(node.textContent || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function formatContactDate(value) {
    if (!value) return "Дата не указана";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function appendContactCall(container, call) {
    var row = document.createElement("article");
    row.className = "telephony-contact-history-item telephony-contact-history-item--" + (call.direction || "outgoing");

    var direction = document.createElement("span");
    direction.className = "telephony-contact-history-direction";
    direction.setAttribute("aria-hidden", "true");
    direction.textContent = call.direction === "incoming" ? "↙" : "↗";

    var copy = document.createElement("div");
    var title = document.createElement("strong");
    title.textContent = call.direction_label || (call.direction === "incoming" ? "Входящий" : "Исходящий");
    var meta = document.createElement("span");
    var duration = call.duration ? " · " + call.duration + " сек." : "";
    meta.textContent = formatContactDate(call.started_at) + duration;
    copy.append(title, meta);
    if (call.responsible) {
      var responsible = document.createElement("small");
      responsible.textContent = "Ответственный: " + call.responsible;
      copy.appendChild(responsible);
    }
    if (call.note) {
      var note = document.createElement("p");
      note.textContent = call.note;
      copy.appendChild(note);
    }

    var statusWrap = document.createElement("div");
    statusWrap.className = "telephony-contact-history-status";
    var status = document.createElement("span");
    status.className = "telephony-call-status-cell telephony-call-status-cell--" + (call.status || "unknown");
    status.textContent = call.status_label || call.status || "-";
    statusWrap.appendChild(status);
    if (call.recording_url) {
      var audio = document.createElement("audio");
      audio.className = "telephony-recording-player";
      audio.controls = true;
      audio.preload = "none";
      audio.src = call.recording_url;
      statusWrap.appendChild(audio);
    }

    row.append(direction, copy, statusWrap);
    container.appendChild(row);
  }

  function openContactDialog(dialog, contact) {
    if (!dialog || !contact) return;
    var title = dialog.querySelector("[data-telephony-contact-title]");
    var subtitle = dialog.querySelector("[data-telephony-contact-subtitle]");
    var state = dialog.querySelector("[data-telephony-contact-profile-state]");
    var id = dialog.querySelector("[data-telephony-contact-id]");
    var name = dialog.querySelector("[data-telephony-contact-name]");
    var phone = dialog.querySelector("[data-telephony-contact-phone]");
    var save = dialog.querySelector("[data-telephony-contact-save]");
    var history = dialog.querySelector("[data-telephony-contact-history]");
    if (title) title.textContent = contact.name || "Контакт";
    if (subtitle) subtitle.textContent = (contact.phone || "Номер не подтвержден") + " · " + (contact.calls_count || 0) + " звонков";
    if (state) {
      state.className = "telephony-contact-profile-state telephony-contact-profile-state--" + (contact.state || "pending");
      state.textContent = contact.state_label || (contact.pending ? "Нужно подтвердить" : "Подтвержден");
    }
    if (id) id.value = contact.id || "";
    if (name) name.value = contact.name || "";
    if (phone) phone.value = contact.phone || "";
    if (save) save.textContent = contact.pending ? "Подтвердить и сохранить" : "Обновить контакт";
    var counters = {
      "[data-telephony-contact-calls]": contact.calls_count || 0,
      "[data-telephony-contact-incoming]": contact.incoming_count || 0,
      "[data-telephony-contact-outgoing]": contact.outgoing_count || 0
    };
    Object.keys(counters).forEach(function (selector) {
      var node = dialog.querySelector(selector);
      if (node) node.textContent = String(counters[selector]);
    });
    if (history) {
      history.replaceChildren();
      var calls = Array.isArray(contact.calls) ? contact.calls : [];
      if (calls.length) {
        calls.forEach(function (call) {
          appendContactCall(history, call || {});
        });
      } else {
        var empty = document.createElement("p");
        empty.className = "empty-hint";
        empty.textContent = "У этого контакта пока нет звонков.";
        history.appendChild(empty);
      }
    }
    openDialog(dialog);
  }

  function initContactDirectory() {
    var search = document.querySelector("[data-telephony-contact-search]");
    var state = document.querySelector("[data-telephony-contact-state]");
    var clear = document.querySelector("[data-telephony-contact-clear]");
    var rows = Array.from(document.querySelectorAll("[data-telephony-contact-open]"));
    var noResults = document.querySelector("[data-telephony-contact-no-results]");
    var total = document.querySelector("[data-telephony-contact-total]");
    var dialog = document.getElementById("telephony-contact-dialog");
    var contacts = telephonyContacts();
    var contactsById = new Map(contacts.map(function (contact) {
      return [String(contact.id || ""), contact];
    }));

    function applyFilters() {
      var query = normalizedSearchValue(search ? search.value : "");
      var selectedState = state ? state.value : "all";
      var visible = 0;
      rows.forEach(function (row) {
        var matchesText = !query || normalizedSearchValue(row.dataset.contactSearch).includes(query);
        var matchesState = selectedState === "all" || row.dataset.contactState === selectedState;
        var show = matchesText && matchesState;
        row.hidden = !show;
        if (show) visible += 1;
        row.querySelectorAll("[data-telephony-contact-highlight]").forEach(function (node) {
          highlightContactText(node, show ? query : "");
        });
      });
      if (noResults) noResults.hidden = visible !== 0;
      if (total) total.textContent = String(visible);
    }

    rows.forEach(function (row) {
      function showContact() {
        openContactDialog(dialog, contactsById.get(String(row.dataset.telephonyContactOpen || "")));
      }
      row.addEventListener("click", showContact);
      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showContact();
        }
      });
    });
    if (search) search.addEventListener("input", applyFilters);
    if (state) state.addEventListener("change", applyFilters);
    if (clear) {
      clear.addEventListener("click", function () {
        if (search) search.value = "";
        if (state) state.value = "all";
        applyFilters();
        if (search) search.focus();
      });
    }
    applyFilters();
  }

  function showIncomingCallPopup(detail) {
    var data = detail || {};
    var popup = document.querySelector("[data-telephony-incoming-popup]");
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "telephony-incoming-popup";
      popup.setAttribute("data-telephony-incoming-popup", "");
      popup.innerHTML =
        '<div><small>Входящий звонок</small><strong data-telephony-popup-client></strong><span data-telephony-popup-phone></span></div>' +
        '<button type="button" class="btn btn-secondary" data-telephony-popup-close>Закрыть</button>';
      document.body.appendChild(popup);
      popup.querySelector("[data-telephony-popup-close]").addEventListener("click", function () {
        popup.hidden = true;
      });
    }
    var client = popup.querySelector("[data-telephony-popup-client]");
    var phone = popup.querySelector("[data-telephony-popup-phone]");
    if (client) client.textContent = data.client || (data.call && data.call.client) || "Неизвестный клиент";
    if (phone) phone.textContent = data.phone || (data.call && data.call.phone) || "";
    popup.hidden = false;
    window.clearTimeout(popup._uposHideTimer);
    popup._uposHideTimer = window.setTimeout(function () {
      popup.hidden = true;
    }, 12000);
  }

  function init() {
    var callDialog = document.getElementById("telephony-call-dialog");
    var numberDialog = document.getElementById("telephony-number-dialog");
    var callDate = callDialog ? callDialog.querySelector('input[name="started_at"]') : null;
    var dateFilter = document.querySelector("[data-telephony-date-filter]");
    var dateFrom = dateFilter ? dateFilter.querySelector('input[name="date_from"]') : null;

    if (dateFilter && dateFrom) {
      dateFrom.addEventListener("change", function () {
        if (typeof dateFilter.requestSubmit === "function") {
          dateFilter.requestSubmit();
        } else {
          dateFilter.submit();
        }
      });
    }

    highlightCallSearchMatches();
    initContactDirectory();

    document.querySelectorAll("[data-telephony-open-call]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (callDate && !callDate.value) callDate.value = localDateTimeValue(new Date());
        openDialog(callDialog);
      });
    });

    document.querySelectorAll("[data-telephony-open-number]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDialog(numberDialog);
      });
    });

    document.querySelectorAll("[data-telephony-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeDialog(button.closest("dialog"));
      });
    });

    document.querySelectorAll(".telephony-dialog").forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeDialog(dialog);
      });
    });

    document.querySelectorAll("[data-telephony-copy]").forEach(function (button) {
      button.addEventListener("click", function () {
        var wrap = button.closest(".telephony-copy-field");
        var input = wrap ? wrap.querySelector("[data-telephony-copy-value]") : null;
        var value = input ? input.value : "";
        if (!value) return;
        function done() {
          var previous = button.textContent;
          button.textContent = "Скопировано";
          window.setTimeout(function () {
            button.textContent = previous;
          }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function () {
            input.select();
            document.execCommand("copy");
            done();
          });
        } else {
          input.select();
          document.execCommand("copy");
          done();
        }
      });
    });

    window.UPOS_TELEPHONY_INCOMING_CALL = showIncomingCallPopup;
    window.addEventListener("upos:incoming-call", function (event) {
      showIncomingCallPopup(event.detail || {});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
