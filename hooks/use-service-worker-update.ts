'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useServiceWorkerUpdate(basePath: string) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    const onControllerChange = () => {
      if (!refreshingRef.current) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker.register(`${basePath}/sw.js`).then((registration) => {
      registrationRef.current = registration;
      if (registration.waiting && navigator.serviceWorker.controller) setUpdateAvailable(true);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateAvailable(true);
        });
      });
    }).catch(() => undefined);

    const checkWhenVisible = () => {
      if (!document.hidden) registrationRef.current?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, [basePath]);

  const applyUpdate = useCallback(() => {
    refreshingRef.current = true;
    registrationRef.current?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  return { updateAvailable, applyUpdate };
}
