import axios from "axios";
import { getAuthToken, redirectToLoginAfterSessionExpired } from "@/lib/auth";
import { useAlerts } from "@/composables/useAlerts";
import { getApiBaseUrl } from "@/lib/env";
const API_BASE_URL = getApiBaseUrl();
const buildApiUrl = (path) => {
    if (!path) {
        return API_BASE_URL;
    }
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${API_BASE_URL}${normalizedPath}`;
};
const apiFetch = async (path, options) => {
    const url = buildApiUrl(path);
    const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
        console.groupCollapsed(`[API] FETCH ${url}`);
        if (options?.method)
            console.log("Method:", options.method);
        if (options?.body !== undefined)
            console.log("Payload:", previewPayload(options.body));
        console.log("RequestId:", requestId);
        console.groupEnd();
    }
    catch {
        // ignore
    }
    const startedAt = typeof performance !== "undefined" ? performance.now() : null;
    try {
        const res = await fetch(url, options);
        try {
            const ms = typeof startedAt === "number" && typeof performance !== "undefined"
                ? Math.round(performance.now() - startedAt)
                : null;
            const cloned = res.clone();
            let preview = null;
            const ct = cloned.headers.get("content-type") || "";
            if (/application\/json/i.test(ct)) {
                preview = await cloned.json();
            }
            else if (/text\//i.test(ct) || /application\/(xml|html)/i.test(ct)) {
                const t = (await cloned.text()).trim();
                preview = t.length > 2000 ? `${t.slice(0, 2000)}…` : t;
            }
            else {
                preview = { contentType: ct || null, status: cloned.status };
            }
            console.groupCollapsed(`[API] FETCH ${url} → ${res.status}${ms != null ? ` (${ms}ms)` : ""}`);
            console.log("RequestId:", requestId);
            console.log("Response:", preview);
            console.groupEnd();
        }
        catch {
            // ignore
        }
        return res;
    }
    catch (err) {
        try {
            const ms = typeof startedAt === "number" && typeof performance !== "undefined"
                ? Math.round(performance.now() - startedAt)
                : null;
            console.groupCollapsed(`[API] FETCH ${url} → ERROR${ms != null ? ` (${ms}ms)` : ""}`);
            console.log("RequestId:", requestId);
            console.log("Error message:", err?.message);
            console.groupEnd();
        }
        catch {
            // ignore
        }
        throw err;
    }
};
const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
});
function previewPayload(payload) {
    if (payload instanceof FormData)
        return previewFormData(payload);
    if (typeof Blob !== "undefined" && payload instanceof Blob) {
        return { type: "blob", size: payload.size, mime: payload.type };
    }
    return payload;
}
function previewResponseData(data) {
    if (typeof Blob !== "undefined" && data instanceof Blob) {
        return { type: "blob", size: data.size, mime: data.type };
    }
    return data;
}
function buildFullRequestUrl(config) {
    const baseURL = String(config?.baseURL ?? API_BASE_URL ?? "");
    const url = String(config?.url ?? "");
    if (!url)
        return baseURL || "";
    if (/^https?:\/\//i.test(url))
        return url;
    const base = baseURL.replace(/\/$/, "");
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${base}${path}`;
}
apiClient.interceptors.request.use((config) => {
    const rawToken = getAuthToken();
    const token = String(rawToken ?? "")
        .replace(/^Bearer\s+/i, "")
        .trim();
    const headers = axios.AxiosHeaders.from(config.headers);
    if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    // Let axios set multipart boundary; our default Content-Type is application/json.
    if (config.data instanceof FormData) {
        headers.delete("Content-Type");
    }
    config.headers = headers;
    try {
        const anyConfig = config;
        const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        anyConfig.__apiLog = { requestId, startedAt: performance.now() };
        const method = String(anyConfig?.method ?? "get").toUpperCase();
        const fullUrl = buildFullRequestUrl(anyConfig);
        console.groupCollapsed(`[API] ${method} ${fullUrl}`);
        if (anyConfig?.params != null)
            console.log("Params:", anyConfig.params);
        if (anyConfig?.data !== undefined)
            console.log("Payload:", previewPayload(anyConfig.data));
        console.log("RequestId:", requestId);
        console.groupEnd();
    }
    catch {
        // never block API flow
    }
    return config;
});
const extractMessage = (data) => {
    if (!data || typeof data !== "object")
        return null;
    const anyData = data;
    const direct = anyData.message ??
        anyData.msg ??
        anyData.detail ??
        anyData.error ??
        anyData.error_message ??
        anyData.success_message;
    if (typeof direct === "string" && direct.trim())
        return direct.trim();
    const nested = anyData.data?.message ?? anyData.data?.msg ?? anyData.data?.error;
    if (typeof nested === "string" && nested.trim())
        return nested.trim();
    const errors = anyData.errors ?? anyData.data?.errors;
    if (Array.isArray(errors)) {
        const first = errors.find((x) => typeof x === "string" && x.trim());
        return first ? String(first).trim() : null;
    }
    if (errors && typeof errors === "object") {
        const values = Object.values(errors);
        for (const v of values) {
            if (typeof v === "string" && v.trim())
                return v.trim();
            if (Array.isArray(v)) {
                const first = v.find((x) => typeof x === "string" && x.trim());
                if (first)
                    return String(first).trim();
            }
        }
    }
    return null;
};
/**
 * Axios error `response.data` is often a Blob when `responseType: "blob"` was used on the request.
 * This reads JSON/text from that blob so we can show the API message instead of a generic failure.
 */
