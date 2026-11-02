import type { AssetManifest } from "@marchlands/asset-pack";

const DB_NAME = "marchlands.assetpacks";
const DB_VERSION = 1;
const STORE = "packs";

export interface StoredPack {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  savedAt: number;
  manifest: AssetManifest;
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveStoredPack(manifest: AssetManifest, bytes: Uint8Array): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const record: StoredPack = {
        id: manifest.id,
        name: manifest.name,
        bytes: bytes.slice().buffer,
        savedAt: Date.now(),
        manifest,
      };
      store.put(record);
      transaction.oncomplete = () => {
        database.close();
        resolve(true);
      };
      transaction.onerror = () => {
        database.close();
        resolve(false);
      };
    } catch {
      database.close();
      resolve(false);
    }
  });
}

export async function listStoredPacks(): Promise<StoredPack[]> {
  const database = await openDatabase();
  if (!database) return [];
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? (request.result as StoredPack[]) : [];
        database.close();
        resolve(rows.sort((a, b) => a.savedAt - b.savedAt));
      };
      request.onerror = () => {
        database.close();
        resolve([]);
      };
    } catch {
      database.close();
      resolve([]);
    }
  });
}

export async function deleteStoredPack(id: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  database.close();
}
