import { computed, reactive } from "vue";
const state = reactive({
    alerts: [],
});
const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function useAlerts() {
    const alerts = computed(() => state.alerts);
    const removeAlert = (id) => {
        const idx = state.alerts.findIndex((a) => a.id === id);
        if (idx >= 0)
            state.alerts.splice(idx, 1);
    };
    const clearAlerts = () => {
        state.alerts.splice(0, state.alerts.length);
    };
    const pushAlert = (input) => {
        const alert = {
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
