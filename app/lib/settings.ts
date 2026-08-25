import AsyncStorage from "@react-native-async-storage/async-storage";

const AUTO_ADD_KEY = "sportalso.autoAddToCalendar";

export async function getAutoAddToCalendar(): Promise<boolean> {
  const v = await AsyncStorage.getItem(AUTO_ADD_KEY);
  return v === "true";
}

export async function setAutoAddToCalendar(value: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_ADD_KEY, String(value));
}
