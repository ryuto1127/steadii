import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getUserConfirmationMode } from "@/lib/agent/preferences";
import { setConfirmationModeAction } from "./actions";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const t = await getTranslations("nav");
  const mode = await getUserConfirmationMode(session.user.id);

  return (
    <div className="max-w-xl">
      <h1 className="font-serif text-3xl">{t("settings")}</h1>

      <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-xl bg-[hsl(var(--surface))]">
        <li>
          <Link
            href="/app/settings/connections"
            className="flex items-center justify-between px-6 py-4 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
          >
            <span>Connections</span>
            <span className="text-[hsl(var(--muted-foreground))]">→</span>
          </Link>
        </li>
        <li>
          <Link
            href="/app/resources"
            className="flex items-center justify-between px-6 py-4 text-sm transition hover:bg-[hsl(var(--surface-raised))]"
          >
            <span>Registered Resources</span>
            <span className="text-[hsl(var(--muted-foreground))]">→</span>
          </Link>
        </li>
      </ul>

      <section className="mt-8 rounded-xl bg-[hsl(var(--surface))] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Agent confirmation</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Choose when Steadii should pause and ask before acting on your Notion
          pages or calendar.
        </p>
        <form action={setConfirmationModeAction} className="mt-4 space-y-3">
          <Option
            value="destructive_only"
            checked={mode === "destructive_only"}
            label="Only confirm destructive actions (recommended)"
            hint="Creating or updating is automatic; deletions pause for approval."
          />
          <Option
            value="all"
            checked={mode === "all"}
            label="Confirm every write"
            hint="Any change — create, update, delete — pauses for approval."
          />
          <Option
            value="none"
            checked={mode === "none"}
            label="Never ask"
            hint="Steadii acts immediately. Use with care."
          />
          <button
            type="submit"
            className="mt-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))]"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  );
}

function Option({
  value,
  checked,
  label,
  hint,
}: {
  value: string;
  checked: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-[hsl(var(--surface-raised))]">
      <input
        type="radio"
        name="mode"
        value={value}
        defaultChecked={checked}
        className="mt-1"
      />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>
      </div>
    </label>
  );
}