async function extractMessageFromAxiosErrorData(data) {
    if (data == null)
        return null;
    if (typeof Blob !== "undefined" && data instanceof Blob) {
        if (data.size === 0)
            return null;
        try {
            const text = await data.text();
            try {
                return extractMessage(JSON.parse(text));
            }
            catch {
                const t = text.trim();
                return t ? t.slice(0, 500) : null;
            }
        }
        catch {
            return null;
        }
    }
    if (typeof data === "object")
        return extractMessage(data);
    return null;
}
/** Normalize relative API/storage paths to an absolute URL for fetch/axios. */
function resolveInvoicePdfHttpUrl(candidate) {
    const t = candidate.trim();
    if (/^https?:\/\//i.test(t))
        return t;
    if (t.startsWith("/"))
        return buildApiUrl(t);
    return buildApiUrl(`/${t}`);
}
/**
 * Walks common API response shapes for the same hosted PDF URLs used on the project invoice screen
 * (`pdf_url`, `static_pdf_url`, etc.).
 */
function extractInvoicePdfUrlFromResponseBody(body) {
    const seen = new Set();
    const walk = (node) => {
        if (node == null || typeof node !== "object" || seen.has(node))
            return null;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) {
                const u = walk(item);
                if (u)
                    return u;
            }
            return null;
        }
        const o = node;
        const keys = [
            "static_pdf_url",
            "staticPdfUrl",
            "pdf_url",
            "pdfUrl",
            "invoice_pdf_url",
            "invoicePdfUrl",
        ];
        for (const k of keys) {
            const v = o[k];
            if (typeof v === "string") {
                const s = v.trim();
                if (s && (/^https?:\/\//i.test(s) || s.startsWith("/")))
                    return resolveInvoicePdfHttpUrl(s);
            }
        }
        for (const v of Object.values(o)) {
            if (v && typeof v === "object") {
                const u = walk(v);
                if (u)
                    return u;
            }
        }
        return null;
    };
    return walk(body);
}
function invoicePdfUrlIsSameOriginAsApi(absUrl) {
    try {
        const u = new URL(absUrl);
        const base = new URL(API_BASE_URL);
        return u.origin === base.origin;
    }
    catch {
        return false;
    }
}
/**
 * Loads a PDF from a backend-hosted URL (S3 or same-origin with Bearer), matching the Download path
 * on the project invoice tab when `pdf_url` / `static_pdf_url` is set.
 */
async function fetchInvoicePdfBlobFromUrl(resolvedUrl) {
    const full = resolveInvoicePdfHttpUrl(resolvedUrl).trim();
    if (!full)
        return null;
    try {
        if (invoicePdfUrlIsSameOriginAsApi(full)) {
            const u = new URL(full);
            const pathQuery = `${u.pathname}${u.search}`;
            const res = await apiClient.get(pathQuery, {
                responseType: "blob",
                skipAlert: true,
            });
            const blob = res.data;
            return blob && blob.size > 0 ? blob : null;
        }
        const r = await fetch(full, { mode: "cors" });
        if (!r.ok)
            return null;
        const blob = await r.blob();
        return blob && blob.size > 0 ? blob : null;
    }
    catch {
        return null;
    }
}
function findPdfHeaderOffset(bytes) {
    let i = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
        i = 3;
    while (i < bytes.length &&
        (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
        i++;
    }
    if (i + 4 <= bytes.length &&
        bytes[i] === 0x25 &&
        bytes[i + 1] === 0x50 &&
        bytes[i + 2] === 0x44 &&
        bytes[i + 3] === 0x46) {
        return i;
    }
    for (let j = 0; j <= bytes.length - 4; j++) {
        if (bytes[j] === 0x25 &&
            bytes[j + 1] === 0x50 &&
            bytes[j + 2] === 0x44 &&
            bytes[j + 3] === 0x46) {
            return j;
        }
    }
    return -1;
}
/**
 * Confirms a response body is a PDF (magic bytes) or surfaces JSON/text errors when the server
 * mislabels error bodies (common with `responseType: "blob"`).
 */
async function interpretInvoicePdfBlob(blob) {
    if (!blob || blob.size === 0) {
        return { kind: "error", message: "The server returned an empty PDF." };
    }
    const scanLen = Math.min(blob.size, 65536);
    const bytes = new Uint8Array(await blob.slice(0, scanLen).arrayBuffer());
    const pdfOffset = findPdfHeaderOffset(bytes);
    if (pdfOffset >= 0) {
        const trimmed = pdfOffset === 0 ? blob : blob.slice(pdfOffset);
        return { kind: "pdf", blob: trimmed };
    }
    let message = "Could not load the invoice PDF.";
    try {
        const text = await blob.text();
        try {
            message = extractMessage(JSON.parse(text)) || message;
        }
        catch {
            const t = text.trim();
            if (t)
                message = t.length > 280 ? `${t.slice(0, 280)}…` : t;
        }
    }
    catch {
        /* keep default */
    }
    return { kind: "error", message };
}
apiClient.interceptors.response.use((response) => {
    try {
        const anyConfig = (response?.config ?? null);
        const method = String(anyConfig?.method ?? "get").toUpperCase();
        const fullUrl = buildFullRequestUrl(anyConfig);
        const requestId = anyConfig?.__apiLog?.requestId;
        const startedAt = anyConfig?.__apiLog?.startedAt;
        const ms = typeof startedAt === "number" && typeof performance !== "undefined"
            ? Math.round(performance.now() - startedAt)
            : null;
        console.groupCollapsed(`[API] ${method} ${fullUrl} → ${response?.status}${ms != null ? ` (${ms}ms)` : ""}`);
        if (requestId)
            console.log("RequestId:", requestId);
        if (anyConfig?.params != null)
            console.log("Params:", anyConfig.params);
        if (anyConfig?.data !== undefined)
            console.log("Payload:", previewPayload(anyConfig.data));
        console.log("Response:", previewResponseData(response?.data));
        console.groupEnd();
    }
    catch {
        // never block API flow
    }
    return response;
}, (error) => {
    try {
        const anyConfig = (error?.config ?? null);
        const method = String(anyConfig?.method ?? "get").toUpperCase();
        const fullUrl = buildFullRequestUrl(anyConfig);
        const requestId = anyConfig?.__apiLog?.requestId;
        const startedAt = anyConfig?.__apiLog?.startedAt;
        const ms = typeof startedAt === "number" && typeof performance !== "undefined"
            ? Math.round(performance.now() - startedAt)
            : null;
        const status = error?.response?.status;
        console.groupCollapsed(`[API] ${method} ${fullUrl} → ERROR${status != null ? ` ${status}` : ""}${ms != null ? ` (${ms}ms)` : ""}`);
        if (requestId)
            console.log("RequestId:", requestId);
        if (anyConfig?.params != null)
            console.log("Params:", anyConfig.params);
        if (anyConfig?.data !== undefined)
            console.log("Payload:", previewPayload(anyConfig.data));
        console.log("Error message:", error?.message);
        console.log("Response:", previewResponseData(error?.response?.data));
        console.groupEnd();
    }
    catch {
        // never block API flow
    }
    return Promise.reject(error);
});
apiClient.interceptors.response.use((response) => {
    try {
        const config = response?.config;
        if (config?.skipAlert)
            return response;
        const method = String(config?.method ?? "get").toLowerCase();
        const message = extractMessage(response?.data);
        if (message) {
            const { pushAlert } = useAlerts();
            pushAlert({
                kind: "success",
                title: method === "get" ? "Success" : "Done",
                message,
            });
        }
    }
    catch {
        // never block API flow
    }
    return response;
}, (error) => {
    const config = (error?.config ?? null);
    const status = error?.response?.status;
    if (status === 401) {
        const headers = config?.headers;
        const authHeader = (typeof headers?.get === "function"
            ? headers.get("Authorization") ?? headers.get("authorization")
            : undefined) ??
            config?.headers?.Authorization ??
            config?.headers?.authorization;
        if (authHeader) {
            redirectToLoginAfterSessionExpired();
            return Promise.reject(error);
        }
    }
    try {
        if (config?.skipAlert)
            throw error;
        const data = error?.response?.data;
        const message = extractMessage(data) ??
            (typeof error?.message === "string" ? error.message : null) ??
            "Something went wrong. Please try again.";
        const { pushAlert } = useAlerts();
        pushAlert({
            kind: "error",
            title: "Error",
            message,
            timeoutMs: 8000,
        });
    }
    catch {
        // ignore
    }
    throw error;
});
const registerUser = (payload, options) => apiClient.post("/api/auth/register", payload, {
    ...(options?.skipAlert ? { skipAlert: true } : {}),
});
const loginUser = (payload, options) => apiClient.post("/api/auth/login", payload, {
    ...(options?.skipAlert ? { skipAlert: true } : {}),
});
/** Current user profile (Bearer auth). Adjust path if your API differs (e.g. `/api/user`). */
const getCurrentUser = () => apiClient.get("/api/v1/user", { skipAlert: true });
const requestPhoneVerificationCode = (payload) => apiClient.post("/api/auth/phone-verification-code", payload);
const requestForgotPassword = (payload) => apiClient.post("/api/auth/forgot-password", payload);
function previewFormData(payload) {
    if (!(payload instanceof FormData))
        return payload;
    return Array.from(payload.entries()).map(([key, value]) => {
        if (value instanceof File) {
            return { key, type: "file", name: value.name, size: value.size, mime: value.type };
        }
        return { key, type: "text", value };
    });
}
const createProject = (payload, options) => apiClient.post("/api/v1/projects", payload, {
    headers: {
        "Content-Type": "multipart/form-data",
    },
    ...(options?.skipAlert ? { skipAlert: true } : {}),
}).then((res) => {
    console.groupCollapsed("[API] POST /api/v1/projects");
    console.log("Payload:", previewFormData(payload));
    console.log("Status:", res?.status);
    console.log("Data:", res?.data);
    console.groupEnd();
    return res;
}).catch((err) => {
    console.groupCollapsed("[API] POST /api/v1/projects (error)");
    console.log("Payload:", previewFormData(payload));
    console.error(err);
    console.log("Response status:", err?.response?.status);
    console.log("Response data:", err?.response?.data);
    console.groupEnd();
    throw err;
});
const updateProject = (projectId, payload, options) => apiClient.patch(`/api/v1/projects/${projectId}`, payload, {
    headers: {
        "Content-Type": "multipart/form-data",
    },
    ...(options?.skipAlert ? { skipAlert: true } : {}),
}).then((res) => {
    console.groupCollapsed(`[API] PATCH /api/v1/projects/${projectId}`);
    console.log("Payload:", previewFormData(payload));
    console.log("Status:", res?.status);
    console.log("Data:", res?.data);
    console.groupEnd();
    return res;
}).catch((err) => {
    console.groupCollapsed(`[API] PATCH /api/v1/projects/${projectId} (error)`);
    console.log("Payload:", previewFormData(payload));
    console.error(err);
    console.log("Response status:", err?.response?.status);
    console.log("Response data:", err?.response?.data);
    console.groupEnd();
    throw err;
});
/** Normalizes POST /api/v1/uploads/images JSON to uploaded file ids (order preserved). */
function extractUploadedImageIds(body) {
    if (!body || typeof body !== "object")
        return [];
    const anyBody = body;
    const fromArr = (v) => (Array.isArray(v) ? v : []);
    let list = [];
    if (anyBody.data != null && typeof anyBody.data === "object" && !Array.isArray(anyBody.data)) {
        const inner = anyBody.data.data;
        list = fromArr(inner);
    }
    if (!list.length)
        list = fromArr(anyBody.data);
    if (!list.length)
        list = fromArr(anyBody.images);
    if (!list.length)
        list = fromArr(anyBody.uploads);
    return list
        .map((x) => {
        const o = x;
        if (!o || typeof o !== "object")
            return "";
        const id = o.id ?? o.uuid;
        return id == null ? "" : String(id).trim();
    })
        .filter(Boolean);
}
const uploadImages = (payload) => apiClient.post("/api/v1/uploads/images", payload, {
    // avoid global success toast; upload is a pre-step
    ...{ skipAlert: true },
}).then((res) => {
    console.groupCollapsed("[API] POST /api/v1/uploads/images");
    console.log("Payload:", previewFormData(payload));
    console.log("Status:", res?.status);
    console.log("Data:", res?.data);
    console.groupEnd();
    return res;
}).catch((err) => {
    console.groupCollapsed("[API] POST /api/v1/uploads/images (error)");
    console.log("Payload:", previewFormData(payload));
    console.error(err);
    console.log("Response status:", err?.response?.status);
    console.log("Response data:", err?.response?.data);
    console.groupEnd();
    throw err;
});
const getProjects = () => apiClient.get("/api/v1/projects");
const getProjectById = (projectId) => apiClient.get(`/api/v1/projects/${projectId}`, { skipAlert: true })
    .then((res) => {
    console.groupCollapsed(`[API] GET /api/v1/projects/${projectId}`);
    console.log("Status:", res?.status);
    console.log("Data:", res?.data);
    console.groupEnd();
    return res;
})
    .catch((err) => {
    console.groupCollapsed(`[API] GET /api/v1/projects/${projectId} (error)`);
    console.error(err);
    console.log("Response status:", err?.response?.status);
    console.log("Response data:", err?.response?.data);
    console.groupEnd();
    throw err;
});
/**
 * Dashboard summary: current balance + recent projects/transactions.
 * Backend response shape observed:
 * `{ ok: true, data: { current_balance, projects, transactions } }`
 */
const getDashboard = () => apiClient.get("/api/v1/dashboard", {
    skipAlert: true,
});
/**
 * Smartlane account statement: full transaction list for Accounts tab.
 * Expected to return a list (shape may vary), so UI normalizes.
 */
const getAccountStatement = () => apiClient.get("/api/v1/smartlane/account/statement", { skipAlert: true });
/** Weekly/monthly/quarterly runs + amount_per_run for recurring projects (saved project state). */
const getProjectRecurrenceOptions = (projectId) => apiClient.get(`/api/v1/projects/${projectId}/recurrence-options`, {
    skipAlert: true,
});
const createProjectMilestone = (projectId, payload) => apiClient.post(`/api/v1/projects/${projectId}/milestones`, payload);
const sendProjectMilestoneToClient = (projectId, milestoneId, payload) => apiClient.post(`/api/v1/projects/${projectId}/milestones/${milestoneId}/send-to-client`, payload, {
    ...{ skipAlert: true },
});
const updateProjectMilestoneStatus = (projectId, milestoneId, payload) => apiClient.patch(`/api/v1/projects/${projectId}/milestones/${milestoneId}/status`, payload, {
    ...{ skipAlert: true },
});
const getTags = () => apiClient.get("/api/v1/tags");
const createTag = (payload) => apiClient.post("/api/v1/tags", payload);
const getProjectScopes = () => apiClient.get("/api/v1/project-scopes");
const createClient = (payload, options) => apiClient.post("/api/v1/clients", payload, {
    ...(options?.skipAlert ? { skipAlert: true } : {}),
});
const getClients = () => apiClient.get("/api/v1/clients").then((res) => {
    console.log("[getClients] GET /api/v1/clients", res.data);
    return res;
});
const getClientById = (clientId) => apiClient.get(`/api/v1/clients/${clientId}`);
const updateClient = (clientId, payload, options) => apiClient.patch(`/api/v1/clients/${clientId}`, payload, {
    ...(options?.skipAlert ? { skipAlert: true } : {}),
});
const updateInvoiceFollowUp = (invoiceId, payload) => apiClient.patch(`/api/v1/invoices/${invoiceId}`, payload);
/**
 * PATCH /api/v1/invoices/:id/status
 * This endpoint is expected to accept JSON (status + optional payment metadata).
 */
const updateInvoiceStatus = (invoiceId, payload) => apiClient.patch(`/api/v1/invoices/${invoiceId}/status`, payload);
/** POST /api/v1/invoices/{id}/issue — body is JSON with the terms template id (custom-created or existing). */
const issueInvoice = (invoiceId, payload, options) => apiClient
    .post(`/api/v1/invoices/${invoiceId}/issue`, payload, {
    ...(options?.skipAlert ? { skipAlert: true } : {}),
})
    .then((res) => {
    console.groupCollapsed(`[API] POST /api/v1/invoices/${invoiceId}/issue`);
    console.log("Payload:", payload);
    console.log("Status:", res?.status);
    console.log("Data:", res?.data);
    console.groupEnd();
    return res;
})
    .catch((err) => {
    console.groupCollapsed(`[API] POST /api/v1/invoices/${invoiceId}/issue (error)`);
    console.log("Payload:", payload);
    console.error(err);
    console.log("Response status:", err?.response?.status);
    console.log("Response data:", err?.response?.data);
    console.groupEnd();
    throw err;
});
/**
 * Normalizes GET /api/v1/invoice-terms-templates body to a template array.
 * Handles many common API shapes:
 * - `[ ... ]`
 * - `{ data: [ ... ] }`
 * - `{ data: { data: [ ... ] } }`
 * - `{ invoice_terms_templates: [ ... ] }`
 * - `{ invoiceTermsTemplates: [ ... ] }`
 * - `{ templates: [ ... ] }`
 * - `{ ok/success: true, data: { invoice_terms_templates: [ ... ] } }`
 */
export function extractInvoiceTermsTemplatesList(body) {
    if (Array.isArray(body))
        return body;
    if (!body || typeof body !== "object")
        return [];
    const o = body;
    const directCandidates = [
        o.data,
        o.invoice_terms_templates,
        o.invoiceTermsTemplates,
        o.templates,
        o?.result,
    ];
    for (const c of directCandidates) {
        if (Array.isArray(c))
            return c;
    }
    // nested data layers
    const layer = o.data;
    if (layer && typeof layer === "object" && !Array.isArray(layer)) {
        const inner = layer;
        const nestedCandidates = [
            inner.data,
            inner.invoice_terms_templates,
            inner.invoiceTermsTemplates,
            inner.templates,
            inner.result,
        ];
        for (const c of nestedCandidates) {
            if (Array.isArray(c))
                return c;
            if (c && typeof c === "object" && !Array.isArray(c)) {
                const deep = c;
                if (Array.isArray(deep.data))
                    return deep.data;
            }
        }
    }
    return [];
}
const getInvoiceTermsTemplates = () => apiClient.get("/api/v1/invoice-terms-templates", {
    skipAlert: true,
});
const createInvoiceTermsTemplate = (payload, options) => apiClient
    .post("/api/v1/invoice-terms-templates", payload, {
    ...(options?.skipAlert ? { skipAlert: true } : {}),
})
    .then((res) => {
    console.groupCollapsed("[API] POST /api/v1/invoice-terms-templates");
    console.log("Payload:", payload);
    console.log("Status:", res?.status);
    console.log("Data:", res?.data);
    console.groupEnd();
    return res;
})
    .catch((err) => {
    console.groupCollapsed("[API] POST /api/v1/invoice-terms-templates (error)");
    console.log("Payload:", payload);
    console.error(err);
    console.log("Response status:", err?.response?.status);
    console.log("Response data:", err?.response?.data);
    console.groupEnd();
    throw err;
});
const patchInvoice = (invoiceId, payload, options) => apiClient.patch(`/api/v1/invoices/${invoiceId}`, payload, {
    ...(options?.skipAlert ? { skipAlert: true } : {}),
});
function expandInvoicePdfPathTemplate(template, invoiceId) {
    return template.replace(/\{id\}/gi, invoiceId);
}
/** Ordered candidates when the API has no `GET .../pdf` route (404). Override with `VITE_INVOICE_PDF_PATH`. */
function invoicePdfStreamPaths(invoiceId) {
    const id = String(invoiceId);
    const custom = String(import.meta.env.VITE_INVOICE_PDF_PATH ?? "").trim();
    if (custom)
        return [expandInvoicePdfPathTemplate(custom, id)];
    return [`/api/v1/invoices/${id}/download`, `/api/v1/invoices/${id}/pdf`];
}
/**
 * Binary PDF stream. Tries `/download` then `/pdf` unless `VITE_INVOICE_PDF_PATH` is set.
 * Only advances to the next path on HTTP 404 so real errors (403/500) surface immediately.
 */
const getInvoicePdf = async (invoiceId) => {
    const paths = invoicePdfStreamPaths(invoiceId);
    let lastErr;
    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        try {
            return await apiClient.get(path, {
                responseType: "blob",
                skipAlert: true,
            });
        }
        catch (e) {
            lastErr = e;
            const status = e?.response?.status;
            if (status === 404 && i < paths.length - 1)
                continue;
            throw e;
        }
    }
    throw lastErr;
};
const PDF_FETCH_RETRY_STATUSES = new Set([404, 425, 503]);
/** Retries when the PDF is not ready immediately after issue (async generation). */
async function getInvoicePdfWithRetry(invoiceId, options) {
    const attempts = Math.max(1, options?.attempts ?? 4);
    const delayMs = Math.max(0, options?.delayMs ?? 500);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await getInvoicePdf(invoiceId);
        }
        catch (e) {
            lastErr = e;
            const status = e?.response?.status;
            if (status != null && PDF_FETCH_RETRY_STATUSES.has(status) && i < attempts - 1) {
                await new Promise((r) => setTimeout(r, delayMs));
                continue;
            }
            throw e;
        }
    }
    throw lastErr;
}
const getCalendar = (params) => apiClient.get("/api/v1/calendar", {
    params,
    ...{ skipAlert: true },
});
export { extractMessage, extractMessageFromAxiosErrorData, extractInvoicePdfUrlFromResponseBody, fetchInvoicePdfBlobFromUrl, interpretInvoicePdfBlob, getInvoicePdfWithRetry, extractUploadedImageIds, API_BASE_URL, apiFetch, buildApiUrl, apiClient, loginUser, getCurrentUser, registerUser, requestPhoneVerificationCode, requestForgotPassword, uploadImages, createProject, updateProject, getDashboard, getAccountStatement, getProjects, getProjectById, getProjectRecurrenceOptions, createProjectMilestone, sendProjectMilestoneToClient, updateProjectMilestoneStatus, getTags, createTag, getProjectScopes, createClient, getClients, getClientById, updateClient, updateInvoiceFollowUp, updateInvoiceStatus, issueInvoice, getInvoicePdf, getCalendar, getInvoiceTermsTemplates, createInvoiceTermsTemplate, patchInvoice, };
