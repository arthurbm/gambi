const PERSON_ID_KEY = "gambi.board.person-id";
export const PERSON_NAME_KEY = "gambi.board.person-name";

function createPersonId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) % 16) + 64;
  bytes[8] = ((bytes[8] ?? 0) % 64) + 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

export function getPersonId() {
  const existing = window.localStorage.getItem(PERSON_ID_KEY);
  if (existing) {
    return existing;
  }
  const created = createPersonId();
  window.localStorage.setItem(PERSON_ID_KEY, created);
  return created;
}

export function getStoredName() {
  return window.localStorage.getItem(PERSON_NAME_KEY) ?? "";
}

export function storeName(name: string) {
  window.localStorage.setItem(PERSON_NAME_KEY, name.trim());
}
