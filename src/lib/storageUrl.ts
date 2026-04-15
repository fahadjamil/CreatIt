import { getApiBaseUrl } from "@/lib/env";

const storageBaseUrl = (): string => `${getApiBaseUrl().replace(/\/+$/, "")}/storage`;

/**
 * Turn API image paths into absolute URLs. Passes through http(s), data, and blob URLs.
 */
export function resolveStorageUrl(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(data:|blob:)/i.test(s)) return s;
  const base = storageBaseUrl();
  let path = s.replace(/^\/+/, "");
  path = path.replace(/^storage\/+/i, "");
  return `${base}/${path}`;
}

/**
 * Pick the best display/source string from common upload / media record shapes.
 * Prefers full URLs when present; avoids `??` skipping when `path` is `""`.
 */
export function resolveImageRecordSource(record: unknown): string {
  if (record == null || typeof record !== "object" || Array.isArray(record)) return "";
  const o = record as Record<string, unknown>;
  const keys = ["url", "file_url", "download_url", "path", "src", "filename"] as const;
  for (const k of keys) {
    const v = o[k];
    const str = v != null ? String(v).trim() : "";
    if (str) return str;
  }
  return "";
}
