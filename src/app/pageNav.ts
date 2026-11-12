import type { NavId } from "./nav";

// The app's page setter, for code that isn't handed one: a session row's "by …" chip
// opening a scheduled prompt, or a board made from the rail's Boards group showing on
// the Boards page. App registers it once (`useAppNavForOpeners`).

let appNav: ((nav: NavId) => void) | null = null;

/** Register (or, with the same setter, unregister) the app's page setter. */
export function registerPageNav(setNav: ((nav: NavId) => void) | null): void {
  appNav = setNav;
}

/** The registered setter, if App has mounted. */
export function pageNav(): ((nav: NavId) => void) | null {
  return appNav;
}

/** Show a page. A no-op before App has mounted. */
export function goToPage(nav: NavId): void {
  appNav?.(nav);
}
