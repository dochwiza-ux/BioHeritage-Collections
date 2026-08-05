const DB_NAME = "bhcm-field-v1";
const DB_VERSION = 2;
const CATALOG_SEQUENCE_KEY = "catalog-sequence";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) {
        const records = db.createObjectStore("records", { keyPath: "id" });
        records.createIndex("updatedAt", "updatedAt");
        records.createIndex("syncStatus", "syncStatus");
        records.createIndex("publicationStatus", "publicationStatus");
      }
      if (!db.objectStoreNames.contains("media")) {
        const media = db.createObjectStore("media", { keyPath: "id" });
        media.createIndex("recordId", "recordId");
        media.createIndex("syncStatus", "syncStatus");
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(storeName, mode, operation) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const result = operation(store);
  const value = result instanceof IDBRequest ? await requestResult(result) : await result;
  await transactionDone(transaction);
  db.close();
  return value;
}

export async function getRecords() {
  const records = await run("records", "readonly", (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getRecord(id) {
  return run("records", "readonly", (store) => store.get(id));
}

export function putRecord(record) {
  return run("records", "readwrite", (store) => store.put(record));
}

export function removeRecord(id) {
  return run("records", "readwrite", (store) => store.delete(id));
}

export async function getMedia(recordId = null) {
  const items = await run("media", "readonly", (store) => recordId ? store.index("recordId").getAll(recordId) : store.getAll());
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function putMedia(media) {
  return run("media", "readwrite", (store) => store.put(media));
}

export function removeMedia(id) {
  return run("media", "readwrite", (store) => store.delete(id));
}

export async function mergeRecords(records) {
  const db = await openDatabase();
  const transaction = db.transaction("records", "readwrite");
  const store = transaction.objectStore("records");
  for (const record of records) store.put(record);
  await transactionDone(transaction);
  db.close();
}

function highestCatalogSequence(records) {
  return records.reduce((highest, record) => {
    const match = /^BHCM?-(\d{6})$/.exec(String(record.catalogNumber || ""));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
}

function formatCatalogNumber(sequence) {
  return `BHC-${String(sequence).padStart(6, "0")}`;
}

export async function peekNextCatalogNumber() {
  const db = await openDatabase();
  const transaction = db.transaction(["records", "settings"], "readonly");
  const [records, setting] = await Promise.all([
    requestResult(transaction.objectStore("records").getAll()),
    requestResult(transaction.objectStore("settings").get(CATALOG_SEQUENCE_KEY)),
  ]);
  await transactionDone(transaction);
  db.close();
  return formatCatalogNumber(Math.max(highestCatalogSequence(records), Number(setting?.value) || 0) + 1);
}

export async function reserveCatalogNumber() {
  const db = await openDatabase();
  const transaction = db.transaction(["records", "settings"], "readwrite");
  const settings = transaction.objectStore("settings");
  const [records, setting] = await Promise.all([
    requestResult(transaction.objectStore("records").getAll()),
    requestResult(settings.get(CATALOG_SEQUENCE_KEY)),
  ]);
  const next = Math.max(highestCatalogSequence(records), Number(setting?.value) || 0) + 1;
  settings.put({ key: CATALOG_SEQUENCE_KEY, value: next, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  db.close();
  return formatCatalogNumber(next);
}
