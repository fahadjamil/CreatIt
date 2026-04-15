import { computed } from "vue";
import { showColoredToast } from "@/lib/swToast";
/** Legacy: in-app banner list is unused; all alerts use SweetAlert2 colored toasts. */
export function useAlerts() {
    const alerts = computed(() => []);
    const removeAlert = (_id) => {
        /* no-op: toasts are not stored in-app */
    };
    const clearAlerts = () => {
        /* no-op */
    };
    const pushAlert = (input) => {
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
