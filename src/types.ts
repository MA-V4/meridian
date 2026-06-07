export type ProjectStatus = "concept" | "active" | "paused" | "shipped";
export type TaskPriority = "high" | "med" | "low";
export type View = "dashboard" | "detail" | "ai" | "settings" | "kanban" | "focus" | "review" | "dependencies" | "timeline" | "tags" | "archive";

// ── KANBAN ────────────────────────────────────────────────────
export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
  wipLimit: number | null;
  order: number;
}

// ── TASKS / SUBTASKS ──────────────────────────────────────────
export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  priority: TaskPriority;
  due: string;
  note: string;
  subtasks: Subtask[];
  expanded: boolean;
}

// ── FOCUS SESSIONS ────────────────────────────────────────────
export interface FocusSession {
  date: string;       // ISO
  duration: number;   // seconds
  projectId: string;
}

// ── WEEKLY REVIEW ────────────────────────────────────────────
export interface WeeklyReview {
  weekStart: string;  // ISO Monday
  shipped: string[];  // project ids shipped this week
  blocked: string[];  // project ids marked as blocked
  notes: string;
  aiSummary: string;
  completedAt: string;
}

// ── PROJECT ───────────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  desc: string;
  track: string;
  status: ProjectStatus;
  impact: number;
  effort: number;
  energy: number;
  confidence: number;
  daysLeft: number;         // DEPRECATED — computed from deadlineDate at runtime
  deadlineDate: string;     // ISO date string e.g. "2026-06-21" — source of truth
  colorIdx: number;
  tags: string[];
  tasks: Task[];
  createdAt: string;
  lastTouched: string;      // ISO — updated whenever project is opened/edited
  decayDays: number;        // days of inactivity before decay kicks in (default 7)
  blockedBy: string[];      // ids of projects that must ship first
  kanbanColumnId?: string;
  focusSessions: FocusSession[];
  scoreHistory: { date: string; score: number }[];
}

export interface ProjectScore {
  score: number;
  rawScore: number;
  decayPenalty: number;
  blockPenalty: number;
  stage: string;
  liveDaysLeft: number;
}

// ── THEMES ────────────────────────────────────────────────────
export type AccentTheme =
  | "blood-noir"
  | "pure-light"
  | "parchment"
  | "ocean"
  | "forest"
  | "ember"
  | "violet"
  | "slate"
  | "midnight-gold"
  | "neon-tokyo";

export type TypographyTheme =
  | "serif-editorial"
  | "clean-sans"
  | "brutalist-mono"
  | "renaissance"
  | "system-native"
  | "slab-serif";

export type DensityTheme = "spacious" | "compact" | "ultra-dense";
export type TextureTheme = "flat" | "glass" | "paper" | "noise";
export type BorderRadiusTheme = "sharp" | "rounded" | "pill";
export type AnimationSpeedTheme = "snappy" | "normal" | "cinematic";
export type SidebarWidthTheme = "narrow" | "default" | "wide";
export type CardStyleTheme = "minimal" | "bordered" | "elevated";

export interface ThemeSettings {
  accent: AccentTheme;
  typography: TypographyTheme;
  density: DensityTheme;
  texture: TextureTheme;
  borderRadius: BorderRadiusTheme;
  animationSpeed: AnimationSpeedTheme;
  sidebarWidth: SidebarWidthTheme;
  cardStyle: CardStyleTheme;
}

// ── APP SETTINGS ──────────────────────────────────────────────
export interface Settings {
  name: string;
  workingHours: string;
  ollamaUrl: string;      // default: http://localhost:11434
  ollamaModel: string;    // e.g. llama3.2, mistral, gemma2
  gitHubToken: string;
  digestEnabled: boolean;
  theme: ThemeSettings;
  onboarded: boolean;
  lastReviewPrompt: string;
}