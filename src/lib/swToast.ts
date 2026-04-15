import Swal from "sweetalert2";

/** Colored toast styling (SweetAlert2 recipe pattern: toast + solid background + light icons/text). */
const tone: Record<
  "success" | "error" | "info" | "warning",
  { background: string; color: string; iconColor: string }
> = {
  success: { background: "#28a745", color: "#ffffff", iconColor: "#ffffff" },
  error: { background: "#dc3545", color: "#ffffff", iconColor: "#ffffff" },
  info: { background: "#17a2b8", color: "#ffffff", iconColor: "#ffffff" },
  warning: { background: "#ffc107", color: "#1a1a1a", iconColor: "#1a1a1a" },
};

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 4500,
  timerProgressBar: true,
});

export type ToastKind = keyof typeof tone;

export function showColoredToast(input: {
  kind: ToastKind;
  title?: string;
  message: string;
  timeoutMs?: number;
}) {
  const icon =
    input.kind === "success"
      ? "success"
      : input.kind === "error"
        ? "error"
        : input.kind === "warning"
          ? "warning"
          : "info";

  const t = tone[input.kind];
  const timer = input.timeoutMs ?? (input.kind === "error" ? 8000 : 4500);
  const defaultTitle =
    input.kind === "success" ? "Success" : input.kind === "error" ? "Error" : "Notice";

  const title = (input.title ?? "").trim() || defaultTitle;
  const text = (input.message ?? "").trim();

  return Toast.fire({
    icon,
    iconColor: t.iconColor,
    title,
    text: text || undefined,
    background: t.background,
    color: t.color,
    timer,
  });
}
