function trimEnv(value: string | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

export async function GET() {
  const url =
    trimEnv(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    trimEnv(process.env.SUPABASE_URL);
  const anonKey =
    trimEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    trimEnv(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) ||
    trimEnv(process.env.SUPABASE_ANON_KEY);

  if (!url || !anonKey) {
    return Response.json(
      {
        configured: false,
        error: "Missing Supabase URL or anon key in .env.local",
      },
      { status: 503 },
    );
  }

  return Response.json({
    configured: true,
    url,
    anonKey,
  });
}
