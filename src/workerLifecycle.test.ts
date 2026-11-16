import assert from "node:assert/strict";
import test from "node:test";
import { retireDevWorker, watchWorkerUpdates } from "./workerLifecycle";

test("development releases the old offline shell and preserves unrelated workers and caches", async () => {
  const removed: string[] = [], deleted: string[] = [];
  const origin = "http://localhost:5173";
  const worker = { scriptURL: `${origin}/sw.js` };
  const registration = (scriptURL: string) => ({ active: { scriptURL }, unregister: async () => { removed.push(scriptURL); return true; } });
  const workers = { controller: worker, getRegistrations: async () => [registration(worker.scriptURL), registration(`${origin}/other-worker.js`)] } as unknown as ServiceWorkerContainer;
  const cacheStorage = { keys: async () => ["gateahead-shell-old", "other-app-cache"], delete: async (key: string) => { deleted.push(key); return true; } } as unknown as CacheStorage;
  assert.equal(await retireDevWorker(workers, cacheStorage, origin), true);
  assert.deepEqual(removed, [worker.scriptURL]);
  assert.deepEqual(deleted, ["gateahead-shell-old"]);
  // The replacement development page has no controller and does not reload again.
  assert.equal(await retireDevWorker({ ...workers, controller: null } as ServiceWorkerContainer, cacheStorage, origin), false);
});

test("an already unregistered worker still releases the controlled page with one reload", async () => {
  const origin = "http://localhost:5173";
  const workers = { controller: { scriptURL: `${origin}/sw.js` }, getRegistrations: async () => [] } as unknown as ServiceWorkerContainer;
  const cacheStorage = { keys: async () => [] } as unknown as CacheStorage;
  assert.equal(await retireDevWorker(workers, cacheStorage, origin), true);
});

test("a production worker update reloads an older page once; first installation does not", () => {
  function container(controller: object | null) {
    const events = new EventTarget();
    return { events, workers: Object.assign(events, { controller }) as unknown as ServiceWorkerContainer };
  }
  let reloads = 0;
  const old = container({});
  const stop = watchWorkerUpdates(old.workers, () => reloads++);
  old.events.dispatchEvent(new Event("controllerchange"));
  old.events.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 1);
  stop();
  const fresh = container(null);
  watchWorkerUpdates(fresh.workers, () => reloads++);
  fresh.events.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 1);
});
