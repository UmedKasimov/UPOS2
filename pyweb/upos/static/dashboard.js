(() => {
  const form = document.querySelector("[data-dashboard-auto-period]");
  if (!form) return;

  let submitTimer = 0;
  let submitting = false;

  form.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!["date_from", "date_to"].includes(event.target.name)) return;

    window.clearTimeout(submitTimer);
    submitTimer = window.setTimeout(() => {
      const dateFrom = form.querySelector('[name="date_from"]');
      const dateTo = form.querySelector('[name="date_to"]');
      if (submitting || !dateFrom?.value || !dateTo?.value) return;
      submitting = true;
      form.requestSubmit();
    }, 120);
  });
})();
