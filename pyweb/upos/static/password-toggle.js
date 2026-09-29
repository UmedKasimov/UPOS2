(function () {
  function bind(wrap) {
    var input = wrap.querySelector(".pwd-input");
    var btn = wrap.querySelector(".pwd-toggle");
    if (!input || !btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    var labelShow = btn.getAttribute("data-label-show") || "Показать пароль";
    var labelHide = btn.getAttribute("data-label-hide") || "Скрыть пароль";
    btn.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.setAttribute("aria-label", show ? labelHide : labelShow);
    });
  }

  function init() {
    document.querySelectorAll(".pwd-wrap").forEach(bind);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
