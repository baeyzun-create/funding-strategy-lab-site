(function () {
  const canUseServiceWorker = "serviceWorker" in navigator;
  const isSecureContext = window.location.protocol === "https:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (!canUseServiceWorker || !isSecureContext) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
      .catch((error) => {
        console.warn("PWA service worker registration failed", error);
      });
  });
})();
