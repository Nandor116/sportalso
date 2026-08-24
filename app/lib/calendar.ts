import * as Calendar from "expo-calendar";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { SportEvent } from "./data";
import { VENUE, VENUE_ADDRESS } from "../config";

// iOS-en van rendszer-szintű "default" naptár; Androidon nincs, ott a módosítható
// (lehetőleg elsődleges) naptárt választjuk ki.
async function pickCalendar(): Promise<Calendar.ExpoCalendar | null> {
  if (Platform.OS === "ios") {
    try {
      return Calendar.getDefaultCalendarSync();
    } catch {
      // esik a lista-alapú keresésre
    }
  }
  const cals = await Calendar.getCalendars();
  return (
    cals.find((c) => c.allowsModifications && c.isPrimary) ??
    cals.find((c) => c.allowsModifications) ??
    cals[0] ??
    null
  );
}

export async function addToCalendar(ev: SportEvent): Promise<void> {
  const { granted } = await Calendar.requestCalendarPermissions();
  if (!granted) {
    throw new Error("Nincs naptár-engedély.");
  }

  const calendar = await pickCalendar();
  if (!calendar) throw new Error("Nem található naptár a telefonon.");

  const start = new Date(ev.startsAt);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const location = [VENUE, VENUE_ADDRESS].filter(Boolean).join(", ");

  await calendar.createEvent({
    title: ev.title,
    startDate: start,
    endDate: end,
    location,
    notes: ev.note ?? "",
  });
}

function icsEscape(s: string): string {
  return s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

export async function shareIcs(ev: SportEvent): Promise<void> {
  const start = new Date(ev.startsAt);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const location = [VENUE, VENUE_ADDRESS].filter(Boolean).join(", ");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//sportalso//hu",
    "BEGIN:VEVENT",
    `UID:${ev.id}@sportalso`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
    ...(ev.note ? [`DESCRIPTION:${icsEscape(ev.note)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  if (!(await Sharing.isAvailableAsync())) throw new Error("A megosztás nem elérhető.");

  const file = new File(Paths.cache, `${ev.id}.ics`);
  file.write(ics);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/calendar",
      dialogTitle: "Koncert naptárba mentése",
      UTI: "com.apple.ical.ics",
    });
  } finally {
    if (file.exists) file.delete();
  }
}

export async function openTicket(url: string): Promise<void> {
  const Linking = require("react-native").Linking;
  await Linking.openURL(url);
}

// Újratelepítés-barát "hozzáadva" állapot: végignézi a telefon naptárát,
// és azt az eseményt tekinti hozzágadottnak, amelyiknek címe ÉS kezdőideje
// (±5 perc) egyezik egy meglévő naptárbejegyzéssel.
export async function syncAddedFromCalendar(events: SportEvent[]): Promise<Set<string>> {
  const found = new Set<string>();
  try {
    const { granted } = await Calendar.getCalendarPermissions();
    if (!granted) return found;

    const calendars = await Calendar.getCalendars();
    if (!calendars.length) return found;

    const now = Date.now();
    const windowStart = new Date(now - 365 * 86400000);
    const windowEnd = new Date(now + 2 * 365 * 86400000);
    const existing = await Calendar.listEvents(calendars, windowStart, windowEnd);

    for (const ev of events) {
      const target = new Date(ev.startsAt).getTime();
      const match = existing.some(
        (c) =>
          c.title === ev.title &&
          c.startDate != null &&
          Math.abs(new Date(c.startDate).getTime() - target) < 5 * 60 * 1000
      );
      if (match) found.add(ev.id);
    }
  } catch {
    // olvasási hiba esetén marad a lokálisan tárolt állapot
  }
  return found;
}
