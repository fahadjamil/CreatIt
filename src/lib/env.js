const stripTrailingSlash = (url) => url.replace(/\/$/, "");
export function getApiBaseUrl() {
    const mode = String(import.meta.env.VITE_API_ENV ?? "dev")
        .trim()
        .toLowerCase();
    const dev = String(import.meta.env.VITE_API_BASE_URL_DEV ?? "https://dev.createit.pk").trim();
    const local = String(import.meta.env.VITE_API_BASE_URL_LOCAL ?? "").trim();
    const selected = mode === "local" ? local : dev;
    return stripTrailingSlash(selected || dev);
}
