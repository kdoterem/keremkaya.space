// The date line shown under a poem title everywhere on the site, with the
// hour it was written when that's known ("2026-07-30 · 23:42"). Poems from
// before times were recorded show the date alone.
export function stamp(p: { date: string; time?: string }): string {
  return p.time ? `${p.date} · ${p.time}` : p.date;
}
