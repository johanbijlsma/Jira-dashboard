function decodeBase64(value) {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(value);
  }
  return Buffer.from(value, "base64").toString("utf8");
}

export function getBasicAuthConfig(env = process.env) {
  const username = String(env.DASHBOARD_BASIC_AUTH_USER || "").trim();
  const password = String(env.DASHBOARD_BASIC_AUTH_PASSWORD || "");
  return {
    enabled: Boolean(username && password),
    username,
    password,
  };
}

export function parseBasicAuthHeader(headerValue) {
  const header = String(headerValue || "");
  if (!header.startsWith("Basic ")) return null;
  const encoded = header.slice("Basic ".length).trim();
  if (!encoded) return null;

  try {
    const decoded = decodeBase64(encoded);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function isAuthorizedBasicAuth(headerValue, env = process.env) {
  const config = getBasicAuthConfig(env);
  if (!config.enabled) return true;

  const credentials = parseBasicAuthHeader(headerValue);
  if (!credentials) return false;

  return credentials.username === config.username && credentials.password === config.password;
}
