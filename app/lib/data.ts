import AsyncStorage from "@react-native-async-storage/async-storage";
import nacl from "tweetnacl";
import {
  DATA_BASE_URL,
  EVENTS_PATH,
  SIG_PATH,
  PUBLIC_KEY_HEX,
} from "../config";

export type SportEvent = {
  id: string;
  title: string;
  startsAt: string; // UTC ISO
  ticketUrl?: string;
  note?: string;
};

export type EventList = {
  version: number;
  generatedAt: string;
  events: SportEvent[];
};

const CACHE_KEY = "sportalso.cachedList";
const SYNC_KEY = "sportalso.lastSync";

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

// A Hermes (React Native) nem tartalmaz atob-ot, ezért saját dekóder.
const B64_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(input: string): Uint8Array {
  const s = input.replace(/[\s=]+/g, "");
  const out = new Uint8Array((s.length * 3) >> 2);
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64_TABLE.indexOf(s[i]);
    if (v < 0) throw new Error("Az aláírás fájl nem érvényes base64.");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

export async function loadCached(): Promise<EventList | null> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EventList;
  } catch {
    return null;
  }
}

export async function lastSync(): Promise<string | null> {
  return AsyncStorage.getItem(SYNC_KEY);
}

export async function fetchAndVerify(): Promise<{
  list: EventList | null;
  error?: string;
}> {
  try {
    // cache-buster: a CDN ne szolgáljon ki egymáshoz nem illő, régebbi párt
    const bust = `?t=${Date.now()}`;
    const [eventsRes, sigRes] = await Promise.all([
      fetch(DATA_BASE_URL + EVENTS_PATH + bust),
      fetch(DATA_BASE_URL + SIG_PATH + bust),
    ]);
    if (!eventsRes.ok || !sigRes.ok) {
      throw new Error("Nem sikerült letölteni az eseménylistát.");
    }
    const jsonText = await eventsRes.text();
    const sigB64 = (await sigRes.text()).trim();

    const pub = hexToBytes(PUBLIC_KEY_HEX);
    const sig = base64ToBytes(sigB64);
    const valid = nacl.sign.detached.verify(
      new TextEncoder().encode(jsonText),
      sig,
      pub
    );
    if (!valid) throw new Error("Az aláírás érvénytelen — a lista eldobva.");

    const data = JSON.parse(jsonText) as EventList;

    const cached = await loadCached();
    if (cached && data.version < cached.version) {
      // stale védelem: régebbi verzió nem írhatja felül az újjat
      return { list: cached };
    }

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
    await AsyncStorage.setItem(SYNC_KEY, new Date().toISOString());
    return { list: data };
  } catch (e: any) {
    const cached = await loadCached();
    return { list: cached, error: e?.message ?? String(e) };
  }
}
