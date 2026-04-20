import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { exchangeNotionCode } from "@/lib/integrations/notion/oauth";
import { encrypt } from "@/lib/utils/crypto";
import { db } from "@/lib/db/client";
import { notionConnections, auditLog } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/onboarding?notion_error=${encodeURIComponent(error)}`, request.url)
    );
  }

  const storedState = request.cookies.get("notion_oauth_state")?.value;
  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.redirect(
      new URL(`/onboarding?notion_error=invalid_state`, request.url)
    );
  }

  let token;
  try {
    token = await exchangeNotionCode(code);
  } catch (err) {
    console.error("Notion exchange failed", err);
    return NextResponse.redirect(
      new URL(`/onboarding?notion_error=exchange_failed`, request.url)
    );
  }

  const userId = session.user.id;
  const encrypted = encrypt(token.access_token);

  const existing = await db
    .select()
    .from(notionConnections)
    .where(
      and(
        eq(notionConnections.userId, userId),
        eq(notionConnections.workspaceId, token.workspace_id)
      )
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(notionConnections)
      .set({
        accessTokenEncrypted: encrypted,
        workspaceName: token.workspace_name,
        workspaceIcon: token.workspace_icon,
        botId: token.bot_id,
        updatedAt: new Date(),
      })
      .where(eq(notionConnections.id, existing[0].id));
  } else {
    await db.insert(notionConnections).values({
      userId,
      workspaceId: token.workspace_id,
      workspaceName: token.workspace_name,
      workspaceIcon: token.workspace_icon,
      botId: token.bot_id,
      accessTokenEncrypted: encrypted,
    });
  }

  await db.insert(auditLog).values({
    userId,
    action: "notion.connected",
    resourceType: "notion_workspace",
    resourceId: token.workspace_id,
    toolName: null,
    result: "success",
    detail: { workspace_name: token.workspace_name },
  });

  const res = NextResponse.redirect(new URL("/onboarding?step=calendar", request.url));
  res.cookies.delete("notion_oauth_state");
  return res;
}
