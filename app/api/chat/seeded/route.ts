import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";

export const runtime = "nodejs";

const SEED_PROMPTS: Record<string, string> = {
  review_recent_mistakes:
    "最近1週間の間違いノートから、特に復習した方がよいものを3件挙げて、それぞれのポイントを短くまとめてください。",
  generate_similar_problems:
    "最近1週間の間違いノートのパターンを元に、似た形式の練習問題を3題作成してください。解答は伏せておいてください。",
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const form = await request.formData();
  const seed = form.get("seed");
  if (typeof seed !== "string" || !(seed in SEED_PROMPTS)) {
    return NextResponse.json({ error: "invalid seed" }, { status: 400 });
  }

  const [row] = await db
    .insert(chats)
    .values({ userId: session.user.id })
    .returning({ id: chats.id });

  await db.insert(messagesTable).values({
    chatId: row.id,
    role: "user",
    content: SEED_PROMPTS[seed],
  });

  redirect(`/app/chat/${row.id}?stream=1`);
}
