import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

export type ThemeName = 'tranquil' | 'passion' | 'geek' | 'classic' | 'business' | 'minimal' | 'bright' | 'dark';

export interface ThemeInfo {
  id: ThemeName;
  name: string;
  desc: string;
  className: string;
  preview: { bg: string; fg: string; primary: string; card: string };
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'tranquil', name: '静谧', desc: '深邃暗蓝，青色点缀', className: '',
    preview: { bg: '#0b1120', fg: '#eef2ff', primary: '#22d3ee', card: '#142038' },
  },
  {
    id: 'passion', name: '热情', desc: '暖色暗底，橙色活力', className: 'theme-passion',
    preview: { bg: '#0e0a08', fg: '#f5ece6', primary: '#f97316', card: '#1a120e' },
  },
  {
    id: 'geek', name: '极客', desc: '终端风格，荧光绿', className: 'theme-geek',
    preview: { bg: '#060e08', fg: '#d6f0da', primary: '#22c55e', card: '#0c1a10' },
  },
  {
    id: 'classic', name: '经典', desc: '传统蓝白，清晰易读', className: 'theme-classic',
    preview: { bg: '#f0f2f6', fg: '#1a1f36', primary: '#3b82f6', card: '#ffffff' },
  },
  {
    id: 'business', name: '商务', desc: '碳灰暗底，金色点缀', className: 'theme-business',
    preview: { bg: '#131316', fg: '#e8e2d6', primary: '#eab308', card: '#1c1c20' },
  },
  {
    id: 'minimal', name: '简约', desc: '极简灰白，低调克制', className: 'theme-minimal',
    preview: { bg: '#f7f7f7', fg: '#262626', primary: '#404040', card: '#ffffff' },
  },
  {
    id: 'bright', name: '明亮', desc: '明亮白底，鲜艳蓝色', className: 'theme-bright',
    preview: { bg: '#f8faff', fg: '#1a1f36', primary: '#3b82f6', card: '#ffffff' },
  },
  {
    id: 'dark', name: '黑暗', desc: '纯黑极暗，高对比度', className: 'theme-dark',
    preview: { bg: '#080808', fg: '#ededed', primary: '#d9d9d9', card: '#141414' },
  },
];

const STORAGE_KEY = 'clamai-theme';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  themeInfo: ThemeInfo;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'tranquil',
  setTheme: () => {},
  themeInfo: THEMES[0],
});

function applyThemeClass(themeName: ThemeName) {
  THEMES.forEach((t) => {
    if (t.className) document.documentElement.classList.remove(t.className);
  });
  const info = THEMES.find((t) => t.id === themeName);
  if (info?.className) {
    document.documentElement.classList.add(info.className);
  }
}

async function saveThemeToBackend(themeName: ThemeName) {
  try {
    const { apiRequest } = await import('../api/client');
    const config = await apiRequest<{ ui?: { theme?: string } } & Record<string, unknown>>("GET", "/config");
    if (config) {
      if (!config.ui) config.ui = {} as any;
      (config.ui as any).theme = themeName;
      await apiRequest("PUT", "/config", config);
    }
  } catch {}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
      if (saved && THEMES.some((t) => t.id === saved)) return saved;
    } catch {}
    return 'tranquil';
  });

  const backendSynced = useRef(false);

  useEffect(() => {
    applyThemeClass(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  useEffect(() => {
    if (backendSynced.current) return;
    backendSynced.current = true;
    (async () => {
      try {
        const { apiRequest } = await import('../api/client');
        const config = await apiRequest<{ ui?: { theme?: string } } & Record<string, unknown>>("GET", "/config");
        const backendTheme = config?.ui?.theme as ThemeName | undefined;
        if (backendTheme && THEMES.some((t) => t.id === backendTheme) && backendTheme !== theme) {
          setThemeState(backendTheme);
        }
      } catch {}
    })();
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    saveThemeToBackend(t);
  }, []);

  const info = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themeInfo: info }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
