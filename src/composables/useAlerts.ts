import { computed, reactive } from "vue";

export type AlertKind = "success" | "error" | "info";

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

const state = reactive({
  alerts: [] as AppAlert[],
});

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function useAlerts() {
  const alerts = computed(() => state.alerts);

  const removeAlert = (id: string) => {
    const idx = state.alerts.findIndex((a) => a.id === id);
    if (idx >= 0) state.alerts.splice(idx, 1);
  };

  const clearAlerts = () => {
    state.alerts.splice(0, state.alerts.length);
  };

  const pushAlert = (input: PushAlertInput) => {
    const alert: AppAlert = {
      id: makeId(),
      kind: input.kind,
      title: input.title,
      message: input.message,
      createdAt: Date.now(),
    };
    state.alerts.unshift(alert);

    const timeoutMs = input.timeoutMs ?? (input.kind === "error" ? 7000 : 4500);
    if (timeoutMs > 0) {
      window.setTimeout(() => removeAlert(alert.id), timeoutMs);
    }

    return alert.id;
  };

  return { alerts, pushAlert, removeAlert, clearAlerts };
}

