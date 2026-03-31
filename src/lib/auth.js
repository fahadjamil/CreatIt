const AUTH_STORAGE_KEY = "createit_auth_session";
const AUTH_ACCESS_TOKEN_KEY = "createit_access_token";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const safeParse = (value) => {
    if (!value)
        return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
};
const getCookie = (name) => {
    if (typeof document === "undefined")
        return null;
    const key = `${encodeURIComponent(name)}=`;
    const parts = document.cookie ? document.cookie.split("; ") : [];
    for (const part of parts) {
        if (part.startsWith(key)) {
            return decodeURIComponent(part.slice(key.length));
        }
    }
    return null;
};
const setCookie = (name, value, maxAgeSeconds) => {
    if (typeof document === "undefined")
        return;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
};
const clearCookie = (name) => {
    if (typeof document === "undefined")
        return;
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; samesite=lax`;
};
const getAuthSession = () => safeParse(getCookie(AUTH_STORAGE_KEY));
const getAuthToken = () => {
    const session = getAuthSession();
    const sessionToken = session?.accessToken ?? session?.token;
    if (typeof sessionToken === "string" && sessionToken.trim()) {
        return sessionToken.trim();
    }
    const fallback = getCookie(AUTH_ACCESS_TOKEN_KEY);
    return fallback && fallback.trim() ? fallback.trim() : null;
};
const setAuthSession = (session) => {
    setCookie(AUTH_STORAGE_KEY, JSON.stringify(session), AUTH_COOKIE_MAX_AGE_SECONDS);
    const token = session?.accessToken ?? session?.token;
    if (typeof token === "string" && token.trim()) {
        setCookie(AUTH_ACCESS_TOKEN_KEY, token.trim(), AUTH_COOKIE_MAX_AGE_SECONDS);
    }
    else {
        clearCookie(AUTH_ACCESS_TOKEN_KEY);
    }
};
const clearAuthSession = () => {
    clearCookie(AUTH_STORAGE_KEY);
    clearCookie(AUTH_ACCESS_TOKEN_KEY);
};
const isAuthenticated = () => {
    const session = getAuthSession();
    if (!session)
        return false;
    return Boolean(session.token || session.accessToken || session.user);
};
/**
 * Login/register endpoints sometimes return tokens at different nesting levels.
 * Keep this parsing in one place so pages stay simple.
 */
const extractAuthTokens = (responseData) => {
    const data = (responseData ?? null);
    const accessToken = data?.access_token ??
        data?.accessToken ??
        data?.data?.access_token ??
        data?.data?.accessToken ??
        null;
    const token = data?.token ?? data?.data?.token ?? null;
    const refreshToken = data?.refresh_token ??
        data?.refreshToken ??
        data?.data?.refresh_token ??
        data?.data?.refreshToken ??
        null;
    return {
        token: typeof token === "string" && token.trim() ? token.trim() : null,
        accessToken: typeof accessToken === "string" && accessToken.trim() ? accessToken.trim() : null,
        refreshToken: typeof refreshToken === "string" && refreshToken.trim() ? refreshToken.trim() : null,
    };
};
export { AUTH_STORAGE_KEY, AUTH_ACCESS_TOKEN_KEY, getAuthSession, getAuthToken, setAuthSession, clearAuthSession, isAuthenticated, extractAuthTokens, };
