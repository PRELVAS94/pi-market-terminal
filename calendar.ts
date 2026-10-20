export const CALENDAR_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
export type CalendarEvent = {
  title: string;
  at: string;
  url: string;
  source: string;
};
function calendarDate(value: string, zone: string): string | undefined {
  const m = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/,
  );
  if (!m) return;
  zone =
    (
      {
        "US-Eastern": "America/New_York",
        "US/Eastern": "America/New_York",
      } as Record<string, string>
    )[zone] ?? zone;
  const parts = m.slice(1, 7).map(Number);
  if (
    parts[1] < 1 ||
    parts[1] > 12 ||
    parts[2] < 1 ||
    parts[2] > 31 ||
    (parts[3] || 0) > 23 ||
    (parts[4] || 0) > 59 ||
    (parts[5] || 0) > 59
  )
    return;
  const wall = Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3] || 0,
    parts[4] || 0,
    parts[5] || 0,
  );
  if (
    new Date(wall).getUTCMonth() !== parts[1] - 1 ||
    new Date(wall).getUTCDate() !== parts[2]
  )
    return;
  if (m[7]) return new Date(wall).toISOString();
  try {
    const format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    let instant = wall;
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(
        format.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
      );
      const shown = Date.UTC(
        +p.year,
        +p.month - 1,
        +p.day,
        +p.hour,
        +p.minute,
        +p.second,
      );
      instant += wall - shown;
    }
    return new Date(instant).toISOString();
  } catch {
    return;
  }
}
export function parseCalendar(ics: string): CalendarEvent[] {
  if (!ics.includes("BEGIN:VCALENDAR"))
    throw new Error("BLS did not return an iCalendar feed");
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const events: CalendarEvent[] = [];
  const defaultZone =
    unfolded.match(/^X-WR-TIMEZONE:(.+)$/m)?.[1]?.trim() || "America/New_York";
  const unescape = (s: string) =>
    s.replace(/\\[nN]/g, " ").replace(/\\([,;\\])/g, "$1");
  for (const block of unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []) {
    if (/^STATUS:CANCELLED/m.test(block)) continue;
    const start = block.match(/^DTSTART([^:]*):([^\r\n]+)/m);
    const title = block.match(/^SUMMARY(?:;[^:]*)?:(.*)$/m)?.[1]?.trim();
    if (!start || !title) continue;
    const zone =
      start[1].match(/TZID=([^;:]+)/)?.[1]?.replace(/^"|"$/g, "") ||
      defaultZone;
    const at = calendarDate(start[2].trim(), zone);
    if (!at) continue;
    const rawUrl = block.match(/^URL(?:;[^:]*)?:(.*)$/m)?.[1]?.trim();
    events.push({
      title: unescape(title),
      at,
      url:
        rawUrl && /^https?:\/\//i.test(rawUrl)
          ? rawUrl
          : "https://www.bls.gov/schedule/",
      source: "U.S. Bureau of Labor Statistics",
    });
  }
  return [...new Map(events.map((e) => [e.at + e.title, e])).values()].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
}
export function createCalendarClient() {
  let events: CalendarEvent[] = [],
    checked = 0,
    lastSuccess = 0,
    error: string | undefined,
    pending: Promise<void> | undefined;
  return {
    snapshot: () => ({
      events: events.filter((e) => Date.parse(e.at) >= Date.now() - 3600_000),
      checked,
      lastSuccess,
      error,
    }),
    refresh(force = false) {
      if (pending) return pending;
      if (!force && checked && Date.now() - checked < 3600_000)
        return Promise.resolve();
      pending = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(CALENDAR_URL, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Pi-Market-Terminal/0.4",
              Accept: "text/calendar",
            },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const raw = await response.text();
          if (raw.length > 2_000_000)
            throw new Error("Calendar feed too large");
          events = parseCalendar(raw);
          error = undefined;
          lastSuccess = Date.now();
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        } finally {
          clearTimeout(timeout);
          checked = Date.now();
          pending = undefined;
        }
      })();
      return pending;
    },
  };
}
