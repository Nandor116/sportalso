import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  APP_NAME,
} from "./config";
import { EventList, SportEvent, fetchAndVerify, loadCached, lastSync } from "./lib/data";
import { addToCalendar, openTicket, shareIcs, syncAddedFromCalendar } from "./lib/calendar";

const ADDED_KEY = "sportalso.addedIds";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("hu-HU", { weekday: "long" }).format(d);
  const rest = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, ${rest}, ${time}`;
}

const monthFormatter = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long" });

type Section = { title: string; data: SportEvent[] };

function groupByMonth(events: SportEvent[]): Section[] {
  const map = new Map<string, SportEvent[]>();
  for (const ev of events) {
    const d = new Date(ev.startsAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(ev);
    else map.set(key, [ev]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, data]) => ({
      title: monthFormatter.format(new Date(`${key}-01T12:00:00`)),
      data,
    }));
}

export default function App() {
  const [list, setList] = useState<EventList | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function syncAdded(events: SportEvent[]) {
    const found = await syncAddedFromCalendar(events);
    if (!found.size) return;
    setAdded((prev) => {
      const next = new Set(prev);
      for (const id of found) next.add(id);
      AsyncStorage.setItem(ADDED_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }

  const applyFetched = useCallback(async () => {
    const res = await fetchAndVerify();
    if (res.list) {
      setList(res.list);
      void syncAdded(res.list.events);
    }
    setError(res.error ?? null);
    setSynced(await lastSync());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const cached = await loadCached();
      if (cached) setList(cached);
      setAdded(new Set(JSON.parse((await AsyncStorage.getItem(ADDED_KEY)) ?? "[]")));
      await applyFetched();
      setBooting(false);
      void autoBackup();
    })();
  }, [applyFetched]);

  async function markAdded(id: string) {
    const next = new Set(added);
    next.add(id);
    setAdded(next);
    await AsyncStorage.setItem(ADDED_KEY, JSON.stringify([...next]));
  }

  async function onAdd(ev: SportEvent) {
    try {
      await addToCalendar(ev);
      await markAdded(ev.id);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function onIcs(ev: SportEvent) {
    try {
      await shareIcs(ev);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  const upcoming = (list?.events ?? [])
    .filter((e) => new Date(e.startsAt) >= startOfToday())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const sections = groupByMonth(upcoming);
  const missingCount = upcoming.filter((e) => !added.has(e.id)).length;

  async function addAllUpcoming() {
    let err: string | null = null;
    setBulkBusy(true);
    try {
      for (const ev of upcoming) {
        if (added.has(ev.id)) continue;
        try {
          await addToCalendar(ev);
          await markAdded(ev.id);
        } catch (e: any) {
          err = e?.message ?? String(e);
          break;
        }
      }
    } finally {
      setBulkBusy(false);
      setError(err);
    }
  }

  // ---------- export / import / backup ----------

  async function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      addedIds: [...added],
    };
    const file = new File(Paths.cache, "sportalso-export.json");
    file.write(JSON.stringify(payload));
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      dialogTitle: "Sportalsó adatok mentése",
    });
  }

  async function importData() {
    const res = await DocumentPicker.getDocumentAsync({
      type: "application/json",
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    const text = await new File(asset.uri).text();
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data.addedIds)) {
        const next = new Set<string>(data.addedIds);
        setAdded(next);
        await AsyncStorage.setItem(ADDED_KEY, JSON.stringify([...next]));
      }
      setError(null);
    } catch {
      setError("A fájl nem érvényes Sportalsó-export.");
    }
  }

  async function autoBackup() {
    try {
      const dir = new Directory(Paths.document, "backups");
      dir.create({ idempotent: true });
      const stamp = new Date().toISOString().slice(0, 10);
      // közvetlen a tárolóból olvasunk, hogy ne függjünk a state frissességétől
      const addedIds: string[] = JSON.parse((await AsyncStorage.getItem(ADDED_KEY)) ?? "[]");
      const payload = JSON.stringify({ addedIds, savedAt: new Date().toISOString() });
      new File(dir, `backup-${stamp}.json`).write(payload);
      const names = dir
        .list()
        .filter((f): f is File => f instanceof File && f.name.startsWith("backup-"))
        .map((f) => f.name)
        .sort();
      for (const old of names.slice(0, Math.max(0, names.length - 7))) {
        const f = new File(dir, old);
        if (f.exists) f.delete();
      }
    } catch {
      // backup csendben megbukhat — nem kritikus
    }
  }

  // ---------- render ----------

  function Row({ ev }: { ev: SportEvent }) {
    const isAdded = added.has(ev.id);
    return (
      <View style={styles.row}>
        <Text style={styles.title}>{ev.title}</Text>
        {!!ev.note && <Text style={styles.note}>{ev.note}</Text>}
        <View style={styles.dateRow}>
          <Text style={styles.date}>{fmtDate(ev.startsAt)}</Text>
          {isAdded && <Text style={styles.addedBadge}>✓ naptárban</Text>}
        </View>
        <View style={styles.actions}>
          {!isAdded && (
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => onAdd(ev)}>
              <Text style={styles.btnTextPrimary}>Naptárba</Text>
            </Pressable>
          )}
          {!!ev.ticketUrl && (
            <Pressable style={styles.btn} onPress={() => openTicket(ev.ticketUrl!)}>
              <Text style={styles.btnText}>Jegyek</Text>
            </Pressable>
          )}
          <Pressable style={styles.btn} onPress={() => onIcs(ev)}>
            <Text style={styles.btnText}>ICS</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{APP_NAME}</Text>
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={12}>
          <Text style={{ color: "#fff", fontSize: 20 }}>⚙︎</Text>
        </Pressable>
      </View>

      {booting ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <Row ev={item} />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await applyFetched();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>Nincs közelgő koncert</Text>
              <Text style={styles.muted}>Húzd le a listát a frissítéshez.</Text>
            </View>
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {missingCount > 1 && (
                <Pressable
                  style={[styles.btn, styles.btnBlock, styles.btnPrimary]}
                  disabled={bulkBusy}
                  onPress={() => void addAllUpcoming()}
                >
                  <Text style={styles.btnTextPrimary}>
                    {bulkBusy ? "Hozzáadás folyamatban..." : `Összes hozzáadása a naptárhoz (${missingCount})`}
                  </Text>
                </Pressable>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Text style={styles.muted}>
                {synced
                  ? `Frissítve: ${new Date(synced).toLocaleString("hu-HU")}`
                  : "Még nem sikerült frissíteni."}
              </Text>
            </View>
          }
        />
      )}

      <Modal visible={settingsOpen} animationType="slide">
        <ScrollView style={styles.modal}>
          <Text style={styles.modalTitle}>Beállítások</Text>
          <Pressable style={[styles.btn, styles.btnBlock]} onPress={() => void exportData()}>
            <Text style={styles.btnText}>Adatok exportálása</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnBlock]} onPress={() => void importData()}>
            <Text style={styles.btnText}>Adatok importálása</Text>
          </Pressable>
          <Text style={styles.muted}>
            Az automatikus biztonsági mentés az app dokumentum mappájába ír (backups/),
            utolsó 7 nap marad meg.
          </Text>
          <Pressable style={[styles.btn, styles.btnBlock]} onPress={() => setSettingsOpen(false)}>
            <Text style={styles.btnText}>Kész</Text>
          </Pressable>
        </ScrollView>
      </Modal>
    </View>
  );
}

const green = "#1a7f37";
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: {
    backgroundColor: green,
    paddingTop: 54,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  list: { padding: 14, paddingBottom: 40 },
  row: {
    borderWidth: 1,
    borderColor: "#d0d7de",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#fafbfc",
  },
  date: { color: green, fontWeight: "600", fontSize: 13, textTransform: "capitalize" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  addedBadge: { color: green, fontSize: 12, fontWeight: "700" },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "700",
    color: "#57606a",
    textTransform: "uppercase",
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 2,
  },
  title: { fontSize: 18, fontWeight: "700" },
  note: { fontSize: 14, color: "#57606a", marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: {
    borderWidth: 1,
    borderColor: "#d0d7de",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },
  btnPrimary: { backgroundColor: green, borderColor: green },
  btnDone: { opacity: 0.6 },
  btnBlock: { alignSelf: "stretch", alignItems: "center", marginBottom: 10 },
  btnText: { fontSize: 15, fontWeight: "600" },
  btnTextPrimary: { color: "#fff" },
  btnTextDone: { color: green },
  footer: { alignItems: "center", paddingVertical: 14, gap: 4 },
  muted: { color: "#57606a", fontSize: 12 },
  error: { color: "#cf222e", fontSize: 13, textAlign: "center" },
  emptyTitle: { fontSize: 17, fontWeight: "600", marginBottom: 6 },
  modal: { flex: 1, padding: 20, paddingTop: 70 },
  modalTitle: { fontSize: 22, fontWeight: "700", marginBottom: 16 },
});
