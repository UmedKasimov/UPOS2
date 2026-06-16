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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWarehouseOperations, { once: true });
  } else {
    initWarehouseOperations();
  }
})();
