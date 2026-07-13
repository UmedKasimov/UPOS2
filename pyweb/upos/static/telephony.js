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
