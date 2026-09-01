import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_MAX_AGE,
  ACCESS_COOKIE_NAME,
  createAccessToken,
  safeEqual,
  safeReturnPath,
} from "@/lib/access-auth";

export async function POST(request: NextRequest) {
  const configuredPassword = process.env.APP_ACCESS_PASSWORD;
  if (!configuredPassword) {
    return NextResponse.json(
      { error: "Falta APP_ACCESS_PASSWORD al servidor." },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const submittedPassword = String(formData.get("password") ?? "");
  const returnPath = safeReturnPath(formData.get("next"));
  const [submittedToken, expectedToken] = await Promise.all([
    createAccessToken(submittedPassword),
    createAccessToken(configuredPassword),
  ]);

  if (!safeEqual(submittedToken, expectedToken)) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "invalid");
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(new URL(returnPath, request.url), 303);
  response.cookies.set(ACCESS_COOKIE_NAME, expectedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE,
    priority: "high",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
