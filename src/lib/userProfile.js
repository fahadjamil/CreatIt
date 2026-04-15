import { ref } from "vue";
const STORAGE_KEY = "createit_user_profile";
/** Reactive copy of stored profile (keeps dashboard + invoice in sync). */
export const currentUserProfile = ref(null);
function readFromStorage() {
    if (typeof sessionStorage === "undefined")
        return null;
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
currentUserProfile.value = readFromStorage();
function unwrapRecord(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        return null;
    const o = body;
    const inner = o.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const layer = inner;
        const nested = layer.data;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            return nested;
        }
        return layer;
    }
    if (o.user && typeof o.user === "object" && !Array.isArray(o.user)) {
        return o.user;
    }
    return o;
}
function pickStr(r, ...keys) {
    for (const k of keys) {
        const v = r[k];
        if (v != null && String(v).trim())
            return String(v).trim();
    }
    return undefined;
}
/** Normalize API or login payload into UserProfile. */
export function normalizeUserPayload(body) {
    let r = unwrapRecord(body);
    if (!r)
        return null;
    const nestedUser = r.user;
    if (nestedUser && typeof nestedUser === "object" && !Array.isArray(nestedUser)) {
        r = { ...r, ...nestedUser };
    }
    const first = pickStr(r, "first_name", "firstName");
    const last = pickStr(r, "last_name", "lastName");
    const composedName = [first, last].filter(Boolean).join(" ").trim();
    const profile = {
        id: r.id,
        name: pickStr(r, "name", "full_name", "fullName", "display_name", "displayName") ??
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
    const hasAny = profile.name ||
        profile.email ||
        profile.phone ||
        profile.phone_number ||
        profile.company_name ||
        profile.address ||
        profile.address_line1;
    return hasAny ? profile : null;
}
export function extractUserFromLoginResponse(responseData) {
    return normalizeUserPayload(responseData);
}
export function getStoredUserProfile() {
    return currentUserProfile.value;
}
export function setStoredUserProfile(profile) {
    currentUserProfile.value = profile;
    if (typeof sessionStorage === "undefined")
        return;
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }
    catch {
        // ignore quota / private mode
    }
}
export function clearStoredUserProfile() {
    currentUserProfile.value = null;
    if (typeof sessionStorage === "undefined")
        return;
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    }
    catch {
        // ignore
    }
}
/** Multi-line block for invoice "From" / profile display. */
export function formatUserInvoiceBlock(u) {
    if (!u)
        return "";
    const lines = [];
    const displayName = (u.name && u.name.trim()) ||
        [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
        u.company_name ||
        u.brand_name ||
        "";
    if (displayName)
        lines.push(displayName);
    const org = u.company_name || u.brand_name;
    if (org && org !== displayName)
        lines.push(org);
    const addr1 = u.address_line1 || u.address;
    const cityLine = [u.city, u.state, u.postal_code].filter(Boolean).join(", ");
    if (addr1)
        lines.push(addr1);
    if (cityLine)
        lines.push(cityLine);
    const em = u.email?.trim();
    if (em)
        lines.push(em);
    const ph = (u.phone || u.phone_number)?.trim();
    if (ph)
        lines.push(ph);
    return lines.filter(Boolean).join("\n");
}
