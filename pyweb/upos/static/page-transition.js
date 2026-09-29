(() => {
  "use strict";

  const veil = document.querySelector("[data-page-veil]");
  if (!veil) {
    return;
  }

  // Быстрые переходы не должны мигать индикатором, поэтому показываем его
  // с небольшой задержкой. Если страница так и не сменилась (например,
  // ссылка отдала файл), через MAX_VISIBLE убираем сами.
  const SHOW_DELAY = 140;
  const MAX_VISIBLE = 12000;
  const FILE_LIKE = /(export|download|\.xlsx|\.xls|\.csv|\.pdf|\.zip|\.png|\.jpg|\.jpeg|\.svg)/i;

  let showTimer = 0;
  let hideTimer = 0;

  function show() {
    if (veil.dataset.visible === "1" || showTimer) {
      return;
    }
    showTimer = window.setTimeout(() => {
      showTimer = 0;
      veil.dataset.visible = "1";
      veil.setAttribute("aria-hidden", "false");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, MAX_VISIBLE);
    }, SHOW_DELAY);
  }

  function hide() {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    showTimer = 0;
    hideTimer = 0;
    delete veil.dataset.visible;
    veil.setAttribute("aria-hidden", "true");
  }

  function skipLink(link, url) {
    if (link.hasAttribute("download") || link.dataset.noPageVeil !== undefined) {
      return true;
    }
    if (link.target && link.target !== "_self") {
      return true;
    }
    if (url.origin !== window.location.origin) {
      return true;
    }
    if (FILE_LIKE.test(url.pathname + url.search)) {
      return true;
    }
    // Ссылка на якорь внутри текущей страницы переходом не является.
    return (
      Boolean(url.hash) &&
      url.pathname === window.location.pathname &&
      url.search === window.location.search
    );
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) {
      return;
    }
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel|sms|data|blob):/i.test(href)) {
      return;
    }
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch (error) {
      return;
    }
    if (skipLink(link, url)) {
      return;
    }
    show();
  });

  document.addEventListener("submit", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.noPageVeil !== undefined) {
      return;
    }
    if (form.target && form.target !== "_self") {
      return;
    }
    const action = form.getAttribute("action") || "";
    if (action && FILE_LIKE.test(action)) {
      return;
    }
    show();
  });

  // Кнопка «назад», ввод адреса вручную и прочие уходы со страницы.
  window.addEventListener("beforeunload", show);
  // Возврат из кеша браузера возвращает уже отрисованную страницу.
  window.addEventListener("pageshow", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hide();
    }
  });

  hide();
})();
