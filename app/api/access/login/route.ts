import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_MAX_AGE,
  ACCESS_COOKIE_NAME,
  createAccessToken,
  hasTrustedOrigin,
  passwordProof,
  safeEqual,
  safeReturnPath,
} from "@/lib/access-auth";
import { createServerSupabase } from "@/lib/records-page";

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Origen de la petició no vàlid." }, { status: 403 });
  const browserOrigin = request.headers.get("origin") ?? new URL(request.url).origin;
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
  const [submittedProof, expectedProof, attemptKey] = await Promise.all([
    passwordProof(submittedPassword),
    passwordProof(configuredPassword),
    passwordProof(`${configuredPassword}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`),
  ]);
  const validPassword = safeEqual(submittedProof, expectedProof);
  const attempt = await createServerSupabase().rpc("access_login_attempt", { p_key: attemptKey, p_success: validPassword });
  if (attempt.error) return NextResponse.json({ error: "No s’ha pogut verificar l’accés." }, { status: 503 });

  if (!validPassword || attempt.data !== true) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const loginUrl = new URL("/login", browserOrigin);
    loginUrl.searchParams.set("error", attempt.data === false ? "rate" : "invalid");
    loginUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(new URL(returnPath, browserOrigin), 303);
  response.cookies.set(ACCESS_COOKIE_NAME, await createAccessToken(process.env.APP_ACCESS_SESSION_SECRET ?? configuredPassword), {
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
