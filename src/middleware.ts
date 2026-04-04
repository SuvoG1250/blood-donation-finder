import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isPublicAsset(pathname: string) {
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/assets")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/manifest.json") return true;
  if (pathname === "/sw.js") return true;
  // Skip direct file requests like /icon.png, /robots.txt, etc.
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/blood")) return NextResponse.next();
  if (isPublicAsset(pathname)) return NextResponse.next();
  if (pathname === "/") return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = `/blood${pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next).*)"],
};
