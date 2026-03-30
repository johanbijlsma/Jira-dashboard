import { NextResponse } from "next/server";

import { getBasicAuthConfig, isAuthorizedBasicAuth } from "./lib/basic-auth";

export function proxy(request) {
  const config = getBasicAuthConfig();
  if (!config.enabled) return NextResponse.next();

  if (isAuthorizedBasicAuth(request.headers.get("authorization"))) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Dashboard tijdelijk delen"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
