(function () {
  const target = new URL("../index.html", window.location.href);
  const params = new URLSearchParams(window.location.search);
  params.set("liff", "1");
  target.search = params.toString();
  target.hash = window.location.hash;
  window.location.replace(target.href);
})();
