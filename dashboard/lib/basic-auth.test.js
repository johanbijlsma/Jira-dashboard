import { describe, expect, it } from "vitest";

import { getBasicAuthConfig, isAuthorizedBasicAuth, parseBasicAuthHeader } from "./basic-auth";

describe("basic-auth helpers", () => {
  it("stays disabled when credentials are not configured", () => {
    expect(getBasicAuthConfig({})).toEqual({
      enabled: false,
      username: "",
      password: "",
    });
    expect(isAuthorizedBasicAuth("", {})).toBe(true);
  });

  it("parses valid basic auth headers", () => {
    expect(parseBasicAuthHeader("Basic am9objpzZWNyZXQ=")).toEqual({
      username: "john",
      password: "secret",
    });
  });

  it("rejects malformed headers", () => {
    expect(parseBasicAuthHeader("Bearer abc")).toBeNull();
    expect(parseBasicAuthHeader("Basic ???")).toBeNull();
  });

  it("checks configured credentials", () => {
    const env = {
      DASHBOARD_BASIC_AUTH_USER: "demo",
      DASHBOARD_BASIC_AUTH_PASSWORD: "letmein",
    };

    expect(isAuthorizedBasicAuth("Basic ZGVtbzpsZXRtZWlu", env)).toBe(true);
    expect(isAuthorizedBasicAuth("Basic ZGVtbzp3cm9uZw==", env)).toBe(false);
    expect(isAuthorizedBasicAuth("", env)).toBe(false);
  });
});
