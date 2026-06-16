import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { safeRelativeCallback } from "@/lib/callback-url";
import { sessionHasAdminAccess } from "@/lib/admin-access";

/** Пробрасываем путь в серверные лейауты (защита глубины при отсутствии сессии). */
function continueWithPathname(req: NextRequest, pathname: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  if (pathname.startsWith("/auth")) {
    if (session) {
      const nextPath = safeRelativeCallback(
        req.nextUrl.searchParams.get("callbackUrl"),
      );
      return NextResponse.redirect(new URL(nextPath, req.nextUrl.origin));
    }
    return continueWithPathname(req, pathname);
  }

  if (!session?.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin") && !sessionHasAdminAccess(session)) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return continueWithPathname(req, pathname);
});

/** Все страницы приложения, кроме API и статики Next / типичных файлов из public. */
export const config = {
  matcher: [
    "/",
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|icon.svg).*)",
  ],
};
