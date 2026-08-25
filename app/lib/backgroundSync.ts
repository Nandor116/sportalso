import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchAndVerify } from "./data";
import { addToCalendar } from "./calendar";
import { getAutoAddToCalendar } from "./settings";

const TASK_NAME = "sportalso-bg-sync";
const LAST_IDS_KEY = "sportalso.lastKnownEventIds";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const res = await fetchAndVerify();
    if (!res.list) return BackgroundFetch.BackgroundFetchResult.NoData;

    const newIds = res.list.events.map((e) => e.id);
    const prevRaw = await AsyncStorage.getItem(LAST_IDS_KEY);
    const prevIds: string[] = prevRaw ? JSON.parse(prevRaw) : [];

    if (!prevIds.length) {
      await AsyncStorage.setItem(LAST_IDS_KEY, JSON.stringify(newIds));
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    const prevSet = new Set(prevIds);
    const fresh = res.list.events.filter((e) => !prevSet.has(e.id));

    await AsyncStorage.setItem(LAST_IDS_KEY, JSON.stringify(newIds));

    if (!fresh.length) return BackgroundFetch.BackgroundFetchResult.NoData;

    for (const ev of fresh) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Új koncert!",
          body: `${ev.title} — ${new Date(ev.startsAt).toLocaleDateString("hu-HU")}`,
        },
        trigger: null,
      });

      if (await getAutoAddToCalendar()) {
        try {
          await addToCalendar(ev);
        } catch {
          // csendben bukik — nem kritikus
        }
      }
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) return;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: 15,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch {
    // csendben bukik
  }
}

export async function requestNotificationPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}
