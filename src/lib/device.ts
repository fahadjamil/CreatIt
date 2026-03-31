const DEVICE_ID_STORAGE_KEY = "createit_device_id";

const getPersistentDeviceId = (): string => {
  try {
    if (typeof localStorage === "undefined") {
      return `device-${Date.now()}`;
    }
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const nextId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `device-${Date.now()}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return `device-${Date.now()}`;
  }
};

const getBrowserMetadata = () => {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const ua = nav?.userAgent ?? "unknown";
  const platform = nav?.platform ?? "web";
  const language = nav?.language ?? "unknown";
  const deviceMemory = nav && "deviceMemory" in nav ? String(nav.deviceMemory) : "n/a";
  const cores = nav?.hardwareConcurrency ? String(nav.hardwareConcurrency) : "n/a";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const screenSize =
    typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "unknown";

  return {
    ua,
    platform,
    language,
    deviceMemory,
    cores,
    timezone,
    screenSize,
  };
};

const getLoginDevicePayload = () => {
  const meta = getBrowserMetadata();
  return {
    platform: meta.platform,
    device_id: getPersistentDeviceId(),
    push_token: "web_push_token_not_set",
  };
};

const getRegisterDevicePayload = () => {
  const meta = getBrowserMetadata();
  return {
    platform: meta.platform,
    device_id: getPersistentDeviceId(),
    device_name: `Browser ${meta.platform}`.slice(0, 120),
    device_model: `${meta.ua} | ${meta.screenSize}`.slice(0, 255),
    os_version: `${meta.platform}; ${meta.language}; ${meta.timezone}`.slice(0, 120),
    app_version: "web-1.0.0",
    push_token: "web_push_token_not_set",
  };
};

export { getLoginDevicePayload, getRegisterDevicePayload };
