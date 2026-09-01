import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  createAccessToken,
  safeEqual,
} from "@/lib/access-auth";

export async function proxy(request: NextRequest) {
  const password = process.env.APP_ACCESS_PASSWORD;
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  if (!password) {
    loginUrl.searchParams.set("config", "missing");
    return NextResponse.redirect(loginUrl);
  }

  const actualToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? "";
  const expectedToken = await createAccessToken(password);
  if (!safeEqual(actualToken, expectedToken)) {
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|login|api/access/login).*)",
  ],
};
