(function () {
  const serviceWorkerVersion = "v7";
  const canUseServiceWorker = "serviceWorker" in navigator;
  const isSecureContext = window.location.protocol === "https:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (!canUseServiceWorker || !isSecureContext) {
    return;
  }

  window.addEventListener("load", () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshQueued = false;

    function activateWaitingWorker(registration) {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    }

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || refreshQueued) {
        return;
      }

      refreshQueued = true;
      window.location.reload();
    });

    navigator.serviceWorker.register("./service-worker.js?version=" + serviceWorkerVersion, {
      scope: "./",
      updateViaCache: "none"
    })
      .then((registration) => {
        activateWaitingWorker(registration);
        registration.update().then(() => {
          activateWaitingWorker(registration);
        }).catch((error) => {
          console.warn("PWA service worker update failed", error);
        });

        registration.addEventListener("updatefound", () => {
          const nextWorker = registration.installing;
          if (!nextWorker) {
            return;
          }

          nextWorker.addEventListener("statechange", () => {
            if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
              nextWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((error) => {
        console.warn("PWA service worker registration failed", error);
      });
  });
})();
