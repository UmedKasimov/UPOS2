/* Шаблон узбекского номера: поля с data-uz-phone форматируются при вводе
   как +998 90 123 45 67. Цифры можно вводить как с кодом страны, так и без. */
(() => {
  function formatUzPhone(field) {
    let digits = String(field.value || "").replace(/\D/g, "");
    if (digits.startsWith("998")) digits = digits.slice(3);
    digits = digits.slice(0, 9);
    if (!digits) {
      field.value = "";
      return;
    }
    let out = "+998 " + digits.slice(0, 2);
    if (digits.length > 2) out += " " + digits.slice(2, 5);
    if (digits.length > 5) out += " " + digits.slice(5, 7);
    if (digits.length > 7) out += " " + digits.slice(7, 9);
    field.value = out;
  }

  document.addEventListener("input", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.hasAttribute("data-uz-phone")) return;
    formatUzPhone(field);
  });
})();
