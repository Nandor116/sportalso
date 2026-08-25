import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "system" | "light" | "dark" | "oled";

export type Colors = {
  bg: string;
  card: string;
  text: string;
  border: string;
  muted: string;
  accent: string;
  statusBar: "light" | "dark";
};

const palettes: Record<"light" | "dark" | "oled", Colors> = {
  light: {
    bg: "#ffffff",
    card: "#f6f6f6",
    text: "#1c1c1e",
    border: "#d0d7de",
    muted: "#57606a",
    accent: "#653071",
    statusBar: "dark",
  },
  dark: {
    bg: "#1c1c1e",
    card: "#2c2c2e",
    text: "#f2f2f7",
    border: "#38383a",
    muted: "#8e8e93",
    accent: "#b47ed4",
    statusBar: "light",
  },
  oled: {
    bg: "#000000",
    card: "#0a0a0a",
    text: "#f2f2f7",
    border: "#1c1c1e",
    muted: "#8e8e93",
    accent: "#b47ed4",
    statusBar: "light",
  },
};

const THEME_KEY = "sportalso.theme";

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  colors: Colors;
};

const ThemeContext = React.createContext<ThemeContextValue>({
  mode: "system",
  setMode: () => {},
  colors: palettes.light,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === "light" || v === "dark" || v === "oled" || v === "system") setModeState(v);
    });
  }, []);

  function setMode(m: ThemeMode) {
    setModeState(m);
    AsyncStorage.setItem(THEME_KEY, m).catch(() => {});
  }

  let resolved: "light" | "dark" | "oled";
  if (mode === "system") {
    resolved = systemScheme === "dark" ? "dark" : "light";
  } else {
    resolved = mode;
  }

  const colors = palettes[resolved];

  return (
    <ThemeContext.Provider value={{ mode, setMode, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
