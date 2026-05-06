import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { configApi } from "../api/config";
import { translations, Locale, TranslationKey } from "../lib/i18n";

interface I18nContextType {
  locale: Locale;
  timezone: string;
  theme: string;
  setTheme: (theme: string) => void;
  setLocale: (locale: Locale) => void;
  setTimezone: (tz: string) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  theme: "dark",
  setTheme: () => {},
  setLocale: () => {},
  setTimezone: () => {},
  t: (key) => String(key),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState("dark");
  const [locale, setLocaleState] = useState<Locale>("zh-CN");
  const [timezone, setTimezoneState] = useState("Asia/Shanghai");
  const [configKey, setConfigKey] = useState(0);

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
  }, [configKey]);

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
    <I18nContext.Provider
      value={{ locale, timezone, theme, setTheme, setLocale, setTimezone, t }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useTheme() {
  const { theme, setTheme } = useContext(I18nContext);
  return { theme, setTheme };
}

export function refreshI18nConfig() {
  window.dispatchEvent(new CustomEvent("clamai-config-change"));
}
