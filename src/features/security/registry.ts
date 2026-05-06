import React from "react";
import { LucideIcon } from "lucide-react";

export interface SecurityApp {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  component: React.ComponentType;
  order?: number;
  enabled?: boolean;
}

const registry: SecurityApp[] = [];

export function registerSecurityApp(app: SecurityApp) {
  const existing = registry.findIndex((a) => a.id === app.id);
  if (existing >= 0) {
    registry[existing] = app;
  } else {
    registry.push(app);
  }
}

export function getSecurityApps(): SecurityApp[] {
  return registry
    .filter((a) => a.enabled !== false)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getSecurityApp(id: string): SecurityApp | undefined {
  return registry.find((a) => a.id === id);
}
