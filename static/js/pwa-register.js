(function () {
    "use strict";

    if (!("serviceWorker" in navigator)) {
        return;
    }

    window.addEventListener("load", async function () {
        try {
            const registration = await navigator.serviceWorker.register("/service-worker.js", {
                scope: "/"
            });

            console.log("Conquer PWA service worker registered:", registration.scope);
        } catch (error) {
            console.error("PWA service worker registration failed:", error);
        }
    });
})();