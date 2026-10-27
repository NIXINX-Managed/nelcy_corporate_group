"use client";

import { useEffect } from "react";

export default function PwaRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // La app sigue funcionando online aunque falle el service worker.
      });
    }
  }, []);
  return null;
}
