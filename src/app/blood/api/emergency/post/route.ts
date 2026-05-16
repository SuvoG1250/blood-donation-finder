function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY" }, 500);
  }

  const bodyText = await req.text();
  const upstream = await fetch(`${supabaseUrl}/functions/v1/post-emergency`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      apikey: anonKey,
    },
    body: bodyText,
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

