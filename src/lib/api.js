import axios from "axios";
import { getAuthToken } from "@/lib/auth";
import { useAlerts } from "@/composables/useAlerts";
const DEFAULT_API_BASE_URL = "https://dev.createit.pk";
const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
const API_BASE_URL = rawBaseUrl.replace(/\/$/, "");
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
const apiFetch = (path, options) => fetch(buildApiUrl(path), options);
const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
});
apiClient.interceptors.request.use((config) => {
    const rawToken = getAuthToken();
    const token = String(rawToken ?? "")
        .replace(/^Bearer\s+/i, "")
        .trim();
    const headers = axios.AxiosHeaders.from(config.headers);
    if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    config.headers = headers;
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
    try {
        const config = (error?.config ?? null);
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
const registerUser = (payload) => apiClient.post("/api/auth/register", payload);
const loginUser = (payload) => apiClient.post("/api/auth/login", payload);
const requestPhoneVerificationCode = (payload) => apiClient.post("/api/auth/phone-verification-code", payload);
const createProject = (payload) => apiClient.post("/api/v1/projects", payload, {
    headers: {
        "Content-Type": "multipart/form-data",
    },
});
const updateProject = (projectId, payload) => apiClient.patch(`/api/v1/projects/${projectId}`, payload, {
    headers: {
        "Content-Type": "multipart/form-data",
    },
});
const getProjects = () => apiClient.get("/api/v1/projects");
const getProjectById = (projectId) => apiClient.get(`/api/v1/projects/${projectId}`);
const createProjectMilestone = (projectId, payload) => apiClient.post(`/api/v1/projects/${projectId}/milestones`, payload);
const getTags = () => apiClient.get("/api/v1/tags");
const createTag = (payload) => apiClient.post("/api/v1/tags", payload);
const getProjectScopes = () => apiClient.get("/api/v1/project-scopes");
const createClient = (payload) => apiClient.post("/api/v1/clients", payload);
const getClients = () => apiClient.get("/api/v1/clients");
const getClientById = (clientId) => apiClient.get(`/api/v1/clients/${clientId}`);
export { API_BASE_URL, apiFetch, buildApiUrl, apiClient, loginUser, registerUser, requestPhoneVerificationCode, createProject, updateProject, getProjects, getProjectById, createProjectMilestone, getTags, createTag, getProjectScopes, createClient, getClients, getClientById, };
