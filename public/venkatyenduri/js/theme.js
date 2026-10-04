// Swaps the theme stylesheet between campus.css and midnight.css
// and remembers the choice across pages.
(function () {
  var themes = ["campus", "midnight"];
  var saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch (e) {}

  function apply(name) {
    document.getElementById("theme").href = "css/" + name + ".css";
    try {
      localStorage.setItem("theme", name);
    } catch (e) {}
  }

  if (themes.indexOf(saved) > -1) {
    apply(saved);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("theme-toggle").addEventListener("click", function () {
      var current = document.getElementById("theme").href.indexOf("midnight") > -1 ? "midnight" : "campus";
      apply(current === "campus" ? "midnight" : "campus");
    });
  });
})();
