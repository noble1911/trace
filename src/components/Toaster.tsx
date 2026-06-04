import type { ReactNode } from "react";
import { type ToastKind, useToastStore } from "@/app/toast";
import { I } from "./Icon";

const ICON: Record<ToastKind, (p: { size?: number }) => ReactNode> = {
  success: I.Check,
  error: I.X,
  info: I.Activity,
};

// Floating stack of transient notifications, mounted once in the app shell.
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div className="toaster">
      {toasts.map((t) => {
        const Ico = ICON[t.kind];
        return (
          <div key={t.id} className={`toast ${t.kind}`} role="status">
            <span className="toast-ic">
              <Ico size={14} />
            </span>
            <span className="toast-msg">{t.message}</span>
            <button
              type="button"
              className="toast-x"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <I.X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
