import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  handwrittenMistakeSaveSchema,
  saveHandwrittenMistakeNote,
} from "@/lib/mistakes/save";
import { BillingQuotaExceededError } from "@/lib/billing/credits";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const parsed = handwrittenMistakeSaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const result = await saveHandwrittenMistakeNote({
      userId: session.user.id,
      input: parsed.data,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BillingQuotaExceededError) {
      return NextResponse.json(
        { error: err.message, code: err.code, balance: err.balance },
        { status: 402 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save_failed" },
      { status: 500 }
    );
  }
}
