import { ref, type Ref } from "vue";

/** Session-only profile (avoids large auth cookies). */
export type UserProfile = {
  id?: string | number;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  address?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  province?: string;
  postal_code?: string;
  zip?: string;
  company_name?: string;
  brand_name?: string;
};

const STORAGE_KEY = "createit_user_profile";

/** Reactive copy of stored profile (keeps dashboard + invoice in sync). */
export const currentUserProfile: Ref<UserProfile | null> = ref(null);

function readFromStorage(): UserProfile | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

currentUserProfile.value = readFromStorage();

function unwrapRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const inner = o.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const layer = inner as Record<string, unknown>;
    const nested = layer.data;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return layer;
  }
  if (o.user && typeof o.user === "object" && !Array.isArray(o.user)) {
    return o.user as Record<string, unknown>;
  }
  return o;
}

function pickStr(r: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

/** Normalize API or login payload into UserProfile. */
export function normalizeUserPayload(body: unknown): UserProfile | null {
  let r = unwrapRecord(body);
  if (!r) return null;

  const nestedUser = r.user;
  if (nestedUser && typeof nestedUser === "object" && !Array.isArray(nestedUser)) {
    r = { ...r, ...(nestedUser as Record<string, unknown>) };
  }

  const first = pickStr(r, "first_name", "firstName");
  const last = pickStr(r, "last_name", "lastName");
  const composedName = [first, last].filter(Boolean).join(" ").trim();

  const profile: UserProfile = {
    id: r.id as string | number | undefined,
    name:
      pickStr(r, "name", "full_name", "fullName", "display_name", "displayName") ??
      (composedName || undefined),
    first_name: first,
    last_name: last,
    email: pickStr(r, "email"),
    phone: pickStr(r, "phone", "phone_number", "mobile", "mobile_number"),
    phone_number: pickStr(r, "phone_number", "phone"),
    address: pickStr(r, "address", "address_line1", "street"),
    address_line1: pickStr(r, "address_line1", "address"),
    city: pickStr(r, "city"),
    state: pickStr(r, "state", "province", "region"),
    postal_code: pickStr(r, "postal_code", "zip", "zip_code"),
    company_name: pickStr(r, "company_name", "business_name", "registered_business_name"),
    brand_name: pickStr(r, "brand_name"),
  };

  const hasAny =
    profile.name ||
    profile.email ||
    profile.phone ||
    profile.phone_number ||
    profile.company_name ||
    profile.address ||
    profile.address_line1;

  return hasAny ? profile : null;
}

export function extractUserFromLoginResponse(responseData: unknown): UserProfile | null {
  return normalizeUserPayload(responseData);
}

export function getStoredUserProfile(): UserProfile | null {
  return currentUserProfile.value;
}

export function setStoredUserProfile(profile: UserProfile): void {
  currentUserProfile.value = profile;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore quota / private mode
  }
}

export function clearStoredUserProfile(): void {
  currentUserProfile.value = null;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Multi-line block for invoice "From" / profile display. */
export function formatUserInvoiceBlock(u: UserProfile | null): string {
  if (!u) return "";
  const lines: string[] = [];
  const displayName =
    (u.name && u.name.trim()) ||
    [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
    u.company_name ||
    u.brand_name ||
    "";
  if (displayName) lines.push(displayName);
  const org = u.company_name || u.brand_name;
  if (org && org !== displayName) lines.push(org);
  const addr1 = u.address_line1 || u.address;
  const cityLine = [u.city, u.state, u.postal_code].filter(Boolean).join(", ");
  if (addr1) lines.push(addr1);
  if (cityLine) lines.push(cityLine);
  const em = u.email?.trim();
  if (em) lines.push(em);
  const ph = (u.phone || u.phone_number)?.trim();
  if (ph) lines.push(ph);
  return lines.filter(Boolean).join("\n");
}
