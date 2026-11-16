/** Retire an offline production shell before starting the Vite development app. */
export async function retireDevWorker(
  workers: ServiceWorkerContainer,
  cacheStorage: CacheStorage,
  origin: string,
): Promise<boolean> {
  const appWorker = (worker: ServiceWorker | null) => worker?.scriptURL === `${origin}/sw.js`;
  const controlled = appWorker(workers.controller);
  const registrations = await workers.getRegistrations();
  const ours = registrations.filter((registration) => appWorker(registration.active) || appWorker(registration.waiting) || appWorker(registration.installing));
  await Promise.all(ours.map((registration) => registration.unregister()));
  const keys = await cacheStorage.keys();
  await Promise.all(keys.filter((key) => key.startsWith("gateahead-shell-")).map((key) => cacheStorage.delete(key)));
  return controlled;
}

export function watchWorkerUpdates(workers: ServiceWorkerContainer, reload: () => void): () => void {
  const hadController = workers.controller != null;
  let reloading = false;
  const changed = () => {
    if (!hadController || reloading) return;
    reloading = true;
    reload();
  };
  workers.addEventListener("controllerchange", changed);
  return () => workers.removeEventListener("controllerchange", changed);
}
