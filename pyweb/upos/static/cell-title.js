/* Полный текст ячейки при наведении: если содержимое обрезано (ellipsis),
   браузерная подсказка показывает его целиком. Работает во всех таблицах. */
(() => {
  document.addEventListener("mouseover", (event) => {
    const cell = event.target.closest("td, th");
    if (!cell || cell.dataset.cellTitleDone === "1") return;
    cell.dataset.cellTitleDone = "1";
    if (cell.getAttribute("title")) return;
    // Служебные значки (стрелки сортировки и т.п.) в подсказку не попадают.
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
    const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    // Обрезан сам td или любой из вложенных блоков с ellipsis.
    const clipped = [cell, ...cell.querySelectorAll("*")].some(
      (el) => el.scrollWidth > el.clientWidth + 1
    );
    if (clipped) cell.title = text;
  });
})();
