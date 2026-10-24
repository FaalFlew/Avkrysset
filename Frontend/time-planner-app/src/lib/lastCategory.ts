// src/lib/lastCategory.ts — the category the user picked last (per browser), used as the default
// for new tasks in the editor and for personal copies of tasks whose category isn't theirs.

const LAST_CATEGORY_KEY = "tp-last-category";

export function readLastCategory(): string | null {
  try {
    return localStorage.getItem(LAST_CATEGORY_KEY);
  } catch {
    return null;
  }
}

export function rememberCategory(id: string): void {
  try {
    localStorage.setItem(LAST_CATEGORY_KEY, id);
  } catch {
    /* storage unavailable: the default is just not remembered */
  }
}
