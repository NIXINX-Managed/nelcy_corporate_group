"use client";

import { useEffect } from "react";

export default function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // En desarrollo, un SW antiguo puede servir JavaScript de otra versión.
    // Retiramos únicamente el SW de esta app y sus cachés de Nelcy.
    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) => {
              const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL;
              return script ? new URL(script).pathname === "/sw.js" : false;
            })
            .map((registration) => registration.unregister())
        );
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter((name) => name.startsWith("ncg-static-")).map((name) => caches.delete(name)));
        }
      })().catch(() => {});
      return;
    }

    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      // Si no se registra, la aplicación financiera sigue funcionando online.
    });
  }, []);
  return null;
}
