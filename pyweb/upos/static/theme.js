(function () {
  function apply(theme) {
    var h = document.documentElement;
    h.classList.remove("dark", "emerald");
    if (theme === "dark") h.classList.add("dark");
    if (theme === "emerald") {
      h.classList.add("emerald");
    }
  }
  var t = document.body && document.body.dataset.theme;
  if (t) apply(t);
  window.uposTheme = apply;
})();
