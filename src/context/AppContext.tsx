import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { configApi } from "../api/config";
import { translations, Locale, TranslationKey } from "../lib/i18n";

interface AppContextType {
  locale: Locale;
  timezone: string;
  theme: string;
  setTheme: (theme: string) => void;
  setLocale: (locale: Locale) => void;
  setTimezone: (tz: string) => void;
  t: (key: TranslationKey) => string;
}

const AppContext = createContext<AppContextType>({
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  theme: "dark",
  setTheme: () => {},
  setLocale: () => {},
  setTimezone: () => {},
  t: (key) => String(key),
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState("dark");
  const [locale, setLocaleState] = useState<Locale>("zh-CN");
  const [timezone, setTimezoneState] = useState("Asia/Shanghai");

  useEffect(() => {
    configApi.get()
      .then((config) => {
        const savedTheme = config.ui.theme;
        const savedLocale = config.ui.language as Locale;
        const savedTz = config.ui.timezone;

        if (savedTheme === "light") {
          document.documentElement.classList.add("light");
          document.documentElement.classList.remove("dark");
        } else {
          document.documentElement.classList.remove("light");
          document.documentElement.classList.add("dark");
        }
        setThemeState(savedTheme);

        if (translations[savedLocale]) {
          setLocaleState(savedLocale);
        }
        if (savedTz) {
          setTimezoneState(savedTz);
        }
      })
      .catch(() => {});
  }, []);

  const setTheme = (newTheme: string) => {
    setThemeState(newTheme);
    if (newTheme === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    }
  };

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
  };

  const setTimezone = (newTz: string) => {
    setTimezoneState(newTz);
  };

  const t = (key: TranslationKey): string => {
    const dict = translations[locale];
    return (
      (dict as any)?.[key] ||
      (translations["zh-CN"] as any)?.[key] ||
      String(key)
    );
  };

  return (
    <AppContext.Provider
      value={{ locale, timezone, theme, setTheme, setLocale, setTimezone, t }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

export const useTheme = () => {
  const { theme, setTheme } = useContext(AppContext);
  return { theme, setTheme };
};

export const useI18n = () => {
  const { t, locale, timezone } = useContext(AppContext);
  return { t, locale, timezone };
};
