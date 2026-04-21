import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { chats, messages as messagesTable } from "@/lib/db/schema";

export const runtime = "nodejs";

const SEED_KEYS = ["review_recent_mistakes", "generate_similar_problems"] as const;
type SeedKey = (typeof SEED_KEYS)[number];

function isSeedKey(value: unknown): value is SeedKey {
  return typeof value === "string" && (SEED_KEYS as readonly string[]).includes(value);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const form = await request.formData();
  const seed = form.get("seed");
  if (!isSeedKey(seed)) {
    return NextResponse.json({ error: "invalid seed" }, { status: 400 });
  }

  const t = await getTranslations("seed_prompts");

  const [row] = await db
    .insert(chats)
    .values({ userId: session.user.id })
    .returning({ id: chats.id });

  await db.insert(messagesTable).values({
    chatId: row.id,
    role: "user",
    content: t(seed),
  });

  redirect(`/app/chat/${row.id}?stream=1`);
}
