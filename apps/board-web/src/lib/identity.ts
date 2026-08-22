const PERSON_ID_KEY = "gambi.board.person-id";
export const PERSON_NAME_KEY = "gambi.board.person-name";

export function getPersonId() {
  const existing = window.localStorage.getItem(PERSON_ID_KEY);
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  window.localStorage.setItem(PERSON_ID_KEY, created);
  return created;
}

export function getStoredName() {
  return window.localStorage.getItem(PERSON_NAME_KEY) ?? "";
}

export function storeName(name: string) {
  window.localStorage.setItem(PERSON_NAME_KEY, name.trim());
}
