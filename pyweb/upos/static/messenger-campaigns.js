(function () {
  "use strict";

  function boot() {
    var form = document.querySelector("[data-messenger-campaign-form]");
    if (!form) return;
    var search = form.querySelector("[data-messenger-campaign-search]");
    var items = Array.prototype.slice.call(form.querySelectorAll("[data-messenger-campaign-recipient]"));
    var count = form.querySelector("[data-messenger-campaign-count]");
    var campaigns = [];
    try {
      campaigns = JSON.parse((document.querySelector("[data-messenger-campaign-json]") || {}).textContent || "[]");
    } catch (_) { campaigns = []; }

    function checked() {
      return items.filter(function (row) { return row.querySelector("input").checked; });
    }
    function update() {
      var selected = checked().length;
      count.textContent = "Выбрано: " + selected + " из " + items.length;
      count.classList.toggle("is-limit", selected > 20);
    }
    function filter() {
      var query = (search.value || "").trim().toLocaleLowerCase();
      items.forEach(function (row) {
        row.hidden = !!query && (row.getAttribute("data-search") || "").indexOf(query) < 0;
      });
    }
    form.addEventListener("change", update);
    search.addEventListener("input", filter);
    form.addEventListener("submit", function (event) {
      var button = event.submitter;
      if (!button || button.value !== "launch") return;
      var selected = checked();
      var message = (form.elements.message.value || "").trim();
      if (!selected.length || !message || selected.length > 20) {
        event.preventDefault();
        window.alert(selected.length > 20 ? "Выберите не более 20 чатов." : "Выберите чаты и введите сообщение.");
        return;
      }
      if (!window.confirm("Отправить сообщение в " + selected.length + " выбранных чатов Telegram?")) {
        event.preventDefault();
        return;
      }
      button.textContent = "Отправляется…";
    });
    document.querySelectorAll("[data-messenger-campaign-reuse]").forEach(function (button) {
      button.addEventListener("click", function () {
        var campaign = campaigns.find(function (row) { return String(row.id) === button.getAttribute("data-messenger-campaign-reuse"); });
        if (!campaign || campaign.status !== "draft") return;
        form.elements.form_id.value = campaign.id;
        form.elements.title.value = campaign.title || "";
        form.elements.message.value = campaign.message || "";
        form.elements.note.value = campaign.note || "";
        var ids = campaign.recipient_ids || [];
        items.forEach(function (row) { row.querySelector("input").checked = ids.indexOf(row.querySelector("input").value) >= 0; });
        search.value = "";
        filter();
        update();
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        form.elements.title.focus();
      });
    });
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
