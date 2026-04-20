import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { redeemCode } from "@/lib/billing/redeem";
import { z } from "zod";

const bodySchema = z.object({ code: z.string().min(1).max(100) });

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const outcome = await redeemCode({
    userId: session.user.id,
    code: parsed.data.code,
  });
  if (!outcome.ok) {
    return NextResponse.json(outcome, { status: 400 });
  }
  return NextResponse.json(outcome);
}
