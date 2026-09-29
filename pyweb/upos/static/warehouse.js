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

  function initWarehouseOperations() {
    var dialog = document.getElementById("warehouse-operation-dialog");
    var adjustmentDialog = document.querySelector("[data-warehouse-adjustment-dialog]");

    document.querySelectorAll("[data-warehouse-open-operation]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDialog(dialog);
      });
    });

    document.querySelectorAll("[data-warehouse-close-operation]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeDialog(button.closest("dialog"));
      });
    });

    if (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeDialog(dialog);
      });
    }

    document.querySelectorAll("[data-warehouse-adjustment-create]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDialog(adjustmentDialog);
      });
    });

    document.querySelectorAll("[data-warehouse-adjustment-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeDialog(adjustmentDialog);
      });
    });

    if (adjustmentDialog) {
      adjustmentDialog.addEventListener("click", function (event) {
        if (event.target === adjustmentDialog) closeDialog(adjustmentDialog);
      });
      adjustmentDialog.addEventListener("close", function () {
        var url = new URL(window.location.href);
        if (!url.searchParams.has("create")) return;
        url.searchParams.delete("create");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      });
      if (adjustmentDialog.dataset.openOnLoad === "1") openDialog(adjustmentDialog);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWarehouseOperations, { once: true });
  } else {
    initWarehouseOperations();
  }
})();
