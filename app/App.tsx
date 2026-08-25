import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { BlurView } from "expo-blur";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { APP_NAME } from "./config";
import { EventList, SportEvent, fetchAndVerify, loadCached, lastSync } from "./lib/data";
import { addToCalendar, openTicket, syncAddedFromCalendar } from "./lib/calendar";
import { ThemeProvider, useTheme, ThemeMode } from "./lib/theme";
import { getAutoAddToCalendar, setAutoAddToCalendar } from "./lib/settings";
import { registerBackgroundSync, requestNotificationPermission } from "./lib/backgroundSync";

const ADDED_KEY = "sportalso.addedIds";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const ev = new Intl.DateTimeFormat("hu-HU", { year: "numeric" }).format(d);
  const ho = new Intl.DateTimeFormat("hu-HU", { month: "long" }).format(d);
  const nap = new Intl.DateTimeFormat("hu-HU", { day: "numeric" }).format(d);
  const napNev = new Intl.DateTimeFormat("hu-HU", { weekday: "long" }).format(d);
  const ido = new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${ev}. ${ho} ${nap}. ${napNev} ${ido}`;
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

function AppContent() {
  const { mode, setMode, colors } = useTheme();
  const [list, setList] = useState<EventList | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<SportEvent | null>(null);
  const [autoAdd, setAutoAdd] = useState(false);

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
  }, []);

  useEffect(() => {
    (async () => {
      const cached = await loadCached();
      if (cached) setList(cached);
      setAdded(new Set(JSON.parse((await AsyncStorage.getItem(ADDED_KEY)) ?? "[]")));
      setAutoAdd(await getAutoAddToCalendar());
      await applyFetched();
      setBooting(false);
      void autoBackup();
      void registerBackgroundSync();
      void requestNotificationPermission();
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

  const upcoming = (list?.events ?? [])
    .filter((e) => new Date(e.startsAt) >= startOfToday())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const sections = groupByMonth(upcoming);
  const missingCount = upcoming.filter((e) => !added.has(e.id)).length;

  async function exportData() {
    const payload = { exportedAt: new Date().toISOString(), addedIds: [...added] };
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
    } catch {}
  }

  function Row({ ev }: { ev: SportEvent }) {
    const isAdded = added.has(ev.id);
    return (
      <Pressable onPress={() => setSelectedEvent(ev)}>
        <View style={[s.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.title, { color: colors.text }]}>{ev.title}</Text>
          {!!ev.note && <Text style={[s.note, { color: colors.muted }]}>{ev.note}</Text>}
          <View style={s.dateRow}>
            <Text style={[s.date, { color: colors.accent }]}>{fmtDate(ev.startsAt)}</Text>
            {isAdded && <Text style={[s.addedBadge, { color: colors.accent }]}>✓ naptárban</Text>}
          </View>
          <View style={s.actions}>
            {!isAdded && (
              <Pressable style={[s.btn, { backgroundColor: colors.accent, borderColor: colors.accent }]} onPress={() => onAdd(ev)}>
                <Text style={s.btnTextPrimary}>Naptárba</Text>
              </Pressable>
            )}
            {!!ev.ticketUrl && (
              <Pressable style={[s.btn, { borderColor: colors.border }]} onPress={() => openTicket(ev.ticketUrl!)}>
                <Text style={[s.btnText, { color: colors.text }]}>Jegyek</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  function DetailView({ ev }: { ev: SportEvent }) {
    return (
      <Modal visible={!!ev} animationType="slide" onRequestClose={() => setSelectedEvent(null)}>
        <View style={[s.detailRoot, { backgroundColor: colors.bg }]}>
          <StatusBar style={colors.statusBar} />
          <ScrollView>
            {!!ev.imageUrl && (
              <Image source={{ uri: ev.imageUrl }} style={s.detailImage} resizeMode="cover" />
            )}
            <View style={s.detailBody}>
              <Pressable onPress={() => setSelectedEvent(null)} style={s.detailBack}>
                <Text style={{ color: colors.accent, fontSize: 16, fontWeight: "600" }}>Vissza</Text>
              </Pressable>
              <Text style={[s.detailTitle, { color: colors.text }]}>{ev.title}</Text>
              <Text style={[s.detailDate, { color: colors.accent }]}>{fmtDate(ev.startsAt)}</Text>
              {!!ev.note && <Text style={[s.detailNote, { color: colors.muted }]}>{ev.note}</Text>}
              {!!ev.description && <Text style={[s.detailDesc, { color: colors.text }]}>{ev.description}</Text>}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
                {!added.has(ev.id) && (
                  <Pressable style={[s.btn, s.detailBtn, { backgroundColor: colors.accent, borderColor: colors.accent }]} onPress={() => onAdd(ev)}>
                    <Text style={s.btnTextPrimary}>Naptárba</Text>
                  </Pressable>
                )}
                {!!ev.ticketUrl && (
                  <Pressable style={[s.btn, s.detailBtn, { borderColor: colors.border }]} onPress={() => openTicket(ev.ticketUrl!)}>
                    <Text style={[s.btnText, { color: colors.text }]}>Jegyek</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  }

  const themeOptions: { label: string; value: ThemeMode; icon: string }[] = [
    { label: "Rendszer", value: "system", icon: "📱" },
    { label: "Világos", value: "light", icon: "⚪" },
    { label: "Sötét", value: "dark", icon: "🔘" },
    { label: "OLED Fekete", value: "oled", icon: "⚫" },
  ];

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={colors.statusBar} />
      <View style={[s.header, { backgroundColor: colors.accent }]}>
        <Text style={s.headerTitle}>{APP_NAME}</Text>
        <BlurView intensity={40} tint={colors.statusBar === "light" ? "dark" : "light"} style={s.gearBlur}>
          <Pressable onPress={() => setSettingsOpen(true)} hitSlop={12}>
            <Text style={{ color: "#fff", fontSize: 28 }}>⚙︎</Text>
          </Pressable>
        </BlurView>
      </View>

      {booting ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <Row ev={item} />}
          renderSectionHeader={({ section }) => (
            <Text style={[s.sectionHeader, { color: colors.muted }]}>{section.title}</Text>
          )}
          contentContainerStyle={s.list}
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
            <View style={s.center}>
              <Text style={[s.emptyTitle, { color: colors.text }]}>Nincs közelgő koncert</Text>
              <Text style={[s.muted, { color: colors.muted }]}>Húzd le a listát a frissítéshez.</Text>
            </View>
          }
          ListFooterComponent={
            <View style={s.footer}>
              {missingCount > 1 && (
                <Pressable
                  style={[s.btn, s.btnBlock, { backgroundColor: colors.accent, borderColor: colors.accent }]}
                  disabled={bulkBusy}
                  onPress={() => void addAllUpcoming()}
                >
                  <Text style={s.btnTextPrimary}>
                    {bulkBusy ? "Hozzáadás folyamatban..." : `Összes hozzáadása a naptárhoz (${missingCount})`}
                  </Text>
                </Pressable>
              )}
              {!!error && <Text style={s.error}>{error}</Text>}
              <Text style={[s.muted, { color: colors.muted }]}>
                {synced
                  ? `Frissítve: ${new Date(synced).toLocaleString("hu-HU")}`
                  : "Még nem sikerült frissíteni."}
              </Text>
            </View>
          }
        />
      )}

      {selectedEvent && <DetailView ev={selectedEvent} />}

      <Modal visible={settingsOpen} animationType="slide">
        <View style={[s.modal, { backgroundColor: colors.bg }]}>
          <StatusBar style={colors.statusBar} />
          <ScrollView contentContainerStyle={s.modalScroll}>
            <Text style={[s.modalTitle, { color: colors.text }]}>Beállítások</Text>

            <Text style={[s.settingsLabel, { color: colors.muted }]}>Megjelenés</Text>
            <View style={s.themeRow}>
              {themeOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[
                    s.themeBtn,
                    {
                      borderColor: mode === opt.value ? colors.accent : colors.border,
                      backgroundColor: mode === opt.value ? colors.accent + "20" : "transparent",
                    },
                  ]}
                  onPress={() => setMode(opt.value)}
                >
                  <Text style={{ fontSize: 18 }}>{opt.icon}</Text>
                  <Text style={[s.themeBtnLabel, { color: mode === opt.value ? colors.accent : colors.muted }]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.settingsLabel, { color: colors.muted, marginTop: 20 }]}>Naptár</Text>
            <Pressable
              style={[s.toggleRow, { borderColor: colors.border }]}
              onPress={() => {
                const next = !autoAdd;
                setAutoAdd(next);
                setAutoAddToCalendar(next);
              }}
            >
              <Text style={[s.toggleLabel, { color: colors.text }]}>Automatikus naptárhozadás</Text>
              <Text style={[s.toggleValue, { color: autoAdd ? colors.accent : colors.muted }]}>
                {autoAdd ? "BE" : "KI"}
              </Text>
            </Pressable>

            <Text style={[s.settingsLabel, { color: colors.muted, marginTop: 20 }]}>Adatok</Text>
            <Pressable style={[s.btn, s.btnBlock, { borderColor: colors.border }]} onPress={() => void exportData()}>
              <Text style={[s.btnText, { color: colors.text }]}>Adatok exportálása</Text>
            </Pressable>
            <Pressable style={[s.btn, s.btnBlock, { borderColor: colors.border }]} onPress={() => void importData()}>
              <Text style={[s.btnText, { color: colors.text }]}>Adatok importálása</Text>
            </Pressable>
            <Text style={[s.muted, { color: colors.muted }]}>
              Az automatikus biztonsági mentés az app dokumentum mappájába ír (backups/), utolsó 7 nap marad meg.
            </Text>

            <Pressable style={[s.btn, s.btnBlock, { backgroundColor: colors.accent, borderColor: colors.accent, marginTop: 20 }]} onPress={() => setSettingsOpen(false)}>
              <Text style={s.btnTextPrimary}>Kész</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingTop: 54,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  gearBlur: { borderRadius: 12, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  list: { padding: 14, paddingBottom: 40 },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  date: { fontWeight: "600", fontSize: 13 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  addedBadge: { fontSize: 12, fontWeight: "700" },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 2,
  },
  title: { fontSize: 18, fontWeight: "700" },
  note: { fontSize: 14, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },
  btnBlock: { alignSelf: "stretch", alignItems: "center", marginBottom: 10 },
  btnText: { fontSize: 15, fontWeight: "600" },
  btnTextPrimary: { color: "#fff", fontSize: 15, fontWeight: "600" },
  footer: { alignItems: "center", paddingVertical: 14, gap: 4 },
  muted: { fontSize: 12 },
  error: { color: "#cf222e", fontSize: 13, textAlign: "center" },
  emptyTitle: { fontSize: 17, fontWeight: "600", marginBottom: 6 },
  detailRoot: { flex: 1 },
  detailImage: { width: "100%", height: 250 },
  detailBody: { padding: 20 },
  detailBack: { marginBottom: 12 },
  detailTitle: { fontSize: 24, fontWeight: "700", marginBottom: 6 },
  detailDate: { fontSize: 15, fontWeight: "600", marginBottom: 8 },
  detailNote: { fontSize: 14, marginBottom: 12 },
  detailDesc: { fontSize: 15, lineHeight: 22 },
  detailBtn: { flex: 1, alignItems: "center" },
  modal: { flex: 1 },
  modalScroll: { padding: 20, paddingTop: 70, paddingBottom: 40 },
  modalTitle: { fontSize: 22, fontWeight: "700", marginBottom: 16 },
  settingsLabel: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  themeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  themeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    minWidth: 70,
  },
  themeBtnLabel: { fontSize: 11, marginTop: 4, fontWeight: "600" },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
  },
  toggleLabel: { fontSize: 15, fontWeight: "600" },
  toggleValue: { fontSize: 14, fontWeight: "700" },
});
