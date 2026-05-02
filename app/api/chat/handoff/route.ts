import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import {
  buildHandoffContext,
  buildHandoffPrompt,
  buildHandoffUrl,
} from "@/lib/chat/chatgpt-handoff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/chat/handoff
// Builds a context-loaded ChatGPT URL for tutor-style questions surfaced
// by the client-side scope detector. Returns the URL only; the caller
// opens it in a new tab via `window.open` so Steadii stays in place.
const bodySchema = z.object({
  question: z.string().trim().min(1).max(8_000),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const ctx = await buildHandoffContext(userId);
  const prompt = buildHandoffPrompt(parsed.data.question, ctx);
  const url = buildHandoffUrl(prompt);

  return NextResponse.json({ url });
}
