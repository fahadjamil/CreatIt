import axios from "axios";
import { getAuthToken } from "@/lib/auth";
import { useAlerts } from "@/composables/useAlerts";

const DEFAULT_API_BASE_URL = "https://dev.createit.pk";
const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
const API_BASE_URL = rawBaseUrl.replace(/\/$/, "");

const buildApiUrl = (path: string) => {
  if (!path) {
    return API_BASE_URL;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

const apiFetch = (path: string, options?: RequestInit) =>
  fetch(buildApiUrl(path), options);

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

const extractMessage = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const anyData = data as any;

  const direct =
    anyData.message ??
    anyData.msg ??
    anyData.detail ??
    anyData.error ??
    anyData.error_message ??
    anyData.success_message;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const nested = anyData.data?.message ?? anyData.data?.msg ?? anyData.data?.error;
  if (typeof nested === "string" && nested.trim()) return nested.trim();

  const errors = anyData.errors ?? anyData.data?.errors;
  if (Array.isArray(errors)) {
    const first = errors.find((x) => typeof x === "string" && x.trim());
    return first ? String(first).trim() : null;
  }
  if (errors && typeof errors === "object") {
    const values = Object.values(errors as Record<string, unknown>);
    for (const v of values) {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (Array.isArray(v)) {
        const first = v.find((x) => typeof x === "string" && x.trim());
        if (first) return String(first).trim();
      }
    }
  }

  return null;
};

apiClient.interceptors.response.use(
  (response) => {
    try {
      const config = response?.config as any;
      if (config?.skipAlert) return response;

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
    } catch {
      // never block API flow
    }
    return response;
  },
  (error) => {
    try {
      const config = (error?.config ?? null) as any;
      if (config?.skipAlert) throw error;

      const data = error?.response?.data;
      const message =
        extractMessage(data) ??
        (typeof error?.message === "string" ? error.message : null) ??
        "Something went wrong. Please try again.";

      const { pushAlert } = useAlerts();
      pushAlert({
        kind: "error",
        title: "Error",
        message,
        timeoutMs: 8000,
      });
    } catch {
      // ignore
    }
    throw error;
  }
);

const registerUser = (payload: RegisterPayload) =>
  apiClient.post("/api/auth/register", payload);

type LoginPayload = {
  email: string;
  password: string;
  device: {
    platform: string;
    device_id: string;
    push_token: string;
  };
};

const loginUser = (payload: LoginPayload) =>
  apiClient.post("/api/auth/login", payload);

type PhoneVerificationPayload = {
  phone_number: string;
  country_name?: string;
  country_iso_code?: string;
};

const requestPhoneVerificationCode = (payload: PhoneVerificationPayload) =>
  apiClient.post("/api/auth/phone-verification-code", payload);

const createProject = (payload: FormData) =>
  apiClient.post("/api/v1/projects", payload, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

const updateProject = (projectId: string | number, payload: FormData) =>
  apiClient.patch(`/api/v1/projects/${projectId}`, payload, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

const getProjects = () => apiClient.get("/api/v1/projects");
const getProjectById = (projectId: string | number) =>
  apiClient.get(`/api/v1/projects/${projectId}`);

type CreateProjectMilestonePayload = {
  title: string;
  deliverables?: string;
  due_on?: string;
  amount?: string | number;
  percentage?: string | number;
  sequence?: number;
  status?: string;
};

const createProjectMilestone = (
  projectId: string | number,
  payload: CreateProjectMilestonePayload,
) => apiClient.post(`/api/v1/projects/${projectId}/milestones`, payload);

const getTags = () => apiClient.get("/api/v1/tags");

type CreateTagPayload = {
  name: string;
  slug: string;
};

const createTag = (payload: CreateTagPayload) =>
  apiClient.post("/api/v1/tags", payload);

const getProjectScopes = () => apiClient.get("/api/v1/project-scopes");

type CreateClientPayload = {
  type: "individual" | "brand";
  status: "active" | "inactive";
  display_name: string;
  brand_name: string;
  email: string;
  phone: string;
  poc_name?: string;
  poc_email?: string;
  poc_phone?: string;
  meta?: {
    notes?: string;
  };
};

const createClient = (payload: CreateClientPayload) =>
  apiClient.post("/api/v1/clients", payload);

const getClients = () => apiClient.get("/api/v1/clients");

const getClientById = (clientId: string | number) =>
  apiClient.get(`/api/v1/clients/${clientId}`);

type RegisterPayload = {
  phone_number: string;
  phone_verification_code: string;
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  device: {
    platform: string;
    device_id: string;
    device_name: string;
    device_model: string;
    os_version: string;
    app_version: string;
    push_token: string;
  };
  kyc: {
    account_type: "creator" | "manager" | "creator_manager";
    skills: {
      content_creation: string[];
      social_media: string[];
    };
  };
};

export {
  API_BASE_URL,
  apiFetch,
  buildApiUrl,
  apiClient,
  loginUser,
  registerUser,
  requestPhoneVerificationCode,
  createProject,
  updateProject,
  getProjects,
  getProjectById,
  createProjectMilestone,
  getTags,
  createTag,
  getProjectScopes,
  createClient,
  getClients,
  getClientById,
};
