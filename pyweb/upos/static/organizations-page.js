(() => {
  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    const first = dialog.querySelector('input, textarea, select, button');
    if (first && typeof first.focus === 'function') first.focus();
  }

  function closeDialog(target) {
    const dialog = target.closest('dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  document.addEventListener('click', (event) => {
    const openBtn = event.target.closest('[data-org-modal-open]');
    if (openBtn) {
      event.preventDefault();
      openDialog(openBtn.getAttribute('data-org-modal-open'));
      return;
    }

    const closeBtn = event.target.closest('[data-org-modal-close]');
    if (closeBtn) {
      event.preventDefault();
      closeDialog(closeBtn);
    }
  });

  document.querySelectorAll('.director-org-modal').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
    });
  });
})();
