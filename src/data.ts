import type { KanbanColumn, Project, Settings } from "./types";
import { DEFAULT_THEME } from "./themes";

export const PROJECT_COLORS = [
  "#22d3ee","#f97316","#a78bfa","#4ade80","#f472b6",
  "#60a5fa","#facc15","#fb923c","#34d399","#e879f9",
  "#f87171","#a3e635","#38bdf8","#c084fc","#fbbf24",
];

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "col-1", name: "Backlog",      color: "#6b7280", wipLimit: null, order: 0 },
  { id: "col-2", name: "In Progress",  color: "#f97316", wipLimit: 3,   order: 1 },
  { id: "col-3", name: "Review",       color: "#a78bfa", wipLimit: 2,   order: 2 },
  { id: "col-4", name: "Done",         color: "#4ade80", wipLimit: null, order: 3 },
];

export const seedProjects: Project[] = [];

export const defaultSettings: Settings = {
  name: "",
  workingHours: "9am – 6pm",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  gitHubToken: "",
  digestEnabled: false,
  theme: DEFAULT_THEME,
  onboarded: false,
  lastReviewPrompt: "",
};