import { computed } from "vue";
import { showColoredToast, type ToastKind } from "@/lib/swToast";

export type AlertKind = ToastKind;

export type AppAlert = {
  id: string;
  kind: AlertKind;
  title?: string;
  message: string;
  createdAt: number;
};

type PushAlertInput = Omit<AppAlert, "id" | "createdAt"> & {
  timeoutMs?: number;
};

/** Legacy: in-app banner list is unused; all alerts use SweetAlert2 colored toasts. */
export function useAlerts() {
  const alerts = computed(() => [] as AppAlert[]);

  const removeAlert = (_id: string) => {
    /* no-op: toasts are not stored in-app */
  };

  const clearAlerts = () => {
    /* no-op */
  };

  const pushAlert = (input: PushAlertInput) => {
    void showColoredToast({
      kind: input.kind,
      title: input.title,
      message: input.message,
      timeoutMs: input.timeoutMs,
    });
    return `toast-${Date.now()}`;
  };

  return { alerts, pushAlert, removeAlert, clearAlerts };
}
