import "server-only";
import { env } from "@/lib/env";

export function buildNotionAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env().NOTION_CLIENT_ID,
    response_type: "code",
    owner: "user",
    redirect_uri: `${env().APP_URL}/api/integrations/notion/callback`,
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export type NotionTokenResponse = {
  access_token: string;
  bot_id: string;
  workspace_id: string;
  workspace_name: string | null;
  workspace_icon: string | null;
  owner: unknown;
  token_type: "bearer";
};

export async function exchangeNotionCode(code: string): Promise<NotionTokenResponse> {
  const creds = Buffer.from(
    `${env().NOTION_CLIENT_ID}:${env().NOTION_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env().APP_URL}/api/integrations/notion/callback`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion token exchange failed (${res.status}): ${body}`);
  }

  return (await res.json()) as NotionTokenResponse;
}
