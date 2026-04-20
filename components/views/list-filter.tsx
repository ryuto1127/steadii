export function ListFilter({
  fields,
  searchName,
  searchValue,
}: {
  fields: Array<{
    name: string;
    label: string;
    options: Array<{ value: string; label: string }>;
    current?: string;
  }>;
  searchName: string;
  searchValue?: string;
}) {
  return (
    <form
      method="get"
      className="mt-6 flex flex-wrap items-end gap-3 rounded-xl bg-[hsl(var(--surface))] p-4 shadow-sm"
    >
      {fields.map((f) => (
        <label key={f.name} className="text-xs text-[hsl(var(--muted-foreground))]">
          {f.label}
          <select
            name={f.name}
            defaultValue={f.current ?? ""}
            className="ml-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1 text-sm"
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <input
        name={searchName}
        defaultValue={searchValue ?? ""}
        placeholder="Search…"
        className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))]"
      >
        Filter
      </button>
    </form>
  );
}
