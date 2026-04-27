function formatMessage(module: string, message: string, data?: any): string {
  let formatted = `[${module}] ${message}`;
  if (data !== undefined) {
    formatted += ` ${JSON.stringify(data)}`;
  }
  return formatted;
}

export function logInfo(module: string, message: string, data?: any): void {
  console.info(formatMessage(module, message, data));
}

export function logError(module: string, message: string, error?: any): void {
  console.error(formatMessage(module, message, error instanceof Error ? undefined : error));
  if (error instanceof Error) {
    console.error(`[${module}] ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

export function logWarn(module: string, message: string, data?: any): void {
  console.warn(formatMessage(module, message, data));
}
