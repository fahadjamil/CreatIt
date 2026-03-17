import axios from "axios";

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

const registerUser = (payload: RegisterPayload) =>
  apiClient.post("/api/auth/register", payload);

type PhoneVerificationPayload = {
  phone_number: string;
};

const requestPhoneVerificationCode = (payload: PhoneVerificationPayload) =>
  apiClient.post("/api/auth/phone-verification-code", payload);

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
  registerUser,
  requestPhoneVerificationCode,
};
