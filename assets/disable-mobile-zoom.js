(function () {
  var lastTouchEnd = 0;
  var style = document.createElement("style");

  style.textContent = [
    "html, body {",
    "  touch-action: pan-x pan-y;",
    "  -webkit-text-size-adjust: 100%;",
    "  text-size-adjust: 100%;",
    "}"
  ].join("\n");
  document.head.appendChild(style);

  document.addEventListener("gesturestart", preventZoom, { passive: false });
  document.addEventListener("gesturechange", preventZoom, { passive: false });
  document.addEventListener("gestureend", preventZoom, { passive: false });

  document.addEventListener("touchend", function (event) {
    var now = Date.now();

    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }

    lastTouchEnd = now;
  }, { passive: false });

  function preventZoom(event) {
    event.preventDefault();
  }
})();
