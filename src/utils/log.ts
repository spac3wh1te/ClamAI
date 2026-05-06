function formatMessage(module: string, message: string, data?: any): string {
  let formatted = `[${module}] ${message}`;
  if (data !== undefined) {
    formatted += ` ${JSON.stringify(data)}`;
  }
  return formatted;
}

const LEVEL_MAP: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function getCurrentLevel(): number {
  try {
    const stored = localStorage.getItem("log_level");
    if (stored && LEVEL_MAP[stored] !== undefined) return LEVEL_MAP[stored];
  } catch {}
  return LEVEL_MAP.info;
}

function shouldLog(level: string): boolean {
  const current = getCurrentLevel();
  const target = LEVEL_MAP[level] ?? LEVEL_MAP.info;
  return target <= current;
}

export function setFrontendLogLevel(level: string) {
  try {
    localStorage.setItem("log_level", level);
  } catch {}
}

export function logInfo(module: string, message: string, data?: any): void {
  if (!shouldLog("info")) return;
  console.info(formatMessage(module, message, data));
}

export function logError(module: string, message: string, error?: any): void {
  if (!shouldLog("error")) return;
  console.error(formatMessage(module, message, error instanceof Error ? undefined : error));
  if (error instanceof Error) {
    console.error(`[${module}] ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

export function logWarn(module: string, message: string, data?: any): void {
  if (!shouldLog("warn")) return;
  console.warn(formatMessage(module, message, data));
}

export function logDebug(module: string, message: string, data?: any): void {
  if (!shouldLog("debug")) return;
  console.debug(formatMessage(module, message, data));
}
