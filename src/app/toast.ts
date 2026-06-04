import { create } from "zustand";

// Transient, app-global notifications (e.g. board move succeeded / failed). Kept
// here in the app shell rather than a domain because any feature can raise one.

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => number;
  dismiss: (id: number) => void;
}

// Monotonic id — module-level so it survives store re-creation in dev HMR.
let nextId = 1;

// Errors linger longer (they're actionable); success/info auto-clear quickly.
const TTL: Record<ToastKind, number> = { error: 7000, success: 3000, info: 4000 };

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push(kind, message) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TTL[kind]);
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// Imperative helpers for non-component code (stores, async handlers).
export const toast = {
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
  info: (message: string) => useToastStore.getState().push("info", message),
};
