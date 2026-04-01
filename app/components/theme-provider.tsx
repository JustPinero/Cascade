"use client";

import { createContext, useContext, useSyncExternalStore, useCallback } from "react";

type Theme = "dark" | "light";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({
  theme: "dark",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("cascade-theme") as Theme) || "dark";
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, getStoredTheme, () => "dark" as Theme);

  // Apply data-theme attribute
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }

  const handleSetTheme = useCallback((newTheme: Theme) => {
    localStorage.setItem("cascade-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    // Trigger re-render via storage event
    window.dispatchEvent(new Event("storage"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
