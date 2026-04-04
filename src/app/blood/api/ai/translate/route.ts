import { proxyAiPost } from "@/lib/aiService";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return proxyAiPost("/translate", body);
}

