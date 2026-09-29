(function () {
  "use strict";

  var pointerStarts = new WeakMap();

  function backdropCloseEnabled(element) {
    return element && element.getAttribute("data-backdrop-close") !== "false";
  }

  function isPrimaryPointer(event) {
    return event.button === undefined || event.button === 0;
  }

  function requestDialogClose(dialog) {
    if (!dialog.open || !backdropCloseEnabled(dialog)) return;

    var cancelEvent = new Event("cancel", { bubbles: false, cancelable: true });
    if (!dialog.dispatchEvent(cancelEvent) || !dialog.open) return;
    dialog.close("backdrop");
  }

  document.addEventListener("pointerdown", function (event) {
    if (!isPrimaryPointer(event)) return;

    var target = event.target;
    var dialog = target instanceof HTMLDialogElement
      ? target
      : target.closest && target.closest("dialog");
    if (dialog instanceof HTMLDialogElement && dialog.open) {
      pointerStarts.set(dialog, event.target === dialog);
      return;
    }

    var backdrop = event.target.closest && event.target.closest("[data-modal-backdrop]");
    if (backdrop) pointerStarts.set(backdrop, event.target === backdrop);
  });

  document.addEventListener("click", function (event) {
    if (!isPrimaryPointer(event)) return;

    var dialog = event.target;
    if (dialog instanceof HTMLDialogElement) {
      var startedOnBackdrop = pointerStarts.get(dialog);
      pointerStarts.delete(dialog);
      if (startedOnBackdrop !== true || event.target !== dialog) return;
      requestDialogClose(dialog);
      return;
    }

    var backdrop = event.target.closest && event.target.closest("[data-modal-backdrop]");
    if (!backdrop || event.target !== backdrop || !backdropCloseEnabled(backdrop)) return;

    var customStartedOnBackdrop = pointerStarts.get(backdrop);
    pointerStarts.delete(backdrop);
    if (customStartedOnBackdrop !== true) return;

    var closeUrl = backdrop.getAttribute("data-backdrop-close-url");
    if (closeUrl) window.location.assign(closeUrl);
  });

  document.addEventListener("pointercancel", function (event) {
    var target = event.target;
    var dialog = target instanceof HTMLDialogElement
      ? target
      : target.closest && target.closest("dialog");
    if (dialog instanceof HTMLDialogElement) pointerStarts.delete(dialog);
    var backdrop = target.closest && target.closest("[data-modal-backdrop]");
    if (backdrop) pointerStarts.delete(backdrop);
  });
})();
