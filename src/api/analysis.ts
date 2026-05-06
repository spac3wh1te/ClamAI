import { apiRequest } from "./client";

export interface AnalysisTask {
  id: string;
  name: string;
  type: string;
  status: string;
  config: any;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface AnalysisHistory {
  id: string;
  task_id: string;
  status: string;
  result: any;
  started_at: string;
  completed_at: string;
}

export const analysisApi = {
  createTask: (data: {
    name: string;
    api_key_id: string;
    model: string;
    time_range?: string;
    schedule_type?: string;
    interval_minutes?: number;
  }) =>
    apiRequest<AnalysisTask>("POST", "/analysis/tasks", data),

  listTasks: () =>
    apiRequest<{ tasks: AnalysisTask[] }>("GET", "/analysis/tasks"),

  updateTask: (id: string, data: any) =>
    apiRequest<void>("PUT", `/analysis/tasks/${id}`, data),

  deleteTask: (id: string) =>
    apiRequest<void>("DELETE", `/analysis/tasks/${id}`),

  startTask: (id: string) =>
    apiRequest<void>("POST", `/analysis/tasks/${id}/start`),

  stopTask: (id: string) =>
    apiRequest<void>("POST", `/analysis/tasks/${id}/stop`),

  taskHistory: (id: string) =>
    apiRequest<{ history: AnalysisHistory[] }>("GET", `/analysis/tasks/${id}/history`),

  createSkillsTask: (data: {
    name: string;
    model: string;
    source_type?: string;
    source_info?: string;
  }) =>
    apiRequest<AnalysisTask>("POST", "/skills/tasks", data),

  listSkillsTasks: () =>
    apiRequest<{ tasks: AnalysisTask[] }>("GET", "/skills/tasks"),

  updateSkillsTask: (id: string, data: any) =>
    apiRequest<void>("PUT", `/skills/tasks/${id}`, data),

  deleteSkillsTask: (id: string) =>
    apiRequest<void>("DELETE", `/skills/tasks/${id}`),

  startSkillsTask: (id: string) =>
    apiRequest<void>("POST", `/skills/tasks/${id}/start`),

  stopSkillsTask: (id: string) =>
    apiRequest<void>("POST", `/skills/tasks/${id}/stop`),

  skillsTaskHistory: (id: string) =>
    apiRequest<{ history: AnalysisHistory[] }>("GET", `/skills/tasks/${id}/history`),

  getSkillsHistory: () =>
    apiRequest<{ history: any[] }>("GET", "/skills/history"),

  getProfileHistory: () =>
    apiRequest<{ history: any[] }>("GET", "/profile/history"),
};

export interface AgentScanResult {
  findings: any[];
  risk_level: string;
  summary: string;
}

export const agentApi = {
  scanLogs: (params: { log_path?: string; patterns?: string[] }) =>
    apiRequest<AgentScanResult>("POST", "/agent/scan-logs", params),

  checkEnv: () =>
    apiRequest<AgentScanResult>("POST", "/agent/env-check", {}),

  discover: () =>
    apiRequest<{ agents: any[] }>("GET", "/agent/discover"),

  deepCheck: (agentName: string, model?: string) =>
    apiRequest<AgentScanResult>("POST", "/agent/deep-check", { agent_name: agentName, model: model || "" }),

  pushSkills: (agentName: string, model: string) =>
    apiRequest<{ tasks: { id: string; task_no: string; file_name: string }[]; total: number; message: string }>("POST", "/agent/push-skills", { agent_name: agentName, model }),
};
