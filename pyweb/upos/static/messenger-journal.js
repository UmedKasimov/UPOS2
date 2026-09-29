(function () {
  function initMessageJournals() {
    document.querySelectorAll("[data-messenger-message-journal]").forEach(function (root) {
      if (root.dataset.messengerJournalReady === "true") return;
      root.dataset.messengerJournalReady = "true";

      var rows = Array.prototype.slice.call(root.querySelectorAll("[data-messenger-journal-row]"));
      var buttons = Array.prototype.slice.call(root.querySelectorAll("[data-messenger-journal-channel]"));
      var search = root.querySelector("[data-messenger-journal-search]");
      var summary = root.querySelector("[data-messenger-journal-summary]");
      var empty = root.querySelector("[data-messenger-journal-empty]");
      var params = new URLSearchParams(window.location.search);
      var activeChannel = String(params.get("journal_channel") || "").toLowerCase();
      var initialQuery = String(params.get("journal_q") || "");

      if (search && initialQuery) search.value = initialQuery;

      function applyFilters() {
        var query = String((search && search.value) || "").trim().toLowerCase();
        var visible = 0;
        rows.forEach(function (row) {
          var channelMatches = !activeChannel || row.dataset.channel === activeChannel;
          var searchMatches = !query || String(row.dataset.search || "").indexOf(query) !== -1;
          var matches = channelMatches && searchMatches;
          row.hidden = !matches;
          if (matches) visible += 1;
        });
        if (summary) summary.textContent = "Показано непрочитанных: " + visible + " из " + rows.length;
        if (empty) empty.hidden = visible !== 0;
      }

      buttons.forEach(function (button) {
        button.addEventListener("click", function () {
          activeChannel = String(button.dataset.messengerJournalChannel || "").toLowerCase();
          buttons.forEach(function (item) {
            var active = item === button;
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", active ? "true" : "false");
          });
          applyFilters();
        });
      });
      if (activeChannel) {
        buttons.forEach(function (button) {
          var active = String(button.dataset.messengerJournalChannel || "").toLowerCase() === activeChannel;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
      if (search) search.addEventListener("input", applyFilters);
      rows.forEach(function (row) {
        function openThread(event) {
          if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
          if (event.target.closest("a, button, input, select, textarea")) return;
          var url = row.dataset.threadUrl;
          if (!url) return;
          event.preventDefault();
          window.location.href = url;
        }
        row.addEventListener("click", openThread);
        row.addEventListener("keydown", openThread);
      });
      applyFilters();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMessageJournals);
  } else {
    initMessageJournals();
  }
})();
