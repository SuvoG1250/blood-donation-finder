function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function getAiServiceUrl() {
  return (process.env.AI_SERVICE_URL ?? "").trim();
}

export async function proxyAiPost(path: string, payload: unknown) {
  const base = getAiServiceUrl();
  if (!base) {
    return json({ error: "AI service is not configured (AI_SERVICE_URL missing)." }, 501);
  }
  const url = `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

