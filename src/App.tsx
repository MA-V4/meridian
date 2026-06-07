import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";

// ── Electron bridge types ──────────────────────────────────────
declare global {
  interface Window {
    electron?: {
      platform: string;
      getVersion: () => Promise<string>;
      updater: {
        check:    () => Promise<{ ok?: boolean; error?: string }>;
        download: () => Promise<{ ok?: boolean; error?: string }>;
        install:  () => void;
        on: (event: string, cb: (data: unknown) => void) => (() => void);
      };
      secrets: {
        isAvailable: () => Promise<boolean>;
        encrypt: (t: string) => Promise<{ ciphertext?: string; error?: string }>;
        decrypt: (c: string) => Promise<{ plaintext?: string; error?: string }>;
      };
    };
  }
}
import type {
  KanbanColumn, Project, ProjectStatus, Settings, ThemeSettings,
  Task, TaskPriority, View, AccentTheme, TypographyTheme,
  DensityTheme, TextureTheme, FocusSession, WeeklyReview,
  BorderRadiusTheme, AnimationSpeedTheme, SidebarWidthTheme, CardStyleTheme,
} from "./types";
import { seedProjects, defaultSettings, PROJECT_COLORS, DEFAULT_KANBAN_COLUMNS } from "./data";
import {
  scoreProject, projectColor, fmtDays, fmtDuration,
  taskCompletion, uid, exportJson, sortedByScore,
  askOllama, checkOllama, OLLAMA_NOT_RUNNING_MSG,
  OLLAMA_DEFAULT_URL, OLLAMA_DEFAULT_MODEL,
  totalFocusTime, focusThisWeek, getMondayISO,
  shouldPromptReview, appendScoreHistory, projectToMarkdown,
  allTags, buildTimeline,
  PROJECT_TEMPLATES, fetchGitHubIssues, type GitHubIssue,
  requestNotificationPermission, sendDigestNotification, scheduleDailyDigest,
} from "./utils";
import {
  applyTheme, ACCENT_THEMES, TYPOGRAPHY_THEMES, DENSITY_THEMES, TEXTURE_THEMES,
  BORDER_RADIUS_THEMES, ANIMATION_SPEED_THEMES, SIDEBAR_WIDTH_THEMES, CARD_STYLE_THEMES,
} from "./themes";

// ── STORAGE ───────────────────────────────────────────────────
const SK = {
  projects: "meridian.projects.v3",
  settings: "meridian.settings.v3",
  kanban:   "meridian.kanban.v2",
  reviews:  "meridian.reviews.v1",
};

const load = <T,>(key: string, fallback: T): T => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : fallback; }
  catch { return fallback; }
};
const persist = <T,>(key: string, val: T) => {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch (e) {
    // QuotaExceededError — attempt to free space by trimming score history
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.warn("[Meridian] localStorage quota exceeded — trimming score history");
      try {
        const projects = load<Project[]>(SK.projects, []);
        const trimmed = projects.map((p: Project) => ({ ...p, scoreHistory: (p.scoreHistory ?? []).slice(-7) }));
        localStorage.setItem(SK.projects, JSON.stringify(trimmed));
        localStorage.setItem(key, JSON.stringify(val));
      } catch { console.error("[Meridian] Could not recover from quota error."); }
    }
  }
};

// Compute days left from a deadline date (positive = future, negative = past)
// Compute live days left from a project (always fresh)
export function livedays(p: { deadlineDate?: string; daysLeft: number }): number {
  if (p.deadlineDate) {
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(p.deadlineDate); target.setHours(0,0,0,0);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }
  return p.daysLeft;
}

export function daysFromDeadline(deadlineDate: string): number {
  if (!deadlineDate) return 99;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(deadlineDate); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// Migrate old projects that may lack new fields
function migrateProject(p: Partial<Project>): Project {
  // If no deadlineDate, convert legacy daysLeft to a real date
  const deadlineDate = p.deadlineDate || (() => {
    const d = new Date();
    d.setDate(d.getDate() + (p.daysLeft ?? 14));
    return d.toISOString().slice(0, 10);
  })();
  return {
    focusSessions: [],
    scoreHistory: [],
    blockedBy: [],
    lastTouched: new Date().toISOString(),
    decayDays: 7,
    kanbanColumnId: "",
    tags: [],
    tasks: [],
    daysLeft: daysFromDeadline(deadlineDate), // computed, not stored raw
    ...p,
    deadlineDate,
  } as Project;
}

// ── HOOKS ─────────────────────────────────────────────────────
function useToast() {
  const [msg, setMsg] = useState(""); const [show, setShow] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m); setShow(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setShow(false), 2400);
  }, []);
  return { msg, show, toast };
}

function useTypewriter(word: string, speed = 88) {
  const [text, setText] = useState(""); const [done, setDone] = useState(false);
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      setText(word.slice(0, ++i));
      if (i === word.length) { clearInterval(id); setDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [word, speed]);
  return { text, done };
}

// ── BLANK PROJECT ─────────────────────────────────────────────
const blankProject = (colorIdx: number): Omit<Project, "id"> => {
  const d = new Date(); d.setDate(d.getDate() + 14);
  const deadlineDate = d.toISOString().slice(0, 10);
  return {
    name: "", desc: "", track: "", status: "concept",
    impact: 7, effort: 5, energy: 7, confidence: 7,
    daysLeft: 14, deadlineDate, colorIdx,
    tags: [] as string[], tasks: [],
    createdAt: new Date().toISOString(),
    lastTouched: new Date().toISOString(),
    decayDays: 7, blockedBy: [], kanbanColumnId: "",
    focusSessions: [], scoreHistory: [],
  };
};

// ── ICONS ─────────────────────────────────────────────────────
const I = {
  grid:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  kanban:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="5" height="18"/><rect x="10" y="3" width="5" height="12"/><rect x="17" y="3" width="5" height="15"/></svg>,
  ai:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2a4 4 0 0 1 4 4v2h1a3 3 0 0 1 0 6h-1v2a4 4 0 0 1-8 0v-2H7a3 3 0 0 1 0-6h1V6a4 4 0 0 1 4-4z"/></svg>,
  settings: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  focus:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  review:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>,
  deps:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  plus:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  check:    (sz = 10) => <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: sz, height: sz }}><polyline points="2,5 4,7 8,3"/></svg>,
  checkSm:  () => <svg viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 8, height: 8 }}><polyline points="1.5,4.5 3.5,6.5 7.5,2.5"/></svg>,
  send:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  timeline: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="14" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/></svg>,
  tag:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  search:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  cmd:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>,
  close:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  play:     () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>,
  pause:    () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/></svg>,
  reset:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>,
  skip:     () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5,3 15,12 5,21"/><rect x="17" y="3" width="3" height="18" rx="1"/></svg>,
  archive:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  unarchive:() => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><polyline points="8 12 12 8 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>,
  edit:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
};

const COL_COLORS = ["#6b7280","#f97316","#a78bfa","#4ade80","#f472b6","#60a5fa","#facc15","#22d3ee","#fb923c","#34d399","#e879f9","#f87171"];

// ── POMODORO COMPONENT ────────────────────────────────────────
type PomoMode = "work" | "break";
interface PomoState {
  running: boolean;
  mode: PomoMode;
  secondsLeft: number;
  workMins: number;
  breakMins: number;
  elapsed: number;
}

function Pomodoro({
  project, color, onSessionComplete,
}: {
  project: Project;
  color: string;
  onSessionComplete: (session: FocusSession) => void;
}) {
  const [state, setState] = useState<PomoState>({
    running: false, mode: "work",
    secondsLeft: 25 * 60, workMins: 25, breakMins: 5, elapsed: 0,
  });
  const [showSettings, setShowSettings] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state.running) {
      intervalRef.current = setInterval(() => {
        setState(s => {
          if (s.secondsLeft <= 1) {
            if (s.mode === "work") {
              onSessionComplete({ date: new Date().toISOString(), duration: s.workMins * 60, projectId: project.id });
              return { ...s, running: false, mode: "break", secondsLeft: s.breakMins * 60, elapsed: 0 };
            }
            return { ...s, running: false, mode: "work", secondsLeft: s.workMins * 60, elapsed: 0 };
          }
          return { ...s, secondsLeft: s.secondsLeft - 1, elapsed: s.elapsed + 1 };
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.running]);

  const startPause = () => setState(s => ({ ...s, running: !s.running }));
  const reset = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (state.mode === "work" && state.elapsed >= 60)
      onSessionComplete({ date: new Date().toISOString(), duration: state.elapsed, projectId: project.id });
    setState(s => ({ ...s, running: false, secondsLeft: s.workMins * 60, elapsed: 0, mode: "work" }));
  };
  const skip = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (state.mode === "work" && state.elapsed >= 60)
      onSessionComplete({ date: new Date().toISOString(), duration: state.elapsed, projectId: project.id });
    setState(s => {
      const next: PomoMode = s.mode === "work" ? "break" : "work";
      return { ...s, running: false, mode: next, secondsLeft: next === "break" ? s.breakMins * 60 : s.workMins * 60, elapsed: 0 };
    });
  };

  const totalSecs = state.mode === "work" ? state.workMins * 60 : state.breakMins * 60;
  const pct       = state.elapsed / totalSecs;
  const radius    = 74;
  const circ      = 2 * Math.PI * radius;
  const mins      = Math.floor(state.secondsLeft / 60);
  const secs      = state.secondsLeft % 60;
  const ringColor = state.mode === "work" ? color : "var(--text3)";
  const isWork    = state.mode === "work";

  const sessions  = project.focusSessions ?? [];
  const todayStr  = new Date().toISOString().slice(0, 10);
  const todayTime = sessions.filter(s => s.date.slice(0, 10) === todayStr).reduce((a, s) => a + s.duration, 0);
  const recent    = [...sessions].reverse().slice(0, 6);

  return (
    <div className="pomo-wrap">
      {/* Stats */}
      <div className="focus-stats-grid">
        <div className="focus-stat"><div className="focus-stat-lbl">Today</div><div className="focus-stat-val" style={{ color }}>{fmtDuration(todayTime)}</div></div>
        <div className="focus-stat"><div className="focus-stat-lbl">This week</div><div className="focus-stat-val">{fmtDuration(focusThisWeek(sessions))}</div></div>
        <div className="focus-stat"><div className="focus-stat-lbl">All time</div><div className="focus-stat-val">{fmtDuration(totalFocusTime(sessions))}</div></div>
        <div className="focus-stat"><div className="focus-stat-lbl">Sessions</div><div className="focus-stat-val">{sessions.length}</div></div>
      </div>

      {/* Mode + elapsed */}
      <div className="pomo-mode-row">
        <span className="pomo-mode-pill" style={{ background: isWork ? color + "18" : "var(--bg3)", border: `1px solid ${isWork ? color + "44" : "var(--rule2)"}`, color: isWork ? color : "var(--text3)" }}>
          {isWork ? "Work session" : "Break time"}
        </span>
        {state.elapsed > 0 && isWork && (
          <span className="pomo-elapsed">{fmtDuration(state.elapsed)} elapsed</span>
        )}
      </div>

      {/* Ring */}
      <div className="pomo-ring-wrap">
        <div className="pomo-ring">
          <svg viewBox="0 0 180 180">
            <circle className="pomo-ring-bg" cx="90" cy="90" r={radius} />
            <circle className="pomo-ring-progress" cx="90" cy="90" r={radius}
              stroke={ringColor} strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
              style={{ transition: "stroke-dashoffset 1s linear, stroke 0.4s" }} />
          </svg>
          <div className="pomo-time">
            <div className="pomo-time-display" style={{ color: state.running ? ringColor : "var(--text)" }}>
              {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
            </div>
            <div className="pomo-mode-label" style={{ color: "var(--text3)" }}>
              {state.running ? (isWork ? "focusing" : "resting") : state.elapsed > 0 ? "paused" : "ready"}
            </div>
          </div>
        </div>
      </div>

      {/* Controls — Reset | Start/Pause | Skip */}
      <div className="pomo-controls">
        <button className="pomo-btn pomo-btn-secondary" onClick={reset} title="Reset (saves partial session)">
          <I.reset /><span>Reset</span>
        </button>
        <button className="pomo-btn pomo-btn-primary" onClick={startPause}
          style={{ background: state.running ? "transparent" : color, borderColor: color, color: state.running ? color : "var(--bg)" }}>
          {state.running ? <I.pause /> : <I.play />}
          <span>{state.running ? "Pause" : state.elapsed > 0 ? "Resume" : "Start"}</span>
        </button>
        <button className="pomo-btn pomo-btn-secondary" onClick={skip} title={`Skip to ${isWork ? "break" : "work"}`}>
          <I.skip /><span>Skip</span>
        </button>
      </div>

      {/* Timer settings */}
      <div className="pomo-settings-row">
        <button className="pomo-settings-toggle" onClick={() => setShowSettings(s => !s)}>
          Timer lengths {showSettings ? "▲" : "▼"}
        </button>
        {showSettings && (
          <div className="pomo-settings">
            <label><span>Work</span>
              <input type="number" min={1} max={90} value={state.workMins}
                onChange={e => setState(s => ({ ...s, workMins: +e.target.value, ...(!s.running && s.mode === "work" ? { secondsLeft: +e.target.value * 60 } : {}) }))} />
              <span>min</span>
            </label>
            <label><span>Break</span>
              <input type="number" min={1} max={30} value={state.breakMins}
                onChange={e => setState(s => ({ ...s, breakMins: +e.target.value, ...(!s.running && s.mode === "break" ? { secondsLeft: +e.target.value * 60 } : {}) }))} />
              <span>min</span>
            </label>
          </div>
        )}
      </div>

      {/* Session log */}
      {recent.length > 0 && (
        <div className="session-log">
          <div className="session-log-head">Session history</div>
          {recent.map((s, i) => (
            <div key={i} className="session-log-item">
              <span className="session-log-date">{new Date(s.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
              <div className="session-log-bar-wrap"><div className="session-log-bar" style={{ width: `${Math.min((s.duration / (25 * 60)) * 100, 100)}%`, background: color }} /></div>
              <span className="session-log-dur">{fmtDuration(s.duration)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SPARKLINE ─────────────────────────────────────────────────
function Sparkline({ history, color }: { history: { date: string; score: number }[]; color: string }) {
  if (history.length < 2) return null;
  const W = 200, H = 28;
  const scores = history.map(h => h.score);
  const min = Math.min(...scores), max = Math.max(...scores);
  const range = max - min || 1;
  const pts = history.map((h, i) => ({
    x: (i / (history.length - 1)) * W,
    y: H - ((h.score - min) / range) * H * 0.8 - H * 0.1,
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = pathD + ` L${W},${H} L0,${H} Z`;
  return (
    <div className="sparkline-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path className="sparkline-area" d={areaD} fill={color} />
        <path className="sparkline-path" d={pathD} stroke={color} />
      </svg>
    </div>
  );
}

// ── DEPENDENCY GRAPH ──────────────────────────────────────────
function DepGraph({ projects, onSelect }: { projects: Project[]; onSelect: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projects.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W;
    canvas.height = H;

    // Layout: columns by dependency depth
    const depths: Record<string, number> = {};
    const getDepth = (id: string, visited = new Set<string>()): number => {
      if (depths[id] !== undefined) return depths[id];
      if (visited.has(id)) return 0;
      visited.add(id);
      const p = projects.find(x => x.id === id);
      if (!p?.blockedBy?.length) { depths[id] = 0; return 0; }
      const d = 1 + Math.max(...p.blockedBy.map(bid => getDepth(bid, new Set(visited))));
      depths[id] = d;
      return d;
    };
    projects.forEach(p => getDepth(p.id));

    const maxDepth = Math.max(...Object.values(depths), 0);
    const colW = W / (maxDepth + 2);
    const positions: Record<string, { x: number; y: number }> = {};
    const byDepth: Record<number, string[]> = {};
    Object.entries(depths).forEach(([id, d]) => {
      byDepth[d] = byDepth[d] ?? [];
      byDepth[d].push(id);
    });

    Object.entries(byDepth).forEach(([d, ids]) => {
      const col = Number(d);
      ids.forEach((id, i) => {
        positions[id] = {
          x: colW * (col + 0.8),
          y: (H / (ids.length + 1)) * (i + 1),
        };
      });
    });

    // Draw edges
    projects.forEach(p => {
      (p.blockedBy ?? []).forEach(bid => {
        const from = positions[bid];
        const to = positions[p.id];
        if (!from || !to) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        const cpx = (from.x + to.x) / 2;
        ctx.bezierCurveTo(cpx, from.y, cpx, to.y, to.x, to.y);
        ctx.strokeStyle = "rgba(240,236,228,0.15)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Arrow head
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - 8 * Math.cos(angle - 0.4), to.y - 8 * Math.sin(angle - 0.4));
        ctx.lineTo(to.x - 8 * Math.cos(angle + 0.4), to.y - 8 * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = "rgba(240,236,228,0.25)";
        ctx.fill();
      });
    });

    // Draw nodes
    projects.forEach(p => {
      const pos = positions[p.id];
      if (!pos) return;
      const color = PROJECT_COLORS[p.colorIdx % PROJECT_COLORS.length];
      const sc = scoreProject(p, projects);
      const r = 22;

      // Node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color + "22";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = p.blockedBy?.length ? 2 : 1.5;
      ctx.stroke();

      // Score text
      ctx.fillStyle = color;
      ctx.font = "bold 10px 'DM Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${sc.score}%`, pos.x, pos.y);

      // Name below
      const maxLen = 14;
      const label = p.name.length > maxLen ? p.name.slice(0, maxLen) + "…" : p.name;
      ctx.fillStyle = "rgba(240,236,228,0.65)";
      ctx.font = "9px 'DM Mono', monospace";
      ctx.fillText(label, pos.x, pos.y + r + 11);
    });

    // Click handler
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const p of projects) {
        const pos = positions[p.id];
        if (!pos) continue;
        if (Math.hypot(mx - pos.x, my - pos.y) < 26) {
          onSelect(p.id);
          break;
        }
      }
    };
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [projects, onSelect]);

  return (
    <div className="dep-canvas-wrap">
      <canvas ref={canvasRef} className="dep-canvas" />
      <div className="dep-canvas-hint">Click a node to open project · Arrows show blocking direction</div>
    </div>
  );
}

// ── WEEKLY REVIEW MODAL ───────────────────────────────────────
function WeeklyReviewModal({
  projects,
  ollamaUrl,
  ollamaModel,
  onComplete,
  onDismiss,
}: {
  projects: Project[];
  ollamaUrl: string;
  ollamaModel: string;
  onComplete: (review: WeeklyReview) => void;
  onDismiss: () => void;
}) {
  const [shipped, setShipped] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState("");
  const [generating, setGenerating] = useState(false);

  const toggle = (id: string, list: string[], setter: (v: string[]) => void) =>
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const generateSummary = async () => {
    setGenerating(true);
    const shippedNames = shipped.map(id => projects.find(p => p.id === id)?.name ?? id).join(", ");
    const blockedNames = blocked.map(id => projects.find(p => p.id === id)?.name ?? id).join(", ");
    const prompt = `Weekly review summary. Shipped: ${shippedNames || "nothing"}. Blocked: ${blockedNames || "nothing"}. Notes: ${notes || "none"}. Summarise in 2 sentences and suggest one priority for next week.`;

    try {
      const result = await askOllama(ollamaUrl, ollamaModel, prompt, projects);
      setSummary(result);
    } catch {
      setSummary("Could not generate summary — make sure Ollama is running.");
    } finally {
      setGenerating(false);
    }
  };

  const complete = () => {
    onComplete({
      weekStart: getMondayISO(new Date()),
      shipped, blocked, notes,
      aiSummary: summary,
      completedAt: new Date().toISOString(),
    });
  };

  const sorted = sortedByScore(projects, projects);

  return (
    <div className="review-backdrop">
      <div className="review-modal">
        <div className="review-header">
          <div className="review-title">Weekly Review</div>
          <div className="review-sub">
            Week of {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
        <div className="review-body">

          <div>
            <div className="review-section-title">What shipped this week?</div>
            <div className="review-proj-list">
              {sorted.map(p => (
                <div key={p.id} className={`review-proj-item${shipped.includes(p.id) ? " selected" : ""}`}
                  onClick={() => toggle(p.id, shipped, setShipped)}>
                  <div className="review-proj-dot" style={{ background: projectColor(p) }} />
                  <span className="review-proj-name">{p.name}</span>
                  <div className="review-check" style={shipped.includes(p.id) ? { background: projectColor(p), borderColor: "transparent" } : {}}>
                    {shipped.includes(p.id) && <svg viewBox="0 0 10 10" fill="none" stroke="var(--bg)" strokeWidth="2.5" style={{ width: 9, height: 9 }}><polyline points="2,5 4,7 8,3" /></svg>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="review-section-title">What's blocked or stuck?</div>
            <div className="review-proj-list">
              {sorted.filter(p => p.status !== "shipped").map(p => (
                <div key={p.id} className={`review-proj-item${blocked.includes(p.id) ? " selected" : ""}`}
                  onClick={() => toggle(p.id, blocked, setBlocked)}>
                  <div className="review-proj-dot" style={{ background: projectColor(p) }} />
                  <span className="review-proj-name">{p.name}</span>
                  <div className="review-check" style={blocked.includes(p.id) ? { background: "#ef4444", borderColor: "transparent" } : {}}>
                    {blocked.includes(p.id) && <svg viewBox="0 0 10 10" fill="none" stroke="var(--bg)" strokeWidth="2.5" style={{ width: 9, height: 9 }}><polyline points="2,5 4,7 8,3" /></svg>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="review-section-title">Notes & reflections</div>
            <textarea className="review-notes" placeholder="What did you learn this week? What will you do differently?" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {summary && (
            <div>
              <div className="review-section-title">AI summary</div>
              <div className="review-ai-summary">{summary}</div>
            </div>
          )}

        </div>
        <div className="review-footer">
          <button className="btn-cancel" onClick={onDismiss}>Skip for now</button>
          <button className="btn-cancel" onClick={generateSummary} disabled={generating}>
            {generating ? "Generating…" : "Generate AI summary"}
          </button>
          <button className="btn-save" onClick={complete}>Complete review →</button>
        </div>
      </div>
    </div>
  );
}

// ── TAG INPUT COMPONENT ───────────────────────────────────────
function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [raw, setRaw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (val: string) => {
    const cleaned = val.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (cleaned && !tags.includes(cleaned)) {
      onChange([...tags, cleaned]);
    }
    setRaw("");
  };

  const removeTag = (tag: string) => onChange(tags.filter(t => t !== tag));

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "," || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      addTag(raw);
    }
    if (e.key === "Backspace" && !raw && tags.length) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="tag-input-wrap" onClick={() => inputRef.current?.focus()}>
      {tags.map(t => (
        <span key={t} className="tag-pill">
          {t}
          <span className="tag-pill-remove" onClick={e => { e.stopPropagation(); removeTag(t); }}>×</span>
        </span>
      ))}
      <input
        ref={inputRef}
        className="tag-raw-input"
        value={raw}
        onChange={e => setRaw(e.target.value.replace(/,/g, ""))}
        onKeyDown={handleKey}
        onBlur={() => { if (raw.trim()) addTag(raw); }}
        placeholder={tags.length ? "" : "Type a tag, press comma or Enter…"}
      />
    </div>
  );
}

// ── GITHUB SYNC COMPONENT ─────────────────────────────────────
function GitHubSync({
  token, projectId, existingTaskTexts, onImport, onTokenChange,
}: {
  token: string;
  projectId: string;
  existingTaskTexts: string[];
  onImport: (title: string, note: string) => void;
  onTokenChange: (t: string) => void;
}) {
  const [tokenDraft, setTokenDraft] = useState(token);
  const [repo, setRepo] = useState("");
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<Set<number>>(new Set());

  const fetch_ = async () => {
    const parts = repo.trim().replace("https://github.com/", "").split("/");
    if (parts.length < 2) { setError("Enter repo as owner/repo or paste the GitHub URL."); return; }
    const [owner, repoName] = parts;
    setLoading(true); setError("");
    try {
      const data = await fetchGitHubIssues(tokenDraft, owner, repoName);
      setIssues(data);
      onTokenChange(tokenDraft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch issues.");
    } finally { setLoading(false); }
  };

  const importIssue = (issue: GitHubIssue) => {
    onImport(issue.title, `#${issue.number} · ${issue.html_url}`);
    setImported(s => new Set([...s, issue.id]));
  };

  const connected = !!token;

  return (
    <div className="github-panel">
      <div className="github-header">
        <span className="github-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
        </span>
        <div className="github-header-text">
          <p>GitHub Issues Sync</p>
          <span>Import open issues as tasks for this project</span>
        </div>
        <span className={`github-status`}>
          <span className={`github-status-dot${connected ? " connected" : ""}`} />
          {connected ? "Token saved" : "Not connected"}
        </span>
      </div>
      <div className="github-body">
        <div className="github-row">
          <input className="github-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx (GitHub token)" value={tokenDraft} onChange={e => setTokenDraft(e.target.value)} />
        </div>
        <div className="github-row">
          <input className="github-input" placeholder="owner/repo or paste GitHub URL" value={repo} onChange={e => setRepo(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetch_()} />
          <button className="github-import-btn" onClick={fetch_} disabled={loading}>
            {loading ? "Loading…" : "Fetch issues"}
          </button>
        </div>
        {error && <div style={{ fontSize: 11, color: "#ef4444", fontFamily: "var(--font-mono)", marginBottom: 8 }}>{error}</div>}
        {issues.length > 0 && (
          <div className="github-issues">
            {issues.map(issue => {
              const alreadyImported = imported.has(issue.id) ||
                existingTaskTexts.some(t => t.includes(`#${issue.number}`));
              return (
                <div key={issue.id} className={`github-issue${alreadyImported ? " imported" : ""}`}>
                  <span className="github-issue-num">#{issue.number}</span>
                  <div className="github-issue-body">
                    <div className="github-issue-title">{issue.title}</div>
                    <div className="github-issue-meta">
                      {issue.labels.map(l => (
                        <span key={l.name} className="github-label" style={{ borderColor: `#${l.color}40`, color: `#${l.color}` }}>
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!alreadyImported && (
                    <button className="github-import-btn" onClick={() => importIssue(issue)}>Import</button>
                  )}
                  {alreadyImported && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text4)" }}>Added</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {issues.length === 0 && !loading && !error && (
          <div style={{ fontSize: 11, color: "var(--text4)", fontStyle: "italic", fontFamily: "var(--font-body)", marginTop: 4 }}>
            Enter a repo and fetch to see open issues.
          </div>
        )}
      </div>
    </div>
  );
}

// ── COMMAND PALETTE ───────────────────────────────────────────
const ACTIONS = [
  { id: "new",         label: "New project",            view: null as View | null, icon: "plus" },
  { id: "dashboard",   label: "Go to Dashboard",         view: "dashboard" as View, icon: "grid" },
  { id: "kanban",      label: "Go to Kanban",            view: "kanban" as View,    icon: "kanban" },
  { id: "timeline",    label: "Go to Timeline",          view: "timeline" as View,  icon: "timeline" },
  { id: "tags",        label: "Go to Tags",              view: "tags" as View,      icon: "tag" },
  { id: "dependencies",label: "Go to Dependencies",      view: "dependencies" as View, icon: "deps" },
  { id: "review",      label: "Go to Weekly Review",     view: "review" as View,    icon: "review" },
  { id: "ai",          label: "Go to AI Advisor",        view: "ai" as View,        icon: "ai" },
  { id: "archive",     label: "Go to Archive",           view: "archive" as View,   icon: "archive" },
  { id: "settings",    label: "Go to Settings",          view: "settings" as View,  icon: "settings" },
];

function CommandPalette({
  projects, query, selected, onQueryChange, onSelectedChange,
  onAction, onProjectOpen, onTaskOpen, onClose,
}: {
  projects: Project[]; query: string; selected: number;
  onQueryChange: (q: string) => void; onSelectedChange: (i: number) => void;
  onAction: (id: string, view: View | null) => void;
  onProjectOpen: (id: string) => void;
  onTaskOpen: (projectId: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const q = query.toLowerCase().trim();

  const matchedActions = ACTIONS.filter(a => !q || a.label.toLowerCase().includes(q));
  const matchedProjects = projects.filter(p =>
    !q || p.name.toLowerCase().includes(q) || p.track.toLowerCase().includes(q) || p.tags.some(t => t.includes(q))
  ).slice(0, 6);
  const matchedTasks: { project: Project; task: Task }[] = q.length >= 2
    ? projects.flatMap(p => p.tasks.filter(t => t.text.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)).slice(0, 2).map(task => ({ project: p, task }))).slice(0, 5)
    : [];

  const totalItems = matchedActions.length + matchedProjects.length + matchedTasks.length;

  const highlight = (text: string) => {
    if (!q) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <>{text}</>;
    return <>{text.slice(0, idx)}<mark>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); onSelectedChange(Math.min(selected + 1, totalItems - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); onSelectedChange(Math.max(selected - 1, 0)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const aLen = matchedActions.length, pLen = matchedProjects.length;
        if (selected < aLen)          { onAction(matchedActions[selected].id, matchedActions[selected].view); }
        else if (selected < aLen+pLen){ onProjectOpen(matchedProjects[selected - aLen].id); }
        else { const t = matchedTasks[selected - aLen - pLen]; if (t) onTaskOpen(t.project.id); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, matchedActions, matchedProjects, matchedTasks, totalItems]);

  const IconForId = (id: string) => {
    const map: Record<string, () => React.ReactElement> = {
      plus: I.plus, grid: I.grid, kanban: I.kanban, timeline: I.timeline,
      tag: I.tag, deps: I.deps, review: I.review, ai: I.ai,
      settings: I.settings, focus: I.focus, archive: I.archive,
    };
    const Comp = map[id]; return Comp ? <Comp /> : <I.grid />;
  };

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd-box" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-icon"><I.search /></span>
          <input ref={inputRef} className="cmd-input"
            placeholder="Search projects, tasks, notes, tags…"
            value={query} onChange={e => { onQueryChange(e.target.value); onSelectedChange(0); }} />
          <span className="cmd-hint"><kbd>esc</kbd></span>
        </div>
        <div className="cmd-results">
          {matchedActions.length > 0 && (<>
            <div className="cmd-section-label">Actions</div>
            {matchedActions.map((a, i) => (
              <div key={a.id} className={`cmd-item${i === selected ? " selected" : ""}`}
                onClick={() => onAction(a.id, a.view)} onMouseEnter={() => onSelectedChange(i)}>
                <span className="cmd-item-icon">{IconForId(a.icon)}</span>
                <span className="cmd-item-label">{highlight(a.label)}</span>
              </div>
            ))}
          </>)}
          {matchedProjects.length > 0 && (<>
            <div className="cmd-section-label">Projects</div>
            {matchedProjects.map((p, i) => {
              const gi = matchedActions.length + i;
              const sc = scoreProject(p, projects); const color = projectColor(p);
              return (
                <div key={p.id} className={`cmd-item${gi === selected ? " selected" : ""}`}
                  onClick={() => onProjectOpen(p.id)} onMouseEnter={() => onSelectedChange(gi)}>
                  <span className="cmd-item-dot" style={{ background: color }} />
                  <span className="cmd-item-label">{highlight(p.name)}</span>
                  <span className="cmd-item-meta">{p.track}</span>
                  <span className="cmd-item-score" style={{ color }}>{sc.score}%</span>
                </div>
              );
            })}
          </>)}
          {matchedTasks.length > 0 && (<>
            <div className="cmd-section-label">Tasks</div>
            {matchedTasks.map(({ project: p, task: t }, i) => {
              const gi = matchedActions.length + matchedProjects.length + i;
              const color = projectColor(p);
              return (
                <div key={t.id} className={`cmd-item${gi === selected ? " selected" : ""}`}
                  onClick={() => onTaskOpen(p.id)} onMouseEnter={() => onSelectedChange(gi)}>
                  <span className="cmd-item-dot" style={{ background: color }} />
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span className="cmd-item-label" style={{ textDecoration: t.done ? "line-through" : "none" }}>{highlight(t.text)}</span>
                    <span className="cmd-item-meta" style={{ fontSize: 10 }}>{p.name}</span>
                  </div>
                  <span className="cmd-item-meta" style={{ flexShrink: 0 }}>{t.priority}</span>
                </div>
              );
            })}
          </>)}
          {totalItems === 0 && <div className="cmd-empty">No results for "{query}"</div>}
        </div>
        <div className="cmd-footer">
          <span className="cmd-kbd-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="cmd-kbd-hint"><kbd>↵</kbd> open</span>
          <span className="cmd-kbd-hint"><kbd>⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}

// ── TIMELINE VIEW ─────────────────────────────────────────────
function TimelineView({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  const all = projects;
  const DAYS_BACK = 14;
  const DAYS_FORWARD = 60;
  const TOTAL_DAYS = DAYS_BACK + DAYS_FORWARD;

  const entries = buildTimeline(projects, all);

  // Find deadline collisions (projects due within 3 days of each other)
  const collisions = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (Math.abs(entries[i].daysLeft - entries[j].daysLeft) <= 3) {
        collisions.add(entries[i].project.id);
        collisions.add(entries[j].project.id);
      }
    }
  }

  const todayPct = DAYS_BACK / TOTAL_DAYS * 100;

  const months: string[] = [];
  for (let d = -DAYS_BACK; d <= DAYS_FORWARD; d += Math.floor(TOTAL_DAYS / 6)) {
    const date = new Date(Date.now() + d * 86400000);
    months.push(date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
  }

  return (
    <div className="timeline-view">
      <div className="timeline-header">
        <div>
          <div className="timeline-title">Project Timeline</div>
          <div className="timeline-sub">Deadline overview for all active projects · Red markers = deadlines · Striped = overdue</div>
        </div>
        <div className="timeline-legend">
          <span className="tl-legend-item"><span className="tl-legend-dot" style={{ background: "var(--accent)" }} />Today</span>
          <span className="tl-legend-item"><span className="tl-legend-dot" style={{ background: "#ef4444" }} />Deadline</span>
          <span className="tl-legend-item"><span className="tl-legend-dot" style={{ background: "#f59e0b" }} />Collision</span>
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-grid">
          {/* Axis */}
          <div className="tl-axis">
            {months.map((m, i) => (
              <div key={i} className="tl-axis-label">{m}</div>
            ))}
          </div>

          {entries.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text4)", fontStyle: "italic", fontSize: 13 }}>
              No active projects to display.
            </div>
          )}

          {entries.map(({ project: p, score: sc, color, daysLeft, overdue }) => {
            // Bar position: today is at todayPct%, bar ends at deadline
            const barEndPct = todayPct + (daysLeft / TOTAL_DAYS) * 100;
            const barStartPct = Math.max(0, barEndPct - 30); // bars show ~30 day "active" window
            const barWidth = Math.max(barEndPct - barStartPct, 2);
            const clampedEnd = Math.min(barEndPct, 100);
            const clampedWidth = Math.min(barWidth, clampedEnd - Math.max(barStartPct, 0));
            const deadlinePct = Math.min(Math.max(todayPct + (daysLeft / TOTAL_DAYS) * 100, 0), 100);
            const hasCollision = collisions.has(p.id);

            return (
              <div key={p.id} className="tl-row">
                <div className="tl-row-label" onClick={() => onOpen(p.id)}>
                  <div className="tl-row-dot" style={{ background: color }} />
                  <span className="tl-row-name">{p.name}</span>
                </div>
                <div className="tl-track">
                  {/* Today line */}
                  <div className="tl-today-line" style={{ left: `${todayPct}%` }}>
                    <span className="tl-today-label">today</span>
                  </div>
                  {/* Project bar */}
                  {clampedWidth > 0 && (
                    <div
                      className={`tl-bar${overdue ? " overdue" : ""}`}
                      style={{
                        left: `${Math.max(barStartPct, 0)}%`,
                        width: `${clampedWidth}%`,
                        background: overdue ? "#ef444433" : color + "33",
                        borderLeft: `2px solid ${overdue ? "#ef4444" : color}`,
                      }}
                      onClick={() => onOpen(p.id)}>
                      <span className="tl-bar-label" style={{ color: overdue ? "#ef4444" : color }}>
                        {overdue ? `${Math.abs(daysLeft)}d late` : `${daysLeft}d`}
                      </span>
                    </div>
                  )}
                  {/* Deadline marker */}
                  {deadlinePct >= 0 && deadlinePct <= 100 && (
                    <div className="tl-deadline-marker" style={{ left: `${deadlinePct}%` }} />
                  )}
                  {/* Collision warning */}
                  {hasCollision && (
                    <span className="tl-collision">⚠ deadline clash</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── TAGS VIEW ─────────────────────────────────────────────────
function TagsView({
  projects, activeTag, onTagSelect, onOpen,
}: {
  projects: Project[]; activeTag: string | null;
  onTagSelect: (tag: string | null) => void; onOpen: (id: string) => void;
}) {
  const tags = allTags(projects);
  const filtered = activeTag ? projects.filter(p => p.tags.includes(activeTag)) : projects;
  const sorted = sortedByScore(filtered, projects);

  return (
    <div className="tags-view">
      <div className="tags-header">
        <div className="tags-title">Tags</div>
        <div className="tags-sub">Browse and filter projects by tag · Click a tag to filter</div>
      </div>
      <div className="tags-body">
        {/* Tag cloud */}
        <div className="tag-cloud-panel">
          <div className="tag-cloud-label">All tags</div>
          <button className={`tag-all-btn${!activeTag ? " active" : ""}`} onClick={() => onTagSelect(null)}>
            All projects ({projects.length})
          </button>
          <div className="tag-cloud">
            {tags.map(({ tag, count }) => (
              <div key={tag}
                className={`tag-cloud-item${activeTag === tag ? " active" : ""}`}
                onClick={() => onTagSelect(activeTag === tag ? null : tag)}>
                {tag}
                <span className="tag-cloud-count">{count}</span>
              </div>
            ))}
            {tags.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--text4)", fontStyle: "italic" }}>
                No tags yet. Add tags when creating projects.
              </div>
            )}
          </div>

          {/* Velocity panel */}
          {sorted.length > 0 && (
            <div className="velocity-panel" style={{ marginTop: 20 }}>
              <div className="velocity-label">Score velocity (30 days)</div>
              <div className="velocity-rows">
                {sorted.filter(p => (p.scoreHistory ?? []).length >= 2).slice(0, 6).map(p => {
                  const color = projectColor(p);
                  const hist = p.scoreHistory ?? [];
                  const current = hist[hist.length - 1]?.score ?? 0;
                  const start = hist[0]?.score ?? current;
                  const delta = current - start;
                  return (
                    <div key={p.id} className="velocity-row">
                      <span className="velocity-row-name">{p.name}</span>
                      <div className="velocity-row-spark">
                        <Sparkline history={hist} color={color} />
                      </div>
                      <span className="velocity-row-val" style={{ color: delta > 0 ? "#4ade80" : delta < 0 ? "#ef4444" : "var(--text3)" }}>
                        {delta > 0 ? "+" : ""}{delta}
                      </span>
                    </div>
                  );
                })}
                {sorted.filter(p => (p.scoreHistory ?? []).length >= 2).length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--text4)", fontStyle: "italic" }}>
                    Score history builds over time as you use Meridian.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Projects for tag */}
        <div className="tags-projects-panel">
          <div className="tags-section-head">
            <div className="tags-section-title">
              {activeTag ? `#${activeTag}` : "All projects"}
            </div>
            <span className="tags-section-count">{sorted.length} {sorted.length === 1 ? "project" : "projects"}</span>
          </div>
          {sorted.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text4)", fontStyle: "italic" }}>No projects with this tag.</div>
          )}
          <div className="cards-grid">
            {sorted.map(p => {
              const sc = scoreProject(p, projects);
              const color = projectColor(p);
              const comp = taskCompletion(p);
              return (
                <div key={p.id} className="proj-card"
                  style={{ "--pc": color } as React.CSSProperties}
                  onClick={() => onOpen(p.id)}>
                  <div className="pc-top">
                    <div className="pc-name">{p.name}</div>
                    <div className="pc-score" style={{ color }}>{sc.score}%</div>
                  </div>
                  <div className="pc-desc">{p.desc}</div>
                  <div className="pc-pills">
                    <span className="pill" style={{ color, borderColor: "rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)" }}>{sc.stage}</span>
                    {p.tags.map(t => (
                      <span key={t} className={`pill${t === activeTag ? " pill-accent" : " pill-dim"}`}
                        style={t === activeTag ? {} : {}}
                        onClick={e => { e.stopPropagation(); onTagSelect(t); }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                  <div className="pc-progress"><div className="pc-progress-fill" style={{ width: `${comp}%`, background: color }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── APP ────────────────────────────────────────────────────────

export default function App() {
  const [projects, setProjects]       = useState<Project[]>(() =>
    load<Project[]>(SK.projects, seedProjects).map(migrateProject)
  );
  const [settings, setSettings]       = useState<Settings>(() => load(SK.settings, defaultSettings));
  const [columns, setColumns]         = useState<KanbanColumn[]>(() => load(SK.kanban, DEFAULT_KANBAN_COLUMNS));
  const [reviews, setReviews]         = useState<WeeklyReview[]>(() => load(SK.reviews, []));
  const [view, setView]               = useState<View>("dashboard");
  const [selectedId, setSelectedId]   = useState(projects[0]?.id ?? "");
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [colorCounter, setColorCounter] = useState(projects.length);
  const [draft, setDraft]             = useState<Omit<Project, "id">>(blankProject(0));
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [dragCardId, setDragCardId]   = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [showReview, setShowReview]   = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [aiMessages, setAiMessages]   = useState<{ role: "bot"|"user"; text: string }[]>([
    { role: "bot", text: "Hello — I'm your Meridian AI advisor, powered by Ollama. Hit \"Check status\" to confirm Ollama is running, then ask me anything about your projects." },
  ]);
  const [aiInput, setAiInput]         = useState("");
  const [aiLoading, setAiLoading]     = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<{ running: boolean; models: string[]; checked: boolean }>({ running: false, models: [], checked: false });
  // ── Auto-updater state ─────────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<{ version: string; state: "available"|"downloading"|"ready"|"error"; percent?: number; error?: string } | null>(null);
  // ── Task drag state ────────────────────────────────────────
  const [dragTaskId, setDragTaskId]   = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [nameInput, setNameInput]     = useState("");
  const [cmdOpen, setCmdOpen]         = useState(false);
  const [cmdQuery, setCmdQuery]       = useState("");
  const [cmdSelected, setCmdSelected] = useState(0);
  const [activeTag, setActiveTag]     = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showGitHub, setShowGitHub]   = useState(false);
  const [ghTokenDraft, setGhTokenDraft] = useState("");
  const [editingProject, setEditingProject] = useState(false);
  const [editDraft, setEditDraft]     = useState<Partial<Project>>({});
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState("");
  const [addingTaskPid, setAddingTaskPid] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState("");
  const [addingColumnName, setAddingColumnName] = useState("");
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [showBlockerSelect, setShowBlockerSelect] = useState<string | null>(null); // project id

  const { msg: toastMsg, show: toastShow, toast } = useToast();
  const { text: brandText, done: brandDone } = useTypewriter("Meridian");
  const fileRef  = useRef<HTMLInputElement>(null);
  const chatRef  = useRef<HTMLDivElement>(null);
  const undoRef  = useRef<(() => void) | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const theme: ThemeSettings = Object.assign(
      {
        borderRadius:   "sharp"   as BorderRadiusTheme,
        animationSpeed: "normal"  as AnimationSpeedTheme,
        sidebarWidth:   "default" as SidebarWidthTheme,
        cardStyle:      "minimal" as CardStyleTheme,
      },
      settings.theme
    );
    applyTheme(theme);
    document.body.setAttribute("data-typo", theme.typography);
    document.body.setAttribute("data-accent", theme.accent);
  }, [settings.theme]);

  useEffect(() => {
    const el = document.getElementById("mc");
    if (!el) return;
    const mv = (e: MouseEvent) => { el.style.left = e.clientX + "px"; el.style.top = e.clientY + "px"; };
    document.addEventListener("mousemove", mv);
    return () => document.removeEventListener("mousemove", mv);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault(); setCmdOpen(o => !o); setCmdQuery(""); setCmdSelected(0);
      }
      if (e.key === "Escape") setCmdOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (settings.digestEnabled) {
      requestNotificationPermission().then(perm => {
        if (perm === "granted") scheduleDailyDigest(projects, settings.name);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.digestEnabled]);

  // ── Auto-updater listeners ─────────────────────────────────
  useEffect(() => {
    const el = window.electron;
    if (!el?.updater) return;
    const cleanups = [
      el.updater.on("update-available",       (d) => { const info = d as { version: string }; setUpdateInfo({ version: info.version, state: "available" }); }),
      el.updater.on("update-download-progress",(d) => { const info = d as { percent: number }; setUpdateInfo(u => u ? { ...u, state: "downloading", percent: info.percent } : null); }),
      el.updater.on("update-downloaded",       (d) => { const info = d as { version: string }; setUpdateInfo(u => u ? { ...u, state: "ready" } : { version: info.version, state: "ready" }); }),
      el.updater.on("update-error",            (d) => { const msg = d as string; setUpdateInfo(u => u ? { ...u, state: "error", error: msg } : null); }),
    ];
    return () => cleanups.forEach(c => c?.());
  }, []);

  // ── safeStorage — load encrypted GitHub token on mount ────
  useEffect(() => {
    const load = async () => {
      const el = window.electron;
      if (!el?.secrets) return;
      const available = await el.secrets.isAvailable();
      if (!available) return;
      // If we have an encrypted token in settings, decrypt it
      const encrypted = settings.gitHubToken;
      if (encrypted?.startsWith("enc:")) {
        const { plaintext, error } = await el.secrets.decrypt(encrypted.slice(4));
        if (!error && plaintext) patchSettings({ gitHubToken: encrypted }); // keep encrypted in settings
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveGitHubToken = async (token: string) => {
    const el = window.electron;
    if (el?.secrets) {
      const available = await el.secrets.isAvailable();
      if (available) {
        const { ciphertext, error } = await el.secrets.encrypt(token);
        if (!error) { patchSettings({ gitHubToken: "enc:" + ciphertext }); return; }
      }
    }
    patchSettings({ gitHubToken: token }); // fallback: plain localStorage
  };

  const getGitHubToken = async (): Promise<string> => {
    const raw = settings.gitHubToken;
    if (!raw?.startsWith("enc:")) return raw ?? "";
    const el = window.electron;
    if (!el?.secrets) return "";
    const { plaintext } = await el.secrets.decrypt(raw.slice(4));
    return plaintext ?? "";
  };

  // ── Task drag-to-reorder ───────────────────────────────────
  const onTaskDragStart = (taskId: string) => setDragTaskId(taskId);
  const onTaskDragOver  = (e: React.DragEvent, taskId: string) => { e.preventDefault(); setDragOverTaskId(taskId); };
  const onTaskDrop      = (projectId: string, dropTaskId: string) => {
    if (!dragTaskId || dragTaskId === dropTaskId) { setDragTaskId(null); setDragOverTaskId(null); return; }
    const p = projects.find(x => x.id === projectId); if (!p) return;
    const tasks = [...p.tasks];
    const fromIdx = tasks.findIndex(t => t.id === dragTaskId);
    const toIdx   = tasks.findIndex(t => t.id === dropTaskId);
    if (fromIdx === -1 || toIdx === -1) return;
    tasks.splice(toIdx, 0, tasks.splice(fromIdx, 1)[0]);
    updateProject(projectId, { tasks });
    setDragTaskId(null); setDragOverTaskId(null);
  };

  const showReviewBanner = settings.onboarded && !reviewDismissed &&
    shouldPromptReview(settings.lastReviewPrompt) && projects.length > 0;

  const sorted = useMemo(() => sortedByScore(projects, projects), [projects]);
  const sel     = projects.find(p => p.id === selectedId) ?? sorted[0];
  const focusProj = projects.find(p => p.id === focusProjectId) ?? null;

  // Persist
  const saveProjects  = (next: Project[]) => { setProjects(next); persist(SK.projects, next); };
  const saveSettings  = (next: Settings) => { setSettings(next); persist(SK.settings, next); applyTheme(next.theme); };
  const saveColumns   = (next: KanbanColumn[]) => { setColumns(next); persist(SK.kanban, next); };
  const saveReviews   = (next: WeeklyReview[]) => { setReviews(next); persist(SK.reviews, next); };
  const patchSettings = (patch: Partial<Settings>) => saveSettings({ ...settings, ...patch });
  const patchTheme    = (patch: Partial<Settings["theme"]>) => patchSettings({ theme: { ...settings.theme, ...patch } });

  const completeOnboarding = () => {
    const name = nameInput.trim() || "there";
    patchSettings({ name, onboarded: true });
    toast("Welcome, " + name + ".");
  };

  const touchProject = (id: string) => {
    saveProjects(projects.map(p => {
      if (p.id !== id) return p;
      const sc = scoreProject(p, projects);
      return { ...p, lastTouched: new Date().toISOString(), scoreHistory: appendScoreHistory(p, sc.score) };
    }));
  };

  const openDetail = (id: string) => { setSelectedId(id); setView("detail"); setEditingProject(false); touchProject(id); };
  const openEdit   = (p: Project) => { setEditDraft({ name: p.name, desc: p.desc, track: p.track, status: p.status, daysLeft: p.daysLeft, impact: p.impact, effort: p.effort, energy: p.energy, confidence: p.confidence, tags: [...p.tags] }); setEditingProject(true); };

  // Projects
  const addProject = () => {
    if (!draft.name.trim()) { toast("Name is required."); return; }
    const p: Project = {
      ...draft, id: uid(), name: draft.name.trim(),
      desc: draft.desc.trim() || "No description.",
      colorIdx: colorCounter,
      kanbanColumnId: columns[0]?.id ?? "",
      lastTouched: new Date().toISOString(),
      focusSessions: [], scoreHistory: [], blockedBy: [],
      createdAt: new Date().toISOString(),
    };
    setColorCounter(c => c + 1);
    saveProjects([p, ...projects]);
    setSelectedId(p.id); setDrawerOpen(false);
    setDraft(blankProject(colorCounter + 1));
    setSelectedTemplate(null);
    setView("detail"); toast("Project added.");
  };

  const removeProject = (id: string) => {
    const snapshot = projects;
    const next = projects.filter(p => p.id !== id)
      .map(p => ({ ...p, blockedBy: (p.blockedBy ?? []).filter(b => b !== id) }));
    saveProjects(next); setSelectedId(next[0]?.id ?? ""); setView("dashboard");
    toast("Project removed — undo?");
    undoRef.current = () => { saveProjects(snapshot); setSelectedId(id); setView("detail"); };
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => { undoRef.current = null; }, 5000);
  };

  const updateProject = (id: string, patch: Partial<Project>) =>
    saveProjects(projects.map(p => p.id === id ? { ...p, ...patch } : p));

  const addTask = (pid: string) => {
    setAddingTaskPid(pid);
    setNewTaskText("");
  };

  const commitAddTask = (pid: string) => {
    if (!newTaskText.trim()) { setAddingTaskPid(null); return; }
    const p = projects.find(x => x.id === pid); if (!p) return;
    updateProject(pid, {
      tasks: [...p.tasks, { id: uid(), text: newTaskText.trim(), done: false, priority: "med" as TaskPriority, due: "", note: "", subtasks: [], expanded: false }],
      lastTouched: new Date().toISOString(),
    });
    setNewTaskText(""); setAddingTaskPid(null);
  };

  const deleteTask = (pid: string, tid: string) => {
    const p = projects.find(x => x.id === pid); if (!p) return;
    // Undo-able delete
    const snapshot = p.tasks;
    updateProject(pid, { tasks: p.tasks.filter(t => t.id !== tid) });
    toast("Task removed — undo?");
    // We store the undo action in a ref so it can be triggered
    undoRef.current = () => updateProject(pid, { tasks: snapshot });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => { undoRef.current = null; }, 5000);
  };

  const commitEditTask = (pid: string, tid: string) => {
    if (!editingTaskText.trim()) { setEditingTaskId(null); return; }
    const p = projects.find(x => x.id === pid); if (!p) return;
    updateProject(pid, { tasks: p.tasks.map(t => t.id === tid ? { ...t, text: editingTaskText.trim() } : t) });
    setEditingTaskId(null);
  };

  const updateTaskPriority = (pid: string, tid: string, priority: TaskPriority) => {
    const p = projects.find(x => x.id === pid); if (!p) return;
    updateProject(pid, { tasks: p.tasks.map(t => t.id === tid ? { ...t, priority } : t) });
  };

  const toggleTask = (pid: string, tid: string) =>
    saveProjects(projects.map(p => p.id !== pid ? p : {
      ...p, lastTouched: new Date().toISOString(),
      tasks: p.tasks.map(t => t.id !== tid ? t : { ...t, done: !t.done }),
    }));

  const toggleSubtask = (pid: string, tid: string, sid: string) =>
    saveProjects(projects.map(p => p.id !== pid ? p : {
      ...p, tasks: p.tasks.map(t => t.id !== tid ? t : {
        ...t, subtasks: t.subtasks.map(s => s.id !== sid ? s : { ...s, done: !s.done }),
      }),
    }));

  const toggleExpanded = (pid: string, tid: string) =>
    saveProjects(projects.map(p => p.id !== pid ? p : {
      ...p, tasks: p.tasks.map(t => t.id !== tid ? t : { ...t, expanded: !t.expanded }),
    }));

  // Kanban
  const addColumn = () => { setShowAddColumn(true); setAddingColumnName(""); };
  const commitAddColumn = () => {
    if (!addingColumnName.trim()) { setShowAddColumn(false); return; }
    const col: KanbanColumn = { id: uid(), name: addingColumnName.trim(), color: COL_COLORS[columns.length % COL_COLORS.length], wipLimit: null, order: columns.length };
    saveColumns([...columns, col]); setShowAddColumn(false); setAddingColumnName(""); toast("Column added.");
  };
  const updateColumn = (id: string, patch: Partial<KanbanColumn>) => saveColumns(columns.map(c => c.id === id ? { ...c, ...patch } : c));
  const removeColumn = (id: string) => {
    saveColumns(columns.filter(c => c.id !== id));
    saveProjects(projects.map(p => p.kanbanColumnId === id ? { ...p, kanbanColumnId: columns[0]?.id ?? "" } : p));
    setEditingColId(null); toast("Column removed.");
  };
  const onDragStart = (cardId: string) => setDragCardId(cardId);
  const onDragOver  = (e: React.DragEvent, colId: string) => { e.preventDefault(); setDragOverColId(colId); };
  const onDrop      = (colId: string) => {
    if (!dragCardId) return;
    updateProject(dragCardId, { kanbanColumnId: colId });
    setDragCardId(null); setDragOverColId(null); toast("Card moved.");
  };

  // Dependencies
  const addBlocker = (projectId: string) => setShowBlockerSelect(projectId);
  const commitAddBlocker = (projectId: string, blockerId: string) => {
    const current = projects.find(p => p.id === projectId);
    if (!blockerId || (current?.blockedBy ?? []).includes(blockerId)) { setShowBlockerSelect(null); return; }
    const blocker = projects.find(p => p.id === blockerId);
    updateProject(projectId, { blockedBy: [...(current?.blockedBy ?? []), blockerId] });
    toast('"' + current?.name + '" now blocked by "' + blocker?.name + '"');
    setShowBlockerSelect(null);
  };
  const removeBlocker = (projectId: string, blockerId: string) => {
    const current = projects.find(p => p.id === projectId);
    updateProject(projectId, { blockedBy: (current?.blockedBy ?? []).filter(id => id !== blockerId) });
    toast("Dependency removed.");
  };

  // Focus sessions
  const handleSessionComplete = (session: FocusSession) => {
    saveProjects(projects.map(p => p.id !== session.projectId ? p : {
      ...p, focusSessions: [...(p.focusSessions ?? []), session], lastTouched: new Date().toISOString(),
    }));
    toast("Session logged: " + fmtDuration(session.duration));
  };

  // Weekly review
  const completeReview = (review: WeeklyReview) => {
    saveReviews([...reviews, review]);
    patchSettings({ lastReviewPrompt: new Date().toISOString() });
    if (review.shipped.length) saveProjects(projects.map(p => review.shipped.includes(p.id) ? { ...p, status: "shipped" } : p));
    setShowReview(false); setReviewDismissed(true); toast("Review saved. Great week!");
  };

  // Ollama
  const checkOllamaStatus = async () => {
    const s = await checkOllama(settings.ollamaUrl);
    setOllamaStatus({ ...s, checked: true });
    return s;
  };

  const sendAi = async (text: string) => {
    if (!text.trim() || aiLoading) return;
    setAiMessages(m => [...m, { role: "user", text }]);
    setAiLoading(true);
    try {
      const reply = await askOllama(settings.ollamaUrl, settings.ollamaModel, text, projects);
      setAiMessages(m => [...m, { role: "bot", text: reply }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDown = msg.includes("fetch") || msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("Failed to fetch");
      setAiMessages(m => [...m, { role: "bot", text: isDown ? OLLAMA_NOT_RUNNING_MSG : "Error: " + msg }]);
      setOllamaStatus(s => ({ ...s, running: false }));
    } finally {
      setAiLoading(false);
      setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = 99999; }, 50);
    }
  };

  // GitHub
  const importIssueAsTask = (projectId: string, title: string, note: string) => {
    const p = projects.find(x => x.id === projectId); if (!p) return;
    updateProject(projectId, {
      tasks: [...p.tasks, { id: uid(), text: title, done: false, priority: "med" as const, due: "", note, subtasks: [], expanded: false }],
      lastTouched: new Date().toISOString(),
    });
    toast("Issue imported as task.");
  };

  // Templates
  const applyTemplate = (templateId: string) => {
    const t = PROJECT_TEMPLATES.find(x => x.id === templateId); if (!t) return;
    setDraft(d => ({ ...d, name: t.name, desc: t.desc, track: t.track, impact: t.impact, effort: t.effort, energy: t.energy, confidence: t.confidence, daysLeft: t.daysLeft, tags: t.tags }));
    setSelectedTemplate(templateId);
  };

  // Import
  const importJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Project[];
      if (!Array.isArray(data)) throw new Error();
      saveProjects(data.map(migrateProject)); setSelectedId(data[0]?.id ?? ""); toast("Imported.");
    } catch { toast("Invalid JSON."); }
    finally { e.target.value = ""; }
  };

  const avg     = Math.round(sorted.reduce((a, p) => a + scoreProject(p, projects).score, 0) / Math.max(sorted.length, 1));
  const overdue = sorted.filter(p => (p.deadlineDate ? Math.round((new Date(p.deadlineDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000) : p.daysLeft) < 0 && p.status !== "shipped").length;
  const shipped_ = sorted.filter(p => p.status === "shipped").length;
  const top     = sorted[0];
  const hour    = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const priColor = (pri: string, color: string) => ({ high: color, med: "var(--text2)", low: "var(--text3)" }[pri] ?? "var(--text3)");

  const renderTasks = (project: Project, color: string) => (
    <>
      {project.tasks.length === 0 && addingTaskPid !== project.id && (
        <div className="task-empty">No tasks yet — add one above.</div>
      )}
      {project.tasks.map(task => (
        <div key={task.id}
          className={"task-item" + (task.expanded ? " expanded" : "") + (dragOverTaskId === task.id ? " drag-over" : "")}
          draggable
          onDragStart={() => onTaskDragStart(task.id)}
          onDragOver={e => onTaskDragOver(e, task.id)}
          onDrop={() => onTaskDrop(project.id, task.id)}
          onDragEnd={() => { setDragTaskId(null); setDragOverTaskId(null); }}>
          {/* Drag handle */}
          <div className="task-drag-handle" title="Drag to reorder">
            <svg viewBox="0 0 16 16" fill="none" width="10" height="10">
              <circle cx="5" cy="4" r="1.2" fill="currentColor"/>
              <circle cx="5" cy="8" r="1.2" fill="currentColor"/>
              <circle cx="5" cy="12" r="1.2" fill="currentColor"/>
              <circle cx="10" cy="4" r="1.2" fill="currentColor"/>
              <circle cx="10" cy="8" r="1.2" fill="currentColor"/>
              <circle cx="10" cy="12" r="1.2" fill="currentColor"/>
            </svg>
          </div>
          <div className={"task-cb" + (task.done ? " done" : "")}
            style={task.done ? { background: color, borderColor: color } : {}}
            onClick={e => { e.stopPropagation(); toggleTask(project.id, task.id); }}>
            {task.done && I.check(9)}
          </div>
          <div className="task-body" onClick={() => { if (editingTaskId !== task.id) toggleExpanded(project.id, task.id); }}>
            {editingTaskId === task.id ? (
              <input className="task-inline-edit" autoFocus value={editingTaskText}
                onChange={e => setEditingTaskText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") commitEditTask(project.id, task.id); if (e.key === "Escape") setEditingTaskId(null); }}
                onBlur={() => commitEditTask(project.id, task.id)}
                onClick={e => e.stopPropagation()} />
            ) : (
              <div className={"task-text" + (task.done ? " done" : "")}
                onDoubleClick={e => { e.stopPropagation(); setEditingTaskId(task.id); setEditingTaskText(task.text); }}>
                {task.text}
              </div>
            )}
            <div className="task-row">
              {(["high","med","low"] as TaskPriority[]).map(pri => (
                <span key={pri} className="task-pri"
                  style={{ color: task.priority === pri ? priColor(pri, color) : "var(--text4)", fontWeight: task.priority === pri ? 600 : 400, cursor: "pointer", marginRight: 4 }}
                  onClick={e => { e.stopPropagation(); updateTaskPriority(project.id, task.id, pri); }}>
                  {pri}
                </span>
              ))}
              {task.due && <span className="task-due">{task.due}</span>}
              <button className="task-delete-btn" onClick={e => { e.stopPropagation(); deleteTask(project.id, task.id); }} title="Delete task">×</button>
            </div>
            <div className="task-expand">
              {task.subtasks.map(s => (
                <div key={s.id} className="subtask" onClick={e => { e.stopPropagation(); toggleSubtask(project.id, task.id, s.id); }}>
                  <div className={"sub-cb" + (s.done ? " done" : "")} style={s.done ? { background: color, borderColor: color } : {}}>
                    {s.done && <I.checkSm />}
                  </div>
                  <span className={"sub-text" + (s.done ? " done" : "")}>{s.text}</span>
                </div>
              ))}
              {task.note && <div className="task-note">{task.note}</div>}
            </div>
          </div>
        </div>
      ))}
      {addingTaskPid === project.id && (
        <div className="task-add-inline">
          <input className="task-inline-edit" autoFocus placeholder="What needs to happen?"
            value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitAddTask(project.id); if (e.key === "Escape") setAddingTaskPid(null); }}
            onBlur={() => commitAddTask(project.id)} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text4)", paddingLeft: 8 }}>Enter to save · Esc to cancel</span>
        </div>
      )}
    </>
  );

  // Focus mode overlay
  if (focusProj) {
    const color = projectColor(focusProj);
    const sc = scoreProject(focusProj, projects);
    return (
      <>
        <div id="mc"><div className="mch" /><div className="mcv" /></div>
        <div className={"toast" + (toastShow ? " show" : "")}>
        <span>{toastMsg}</span>
        {undoRef.current && (
          <button className="toast-undo" onClick={() => { undoRef.current?.(); undoRef.current = null; toast("Undone."); }}>
            Undo
          </button>
        )}
      </div>
        <div className="focus-mode">
          <div className="focus-topbar">
            <div className="focus-topbar-left">
              <span className="brand-dot" style={{ background: color }} />
              <span className="focus-proj-name">{focusProj.name}</span>
              <span className="pill" style={{ color, borderColor: "rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)" }}>
                {sc.score}% - {sc.stage}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="t-btn" onClick={() => {
                const md = projectToMarkdown(focusProj, sc);
                const blob = new Blob([md], { type: "text/markdown" });
                const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: focusProj.name + ".md" });
                a.click(); toast("Exported as Markdown.");
              }}>Export .md</button>
              <button className="t-btn primary" onClick={() => setFocusProjectId(null)}>Exit focus</button>
            </div>
          </div>
          <div className="focus-body">
            <div className="focus-tasks-panel">
              <div className="focus-tasks-header">
                <div>
                  <div className="focus-tasks-title" style={{ color }}>{focusProj.name}</div>
                  <div className="focus-tasks-sub">{focusProj.desc}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <span className="pill" style={{ color, borderColor: color + "44", background: color + "10" }}>{sc.score}% — {sc.stage}</span>
                    <span className={"pill " + (livedays(focusProj) < 0 ? "pill-red" : "pill-dim")}>{fmtDays(livedays(focusProj))}</span>
                    <span className="pill pill-dim">{focusProj.track || "—"}</span>
                    {sc.decayPenalty > 0 && <span className="pill" style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.07)" }}>↓ stale -{sc.decayPenalty}pts</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div className="focus-mini-score">
                    <div className="focus-mini-score-val" style={{ color }}>{sc.score}</div>
                    <div className="focus-mini-score-lbl">score</div>
                  </div>
                  <div className="focus-mini-score">
                    <div className="focus-mini-score-val">{taskCompletion(focusProj)}%</div>
                    <div className="focus-mini-score-lbl">done</div>
                  </div>
                </div>
              </div>

              <div className="focus-tasks-list">
                <div className="tasks-head">
                  <div className="tasks-title">Tasks <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", marginLeft: 6 }}>
                    {focusProj.tasks.filter(t => t.done).length}/{focusProj.tasks.length}
                  </span></div>
                  <button className="add-task-btn" style={{ color, borderColor: color + "33" }}
                    onClick={() => addTask(focusProj.id)}>
                    <I.plus />Add task
                  </button>
                </div>
                {renderTasks(focusProj, color)}
              </div>
            </div>

            <div className="focus-pomo-panel">
              <div className="focus-pomo-inner">
                <Pomodoro project={focusProj} color={color} onSessionComplete={handleSessionComplete} />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div id="mc"><div className="mch" /><div className="mcv" /></div>
      <div className={"toast" + (toastShow ? " show" : "")}>
        <span>{toastMsg}</span>
        {undoRef.current && (
          <button className="toast-undo" onClick={() => { undoRef.current?.(); undoRef.current = null; toast("Undone."); }}>
            Undo
          </button>
        )}
      </div>

      {cmdOpen && (
        <CommandPalette
          projects={projects} query={cmdQuery} selected={cmdSelected}
          onQueryChange={setCmdQuery} onSelectedChange={setCmdSelected}
          onAction={(id, v) => { if (id === "new") { setDrawerOpen(true); setView("dashboard"); } else if (v) setView(v); setCmdOpen(false); }}
          onProjectOpen={id => { openDetail(id); setCmdOpen(false); }}
          onTaskOpen={id => { openDetail(id); setCmdOpen(false); }}
          onClose={() => setCmdOpen(false)}
        />
      )}

      {showReview && (
        <WeeklyReviewModal
          projects={projects}
          ollamaUrl={settings.ollamaUrl}
          ollamaModel={settings.ollamaModel}
          onComplete={completeReview}
          onDismiss={() => { setShowReview(false); setReviewDismissed(true); patchSettings({ lastReviewPrompt: new Date().toISOString() }); }}
        />
      )}

      {!settings.onboarded && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-title">Welcome to Meridian.</div>
            <div className="modal-sub">A priority-scored command centre for builders. Local-first — everything lives on your machine.</div>
            <span className="f-lbl">What should I call you?</span>
            <input className="f-input" placeholder="Your name" value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && completeOnboarding()} autoFocus />
            <div className="modal-footer">
              <button className="btn-save" onClick={completeOnboarding}>
                {nameInput.trim() ? "Let's go, " + nameInput.trim() + " →" : "Get started →"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="app">
        <div className="topbar">
          <div className="brand">
            <span className="brand-dot" />
            <span className={"brand-script" + (brandDone ? " typed" : "")}>{brandText}</span>
          </div>
          <div className="topbar-right">
            <button className="t-btn" onClick={() => setCmdOpen(true)} title="Quick search (Ctrl+K)">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>Ctrl+K</span>
              </span>
            </button>
            <button className="t-btn" onClick={() => fileRef.current?.click()}>Import</button>
            <button className="t-btn" onClick={() => { exportJson(projects); toast("Exported."); }}>Export</button>
            <button className="t-btn primary" onClick={() => { setDrawerOpen(o => !o); setView("dashboard"); }}>
              {drawerOpen ? "Cancel" : "+ New project"}
            </button>
            <div className="avatar">{(settings.name || "?").slice(0, 2).toUpperCase()}</div>
            <input ref={fileRef} type="file" accept="application/json" onChange={importJson} style={{ display: "none" }} />
          </div>
        </div>

        <div className="layout">
          <div className="sidebar">
            <div className="sb-nav">
              <span className="sb-lbl">Navigate</span>
              {([
                ["dashboard",    "Dashboard",      I.grid],
                ["kanban",       "Kanban",         I.kanban],
                ["timeline",     "Timeline",       I.timeline],
                ["tags",         "Tags",           I.tag],
                ["dependencies", "Dependencies",   I.deps],
                ["review",       "Weekly Review",  I.review],
                ["archive",      "Archive",        I.archive],
                ["ai",           "AI Advisor",     I.ai],
                ["settings",     "Settings",       I.settings],
              ] as [View, string, () => React.ReactElement][]).map(([v, label, Icon]) => (
                <div key={v} className={"sb-item" + (view === v ? " active" : "")} onClick={() => setView(v)}>
                  <Icon />{label}
                  {v === "review" && showReviewBanner && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginLeft: "auto", flexShrink: 0 }} />
                  )}
                  {v === "archive" && sorted.filter(p => p.status === "shipped").length > 0 && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text4)", marginLeft: "auto" }}>
                      {sorted.filter(p => p.status === "shipped").length}
                    </span>
                  )}
                  {v === "settings" && updateInfo?.state === "available" && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22d3ee", marginLeft: "auto", flexShrink: 0 }} />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 18px 6px" }}>
              <span className="sb-lbl" style={{ margin: 0 }}>Projects</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--accent)" }}>{sorted.length}</span>
            </div>
            <div className="sb-proj-wrap">
              {sorted.map(p => {
                const sc = scoreProject(p, projects); const color = projectColor(p);
                return (
                  <div key={p.id} className={"sb-proj" + (p.id === selectedId && view === "detail" ? " active" : "")}
                    onClick={() => openDetail(p.id)}>
                    <div className="sb-dot" style={{ background: color }} />
                    <span className="sb-proj-name">{p.name}</span>
                    {sc.decayPenalty > 0 && <span style={{ fontSize: 8, color: "#ef4444" }}>↓</span>}
                    {sc.blockPenalty  > 0 && <span style={{ fontSize: 8, color: "#f59e0b" }}>⊘</span>}
                    <span className="sb-proj-score" style={p.id === selectedId && view === "detail" ? { color } : {}}>{sc.score}%</span>
                  </div>
                );
              })}
            </div>
            <button className="sb-add" onClick={() => { setDrawerOpen(true); setView("dashboard"); }}>
              <I.plus />New project
            </button>
            {allTags(projects).length > 0 && (
              <div style={{ padding: "0 10px 12px", borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
                <div className="sb-lbl" style={{ margin: "0 0 7px" }}>Tags</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {allTags(projects).slice(0, 12).map(({ tag }) => (
                    <div key={tag} onClick={() => { setActiveTag(tag); setView("tags"); }}
                      style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".07em", padding: "2px 8px", border: "1px solid var(--rule2)", borderRadius: 2, color: activeTag === tag ? "var(--accent)" : "var(--text4)", background: activeTag === tag ? "var(--accent-dim)" : "transparent", cursor: "pointer" }}>
                      #{tag}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="main">
              {/* UPDATE NOTIFICATION */}
              {updateInfo && (
                <div className={`update-banner update-banner-${updateInfo.state}`}>
                  {updateInfo.state === "available" && (<>
                    <span className="update-banner-dot" />
                    <span>Meridian <strong>{updateInfo.version}</strong> is available</span>
                    <button className="update-banner-btn" onClick={() => window.electron?.updater.download()}>Download</button>
                    <button className="update-banner-dismiss" onClick={() => setUpdateInfo(null)}>×</button>
                  </>)}
                  {updateInfo.state === "downloading" && (<>
                    <span className="update-banner-dot downloading" />
                    <span>Downloading update… {updateInfo.percent ?? 0}%</span>
                    <div className="update-banner-prog"><div style={{ width: (updateInfo.percent ?? 0) + "%" }} /></div>
                  </>)}
                  {updateInfo.state === "ready" && (<>
                    <span className="update-banner-dot ready" />
                    <span><strong>{updateInfo.version}</strong> ready to install</span>
                    <button className="update-banner-btn" onClick={() => window.electron?.updater.install()}>Restart &amp; install</button>
                    <button className="update-banner-dismiss" onClick={() => setUpdateInfo(null)}>×</button>
                  </>)}
                  {updateInfo.state === "error" && (<>
                    <span>Update failed: {updateInfo.error}</span>
                    <button className="update-banner-dismiss" onClick={() => setUpdateInfo(null)}>×</button>
                  </>)}
                </div>
              )}

            {showReviewBanner && !showReview && (
              <div className="review-prompt-banner" onClick={() => setShowReview(true)}>
                <span className="review-prompt-dot" />
                <span className="review-prompt-text"><strong>It's Monday.</strong> Time for your weekly review.</span>
                <span className="review-prompt-dismiss" onClick={e => { e.stopPropagation(); setReviewDismissed(true); }}>Dismiss</span>
              </div>
            )}

            {/* DRAWER */}
            <div className={"drawer" + (drawerOpen ? " open" : "")}>
              <div className="drawer-inner">
                <div className="drawer-title">New project</div>
                <div>
                  <span className="template-label">Start from a template</span>
                  <div className="template-strip">
                    <button className={"template-chip" + (!selectedTemplate ? " active" : "")}
                      onClick={() => { setSelectedTemplate(null); setDraft(blankProject(colorCounter)); }}>Blank</button>
                    {PROJECT_TEMPLATES.map(t => (
                      <button key={t.id} className={"template-chip" + (selectedTemplate === t.id ? " active" : "")}
                        onClick={() => applyTemplate(t.id)}>{t.name}</button>
                    ))}
                  </div>
                </div>
                <div className="comp-grid">
                  <label><span className="f-lbl">Name</span><input className="f-input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Project name" /></label>
                  <label><span className="f-lbl">Track</span><input className="f-input" value={draft.track} onChange={e => setDraft(d => ({ ...d, track: e.target.value }))} placeholder="Frontend, AI, Writing…" /></label>
                  <label className="span-2"><span className="f-lbl">Description</span><textarea className="f-input" value={draft.desc} onChange={e => setDraft(d => ({ ...d, desc: e.target.value }))} placeholder="What needs to happen?" /></label>
                  <label><span className="f-lbl">Status</span>
                    <select className="f-input" value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as ProjectStatus }))}>
                      <option value="concept">concept</option><option value="active">active</option>
                      <option value="paused">paused</option><option value="shipped">shipped</option>
                    </select>
                  </label>
                  <label><span className="f-lbl">Deadline</span>
                    <input className="f-input" type="date"
                      value={draft.deadlineDate ?? ""}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={e => setDraft(d => ({ ...d, deadlineDate: e.target.value, daysLeft: daysFromDeadline(e.target.value) }))} />
                  </label>
                  {(["impact", "effort", "energy", "confidence"] as const).map(k => (
                    <label key={k}>
                      <div className="range-head"><span>{k}</span><strong>{draft[k]}</strong></div>
                      <input type="range" min={1} max={10} value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: Number(e.target.value) }))} />
                    </label>
                  ))}
                  <label className="span-2">
                    <span className="f-lbl">Tags</span>
                    <TagInput tags={draft.tags} onChange={tags => setDraft(d => ({ ...d, tags }))} />
                  </label>
                </div>
                <div className="drawer-footer">
                  <button className="btn-cancel" onClick={() => { setDrawerOpen(false); setSelectedTemplate(null); }}>Cancel</button>
                  <button className="btn-save" onClick={addProject}>Save project →</button>
                </div>
              </div>
            </div>

            {/* DASHBOARD */}
            <div className={"view" + (view === "dashboard" ? " active" : "")}>
              <div className="dash-hero">
                <div className="dash-greeting">{greeting}, <em>{settings.name || "there"}.</em></div>
                <div className="dash-sub">
                  {sorted.length === 0
                    ? "No projects yet — hit \"+ New project\" to get started."
                    : (overdue > 0 ? overdue + " overdue — " : "") + sorted.filter(p => livedays(p) >= 0 && livedays(p) <= 7 && p.status !== "shipped").length + " urgent this week."
                  }
                </div>
              </div>
              <div className="metrics-row">
                <div className="metric-card"><div className="m-lbl">Total projects</div><div className="m-val accent">{String(sorted.length).padStart(2, "0")}</div><div className="m-note">All tracks</div></div>
                <div className="metric-card"><div className="m-lbl">Avg priority</div><div className="m-val">{sorted.length ? avg + "%" : "—"}</div><div className="m-note">Score weighted</div></div>
                <div className="metric-card"><div className="m-lbl">Overdue</div><div className="m-val" style={{ color: "#ef4444" }}>{String(overdue).padStart(2, "0")}</div><div className="m-note">Needs attention</div></div>
                <div className="metric-card"><div className="m-lbl">Shipped</div><div className="m-val accent2">{String(shipped_).padStart(2, "0")}</div><div className="m-note">Completed</div></div>
              </div>
              {top && (
                <div className="focus-bar" onClick={() => openDetail(top.id)}>
                  <div className="focus-left"><span className="focus-pulse" />
                    <div><div className="focus-lbl">Top priority right now</div><div className="focus-name">{top.name}</div></div>
                  </div>
                  <div className="focus-right">
                    <span className="pill" style={{ color: projectColor(top), borderColor: "rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)" }}>{scoreProject(top, projects).stage}</span>
                    <div className="focus-score" style={{ color: projectColor(top) }}>{scoreProject(top, projects).score}<sup>%</sup></div>
                  </div>
                </div>
              )}
              <div className="cards-section">
                <div className="section-head">
                  <div className="section-title">All projects</div>
                  <span className="section-count">{sorted.length} {sorted.length === 1 ? "project" : "projects"}</span>
                </div>
                {sorted.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 20px", gap: 16, textAlign: "center" }}>
                    <div style={{ width: 56, height: 56, border: "1.5px dashed var(--rule3)", borderRadius: "50%", display: "grid", placeItems: "center", color: "var(--text4)" }}><I.plus /></div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", letterSpacing: "var(--display-tracking)", color: "var(--text3)" }}>No projects yet</div>
                    <div style={{ fontSize: 12, color: "var(--text4)", maxWidth: 300, lineHeight: 1.7 }}>Add your first project above, or import an existing Meridian export.</div>
                    <button className="btn-save" style={{ marginTop: 8 }} onClick={() => setDrawerOpen(true)}>+ Add first project</button>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {sorted.map(p => {
                      const sc = scoreProject(p, projects); const color = projectColor(p); const comp = taskCompletion(p);
                      return (
                        <div key={p.id} className={"proj-card" + (p.id === selectedId && view === "detail" ? " active" : "")}
                          style={{ "--pc": color } as React.CSSProperties} onClick={() => openDetail(p.id)}>
                          <div className="pc-top">
                            <div className="pc-name">{p.name}</div>
                            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                              {sc.blockPenalty > 0 && <span className="block-badge">blocked</span>}
                              <div className="pc-score" style={{ color }}>{sc.score}%</div>
                            </div>
                          </div>
                          <div className="pc-desc">{p.desc}</div>
                          <div className="pc-pills">
                            <span className="pill" style={{ color, borderColor: "rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)" }}>{sc.stage}</span>
                            <span className="pill pill-dim">{p.track || "—"}</span>
                            <span className={"pill " + (livedays(p) < 0 ? "pill-red" : "pill-dim")}>{fmtDays(livedays(p))}</span>
                          </div>
                          {sc.decayPenalty > 0 && (
                            <div className="decay-bar-wrap">
                              <span className={"decay-label" + (sc.decayPenalty > 15 ? " hot" : "")}>stale</span>
                              <div className="decay-track"><div className="decay-fill" style={{ width: Math.min(sc.decayPenalty / 30 * 100, 100) + "%" }} /></div>
                              <span className="decay-penalty">-{sc.decayPenalty}</span>
                            </div>
                          )}
                          <Sparkline history={p.scoreHistory ?? []} color={color} />
                          {/* Ship button — appears on hover */}
                          <button className="card-ship-btn" title="Mark as done"
                            onClick={e => {
                              e.stopPropagation();
                              updateProject(p.id, { status: "shipped", lastTouched: new Date().toISOString() });
                              toast(p.name + " shipped! View in Archive.");
                            }}
                            style={{ borderColor: color + "66", color }}>
                            {I.check(10)} Done
                          </button>
                          <div className="pc-progress"><div className="pc-progress-fill" style={{ width: comp + "%", background: color }} /></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* KANBAN */}
            <div className={"view" + (view === "kanban" ? " active" : "")}>
              <div className="kanban-header">
                <div className="kanban-title">Kanban Board</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {showAddColumn && (
                    <input className="f-input" style={{ width: 160, padding: "5px 10px" }}
                      autoFocus placeholder="Column name…"
                      value={addingColumnName}
                      onChange={e => setAddingColumnName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") commitAddColumn(); if (e.key === "Escape") setShowAddColumn(false); }}
                      onBlur={commitAddColumn} />
                  )}
                  <button className="t-btn" onClick={addColumn}>+ Add column</button>
                </div>
              </div>
              <div className="kanban-board">
                {[...columns].sort((a, b) => a.order - b.order).map(col => {
                  const cards = projects.filter(p => p.kanbanColumnId === col.id);
                  const exceeded = col.wipLimit !== null && cards.length > col.wipLimit;
                  return (
                    <div key={col.id} className="kanban-col" onDragOver={e => onDragOver(e, col.id)} onDrop={() => onDrop(col.id)}>
                      <div className="kanban-col-header" style={{ borderTop: "2px solid " + col.color }}>
                        <div className="kanban-col-dot" style={{ background: col.color }} />
                        <span className="kanban-col-name">{col.name}</span>
                        <span className={"kanban-col-wip" + (exceeded ? " exceeded" : "")}>{col.wipLimit ? cards.length + "/" + col.wipLimit : cards.length}</span>
                        <button className="kanban-col-edit" onClick={() => setEditingColId(editingColId === col.id ? null : col.id)}>Edit</button>
                      </div>
                      {editingColId === col.id && (
                        <div className="col-editor">
                          <label><span className="f-lbl">Column name</span>
                            <input className="f-input" value={col.name} onChange={e => updateColumn(col.id, { name: e.target.value })} style={{ marginBottom: 10 }} />
                          </label>
                          <span className="f-lbl">Colour</span>
                          <div className="col-color-row">
                            {COL_COLORS.map(c => <div key={c} className={"col-color-sw" + (col.color === c ? " on" : "")} style={{ background: c }} onClick={() => updateColumn(col.id, { color: c })} />)}
                          </div>
                          <label><span className="f-lbl">WIP limit (0 = none)</span>
                            <input className="f-input" type="number" min={0} value={col.wipLimit ?? 0} onChange={e => updateColumn(col.id, { wipLimit: Number(e.target.value) || null })} />
                          </label>
                          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button className="btn-cancel" style={{ flex: 1 }} onClick={() => setEditingColId(null)}>Done</button>
                            <button className="btn-cancel" style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }} onClick={() => removeColumn(col.id)}>Delete</button>
                          </div>
                        </div>
                      )}
                      <div className="kanban-cards">
                        {cards.length === 0 ? (
                          <div className={"kanban-drop-zone" + (dragOverColId === col.id ? " over" : "")}>Drop here</div>
                        ) : cards.map(p => {
                          const sc = scoreProject(p, projects); const color = projectColor(p); const comp = taskCompletion(p);
                          return (
                            <div key={p.id} className={"kanban-card" + (dragCardId === p.id ? " dragging" : "")}
                              style={{ "--pc": color } as React.CSSProperties}
                              draggable onDragStart={() => onDragStart(p.id)}
                              onDragEnd={() => { setDragCardId(null); setDragOverColId(null); }}
                              onClick={() => openDetail(p.id)}>
                              <div className="kanban-card-name">{p.name}</div>
                              <div className="kanban-card-meta">
                                <span className="pill pill-dim">{p.track || "—"}</span>
                                <span className={"pill " + (livedays(p) < 0 ? "pill-red" : "pill-dim")}>{fmtDays(livedays(p))}</span>
                                {sc.decayPenalty > 0 && <span style={{ fontSize: 8, color: "#ef4444", fontFamily: "var(--font-mono)" }}>↓{sc.decayPenalty}</span>}
                                <span className="kanban-card-score" style={{ color }}>{sc.score}%</span>
                              </div>
                              <div className="kanban-card-prog"><div className="kanban-card-prog-fill" style={{ width: comp + "%", background: color }} /></div>
                            </div>
                          );
                        })}
                        {cards.length > 0 && <div className={"kanban-drop-zone" + (dragOverColId === col.id ? " over" : "")} style={{ marginTop: 4 }}>Drop here</div>}
                      </div>
                    </div>
                  );
                })}
                <button className="add-col-btn" onClick={addColumn}>
                  <I.plus /><span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase" }}>Add column</span>
                </button>
              </div>
            </div>

            {/* DEPENDENCIES */}
            <div className={"view" + (view === "dependencies" ? " active" : "")}>
              <div className="dep-view">
                <div className="dep-header">
                  <div>
                    <div className="dep-title">Dependency Graph</div>
                    <div className="dep-sub">Arrows from blocker to blocked. Score penalties applied automatically.</div>
                  </div>
                </div>
                <div className="dep-body">
                  <DepGraph projects={projects} onSelect={id => openDetail(id)} />
                  <div className="dep-sidebar">
                    <div className="sb-lbl" style={{ padding: "0 0 10px" }}>Project dependencies</div>
                    {sorted.map(p => {
                      const color = projectColor(p);
                      const blockers = (p.blockedBy ?? []).map(id => projects.find(x => x.id === id)).filter(Boolean) as Project[];
                      return (
                        <div key={p.id} className="dep-proj-row">
                          <div className="dep-proj-header">
                            <div className="dep-proj-dot" style={{ background: color }} />
                            <span className="dep-proj-name">{p.name}</span>
                            {showBlockerSelect === p.id ? (
                            <select className="f-input" style={{ fontSize: 10, padding: "2px 6px", height: "auto" }}
                              autoFocus defaultValue=""
                              onChange={e => commitAddBlocker(p.id, e.target.value)}
                              onBlur={() => setShowBlockerSelect(null)}>
                              <option value="" disabled>Select blocker…</option>
                              {projects.filter(x => x.id !== p.id && !(p.blockedBy ?? []).includes(x.id)).map(x => (
                                <option key={x.id} value={x.id}>{x.name}</option>
                              ))}
                            </select>
                          ) : (
                            <button className="dep-add-btn" style={{ width: "auto", margin: 0, padding: "2px 8px" }} onClick={() => addBlocker(p.id)}>+ blocker</button>
                          )}
                          </div>
                          {blockers.length > 0 ? (
                            <div className="dep-blocker-list">
                              {blockers.map(b => (
                                <div key={b.id} className="dep-blocker-item">
                                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: projectColor(b), flexShrink: 0 }} />
                                  {b.name}
                                  <button className="dep-remove-btn" onClick={() => removeBlocker(p.id, b.id)}>x</button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 10, color: "var(--text4)", fontFamily: "var(--font-mono)", paddingLeft: 14 }}>No blockers</div>
                          )}
                        </div>
                      );
                    })}
                    {sorted.length === 0 && <div className="task-empty">Add projects first.</div>}
                  </div>
                </div>
              </div>
            </div>

            {/* TIMELINE */}
            <div className={"view" + (view === "timeline" ? " active" : "")}>
              <TimelineView projects={projects} onOpen={openDetail} />
            </div>

            {/* TAGS */}
            <div className={"view" + (view === "tags" ? " active" : "")}>
              <TagsView projects={projects} activeTag={activeTag} onTagSelect={setActiveTag} onOpen={id => openDetail(id)} />
            </div>

            {/* WEEKLY REVIEW */}
            <div className={"view" + (view === "review" ? " active" : "")}>
              <div style={{ padding: "var(--pad-section)", display: "flex", flexDirection: "column", gap: 20, flex: 1, overflowY: "auto" }}>
                <div><div className="settings-title">Weekly Review</div><div className="settings-sub">Structured reflection to keep your work on track</div></div>
                <div className="sg">
                  <div className="sg-title">Start this week's review</div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
                    <div className="si"><p>Monday review</p><span>Takes 5 minutes. What shipped, what's stuck, what's next.</span></div>
                    <button className="btn-save" onClick={() => setShowReview(true)}>Begin weekly review →</button>
                  </div>
                </div>
                {reviews.length > 0 && (
                  <div className="sg">
                    <div className="sg-title">Past reviews ({reviews.length})</div>
                    {[...reviews].reverse().map((r, i) => (
                      <div key={i} className="srow" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text2)" }}>
                            {new Date(r.weekStart).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                          </span>
                          <div style={{ display: "flex", gap: 6 }}>
                            {r.shipped.length > 0 && <span className="pill pill-accent">{r.shipped.length} shipped</span>}
                            {r.blocked.length > 0 && <span className="pill pill-red">{r.blocked.length} blocked</span>}
                          </div>
                        </div>
                        {r.aiSummary && <div style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic", lineHeight: 1.6 }}>{r.aiSummary}</div>}
                        {r.notes && <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.6 }}>{r.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* DETAIL */}
            <div className={"view" + (view === "detail" ? " active" : "")}>
              {sel && (() => {
                const sc = scoreProject(sel, projects); const color = projectColor(sel);
                return (
                  <>
                    <div className="detail-hero">
                      <div>
                        <div className="detail-name">{sel.name}</div>
                        <div className="detail-desc">{sel.desc}</div>
                        <div className="detail-pills">
                          {sel.status === "shipped"
                            ? <span className="pill pill-shipped">✓ Shipped</span>
                            : <span className="pill" style={{ color, borderColor: "rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)" }}>{sc.stage}</span>
                          }
                          {sel.status !== "shipped" && <span className={"pill " + (livedays(sel) < 0 ? "pill-red" : "pill-dim")}>{fmtDays(livedays(sel))}</span>}
                          <span className="pill pill-dim">{sel.track || "—"}</span>
                          {sel.tags.map(t => <span key={t} className="pill pill-dim">{t}</span>)}
                          {sc.decayPenalty > 0 && <span className="pill" style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)" }}>↓ {sc.decayPenalty}pt decay</span>}
                          {sc.blockPenalty  > 0 && <span className="block-badge">blocked -{sc.blockPenalty}pts</span>}
                        </div>
                      </div>

                      {/* ── Shipped state ── */}
                      {sel.status === "shipped" ? (
                        <div className="shipped-block">
                          <div className="shipped-check">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="32" height="32">
                              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <div className="shipped-label">Done</div>
                          <div className="shipped-stats">
                            <div className="shipped-stat">
                              <span className="shipped-stat-val">{taskCompletion(sel)}%</span>
                              <span className="shipped-stat-lbl">tasks done</span>
                            </div>
                            {totalFocusTime(sel.focusSessions ?? []) > 0 && (
                              <div className="shipped-stat">
                                <span className="shipped-stat-val">{fmtDuration(totalFocusTime(sel.focusSessions ?? []))}</span>
                                <span className="shipped-stat-lbl">focused</span>
                              </div>
                            )}
                            <div className="shipped-stat">
                              <span className="shipped-stat-val">{new Date(sel.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                              <span className="shipped-stat-lbl">started</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap", justifyContent: "center" }}>
                            <button className="t-btn" onClick={() => openEdit(sel)}><I.edit /> Edit</button>
                            <button className="t-btn" onClick={() => {
                              const md = projectToMarkdown(sel, sc);
                              const blob = new Blob([md], { type: "text/markdown" });
                              const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: sel.name + ".md" });
                              a.click(); toast("Exported as Markdown.");
                            }}>Export .md</button>
                            <button className="t-btn" onClick={() => {
                              updateProject(sel.id, { status: "active", lastTouched: new Date().toISOString() });
                              toast(sel.name + " reactivated.");
                            }}><I.unarchive /> Reactivate</button>
                            <button className="t-btn danger" onClick={() => removeProject(sel.id)}>Remove</button>
                          </div>
                        </div>
                      ) : (
                        /* ── Active scoring state ── */
                        <div className="score-block">
                          <div className="score-giant" style={{ color }}>{sc.score}%</div>
                          <div className="score-label">Priority score</div>
                          <div className="score-breakdown">
                            <div className="score-breakdown-row"><span>Base score</span><span>{sc.rawScore}%</span></div>
                            {sc.decayPenalty > 0 && <div className="score-breakdown-row"><span>Decay</span><span className="neg">-{sc.decayPenalty}</span></div>}
                            {sc.blockPenalty  > 0 && <div className="score-breakdown-row"><span>Blocked</span><span className="neg">-{sc.blockPenalty}</span></div>}
                            <div className="score-breakdown-row total"><span>Total</span><span>{sc.score}%</span></div>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <button className="t-btn" onClick={() => openEdit(sel)}><I.edit /> Edit</button>
                            <button className="t-btn" onClick={() => setFocusProjectId(sel.id)}>Focus mode</button>
                            <button className="t-btn" onClick={() => {
                              const md = projectToMarkdown(sel, sc);
                              const blob = new Blob([md], { type: "text/markdown" });
                              const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: sel.name + ".md" });
                              a.click(); toast("Exported as Markdown.");
                            }}>Export .md</button>
                            <button className="t-btn ship-btn" onClick={() => {
                              updateProject(sel.id, { status: "shipped", lastTouched: new Date().toISOString() });
                              toast(sel.name + " shipped! Moving to Archive.");
                              setTimeout(() => setView("archive"), 1200);
                            }}>
                              {I.check(11)} Mark as done
                            </button>
                            <button className="t-btn danger" onClick={() => removeProject(sel.id)}>Remove</button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Inline edit panel ── */}
                    {editingProject && (
                      <div className="edit-panel">
                        <div className="edit-panel-head">
                          <span className="edit-panel-title">Edit project</span>
                          <button className="btn-cancel" onClick={() => setEditingProject(false)}>Cancel</button>
                        </div>
                        <div className="comp-grid">
                          <label><span className="f-lbl">Name</span>
                            <input className="f-input" value={editDraft.name ?? ""} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} /></label>
                          <label><span className="f-lbl">Track</span>
                            <input className="f-input" value={editDraft.track ?? ""} onChange={e => setEditDraft(d => ({ ...d, track: e.target.value }))} placeholder="Frontend, AI, Writing…" /></label>
                          <label className="span-2"><span className="f-lbl">Description</span>
                            <textarea className="f-input" value={editDraft.desc ?? ""} onChange={e => setEditDraft(d => ({ ...d, desc: e.target.value }))} /></label>
                          <label><span className="f-lbl">Status</span>
                            <select className="f-input" value={editDraft.status ?? "active"} onChange={e => setEditDraft(d => ({ ...d, status: e.target.value as ProjectStatus }))}>
                              <option value="concept">concept</option><option value="active">active</option>
                              <option value="paused">paused</option><option value="shipped">shipped</option>
                            </select>
                          </label>
                          <label><span className="f-lbl">Deadline</span>
                            <input className="f-input" type="date"
                              value={editDraft.deadlineDate ?? sel.deadlineDate ?? ""}
                              onChange={e => setEditDraft(d => ({ ...d, deadlineDate: e.target.value, daysLeft: daysFromDeadline(e.target.value) }))} />
                          </label>
                          {(["impact","effort","energy","confidence"] as const).map(k => (
                            <label key={k}>
                              <div className="range-head"><span>{k}</span><strong>{editDraft[k] ?? sel[k]}</strong></div>
                              <input type="range" min={1} max={10} value={editDraft[k] ?? sel[k]} onChange={e => setEditDraft(d => ({ ...d, [k]: Number(e.target.value) }))} />
                            </label>
                          ))}
                          <label className="span-2"><span className="f-lbl">Tags</span>
                            <TagInput tags={editDraft.tags ?? sel.tags} onChange={tags => setEditDraft(d => ({ ...d, tags }))} />
                          </label>
                        </div>
                        <div className="drawer-footer">
                          <button className="btn-cancel" onClick={() => setEditingProject(false)}>Discard</button>
                          <button className="btn-save" onClick={() => {
                            updateProject(sel.id, { ...editDraft, lastTouched: new Date().toISOString() });
                            setEditingProject(false);
                            toast("Project updated.");
                          }}>Save changes →</button>
                        </div>
                      </div>
                    )}
                    <div className="detail-stats">
                      <div className="dstat"><div className="dstat-lbl">Track</div><div className="dstat-val">{sel.track || "—"}</div></div>
                      <div className="dstat"><div className="dstat-lbl">Deadline</div><div className="dstat-val">{fmtDays(livedays(sel))}</div></div>
                      <div className="dstat"><div className="dstat-lbl">Focus time</div><div className="dstat-val" style={{ color }}>{fmtDuration(totalFocusTime(sel.focusSessions ?? []))}</div></div>
                      <div className="dstat"><div className="dstat-lbl">Completion</div><div className="dstat-val">{taskCompletion(sel)}%</div></div>
                    </div>
                    {(sel.scoreHistory ?? []).length >= 2 && sel.status !== "shipped" && (
                      <div style={{ padding: "12px var(--pad-section)", borderBottom: "1px solid var(--rule)" }}>
                        <div className="bar-key" style={{ marginBottom: 6 }}>Score history (30 days)</div>
                        <Sparkline history={sel.scoreHistory} color={color} />
                      </div>
                    )}
                    {sel.status !== "shipped" && (
                    <div className="bars-section">
                      {(["impact", "effort", "energy", "confidence"] as const).map(k => (
                        <div className="bar-row" key={k}>
                          <div className="bar-meta"><span className="bar-key">{k}</span><span className="bar-val">{sel[k]}/10</span></div>
                          <div className="bar-track"><div className="bar-fill" style={{ width: sel[k] * 10 + "%", background: k === "effort" ? "rgba(240,236,228,0.18)" : color }} /></div>
                        </div>
                      ))}
                    </div>
                    )}
                    <div className="tasks-section">
                      <div className="tasks-head">
                        <div className="tasks-title">Tasks</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="add-task-btn" style={{ color: "var(--text3)", borderColor: "var(--rule2)" }} onClick={() => setShowGitHub(g => !g)}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                            GitHub issues
                          </button>
                          <button className="add-task-btn" style={{ color, borderColor: "rgba(255,255,255,0.15)" }} onClick={() => addTask(sel.id)}><I.plus />Add task</button>
                        </div>
                      </div>
                      {showGitHub && (
                        <div style={{ marginBottom: 16 }}>
                          <GitHubSync token={settings.gitHubToken} projectId={sel.id}
                            existingTaskTexts={sel.tasks.map(t => t.note)}
                            onImport={(title, note) => importIssueAsTask(sel.id, title, note)}
                            onTokenChange={t => patchSettings({ gitHubToken: t })} />
                        </div>
                      )}
                      {renderTasks(sel, color)}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* AI ADVISOR */}
            <div className={"view" + (view === "ai" ? " active" : "")}>
              <div className="ai-wrap">
                <div className="ai-head">
                  <div className="ai-title">AI Advisor</div>
                  <div className="ai-sub">Powered by <strong>Ollama</strong> — runs 100% locally, no API key, no internet required</div>
                </div>
                <div className="ai-setup">
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
                    <div>
                      <p style={{ marginBottom: 4 }}><strong>Ollama</strong> runs AI models locally on your machine. No data leaves your computer. Free forever.</p>
                      <p style={{ fontSize: 10, color: "var(--text3)", lineHeight: 1.6 }}>
                        1. Download from <strong style={{ color: "var(--text2)" }}>ollama.com</strong>
                        {"  2. Run "}
                        <code style={{ background: "var(--bg3)", padding: "1px 5px", borderRadius: 2, fontFamily: "var(--font-mono)", fontSize: 10 }}>
                          {"ollama pull " + settings.ollamaModel}
                        </code>
                        {"  3. Come back and chat"}
                      </p>
                    </div>
                    <button className="ai-save-btn" style={{ flexShrink: 0 }} onClick={async () => {
                      const s = await checkOllamaStatus();
                      const count = s.models.length;
                      if (s.running) toast("Ollama running - " + count + " model" + (count === 1 ? "" : "s") + " available");
                      else toast("Ollama not detected — is it running?");
                    }}>Check status</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <span className="f-lbl">Model</span>
                      <input className="ai-key-input" value={settings.ollamaModel}
                        onChange={e => patchSettings({ ollamaModel: e.target.value })} placeholder="llama3.2" list="ollama-models" />
                      <datalist id="ollama-models">
                        {ollamaStatus.models.map(m => <option key={m} value={m} />)}
                        {["llama3.2","llama3.1","mistral","gemma2","phi3","codellama","qwen2.5"].map(m => <option key={m} value={m} />)}
                      </datalist>
                    </div>
                    <div>
                      <span className="f-lbl">Ollama URL</span>
                      <input className="ai-key-input" value={settings.ollamaUrl}
                        onChange={e => patchSettings({ ollamaUrl: e.target.value })} placeholder="http://localhost:11434" />
                    </div>
                  </div>
                  {ollamaStatus.checked && (
                    <div className={"ai-status" + (ollamaStatus.running ? " connected" : "")} style={{ marginTop: 8 }}>
                      <span className={"ai-status-dot" + (ollamaStatus.running ? " connected" : "")} />
                      {ollamaStatus.running
                        ? "Running - " + (ollamaStatus.models.length > 0 ? ollamaStatus.models.join(", ") : "no models pulled yet")
                        : "Not detected — start Ollama or run: ollama serve"
                      }
                    </div>
                  )}
                </div>
                <div className="ai-chips">
                  {["What should I work on today?", "Which project is most at risk?", "What's decaying?", "What's blocked?", "Summarise my workload"].map(q => (
                    <div key={q} className="ai-chip" onClick={() => sendAi(q)}>{q}</div>
                  ))}
                </div>
                <div className="ai-chat" ref={chatRef}>
                  {aiMessages.map((m, i) => (
                    <div key={i} className={"ai-msg " + m.role} style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                  ))}
                  {aiLoading && (
                    <div className="ai-msg bot" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-flex", gap: 3 }}>
                        {[0,1,2].map(i => (
                          <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "blink 1.2s ease-in-out " + (i * 0.2) + "s infinite" }} />
                        ))}
                      </span>
                      Thinking...
                    </div>
                  )}
                </div>
                <div className="ai-input-row">
                  <input className="ai-input" placeholder="Ask me anything about your projects..."
                    value={aiInput} onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !aiLoading) { sendAi(aiInput); setAiInput(""); } }} />
                  <button className="ai-send" onClick={() => { if (!aiLoading) { sendAi(aiInput); setAiInput(""); } }} disabled={aiLoading} style={{ opacity: aiLoading ? 0.5 : 1 }}>
                    <I.send />
                  </button>
                </div>
              </div>
            </div>

            {/* ARCHIVE */}
            <div className={"view" + (view === "archive" ? " active" : "")}>
              <div style={{ padding: "var(--pad-section)", display: "flex", flexDirection: "column", gap: 20, flex: 1, overflowY: "auto" }}>
                <div>
                  <div className="settings-title">Archive</div>
                  <div className="settings-sub">Shipped projects — completed work, preserved for reference</div>
                </div>
                {sorted.filter(p => p.status === "shipped").length === 0 ? (
                  <div className="task-empty" style={{ padding: "40px 0", textAlign: "center" }}>
                    No shipped projects yet. Mark a project as "shipped" to archive it.
                  </div>
                ) : (
                  <div className="cards-grid">
                    {sorted.filter(p => p.status === "shipped").map(p => {
                      const color = projectColor(p);
                      const comp = taskCompletion(p);
                      const sessions = p.focusSessions ?? [];
                      const totalTime = totalFocusTime(sessions);
                      return (
                        <div key={p.id} className="proj-card archive-card"
                          style={{ "--pc": color } as React.CSSProperties}
                          onClick={() => openDetail(p.id)}>
                          <div className="pc-top">
                            <div className="pc-name">{p.name}</div>
                            <span className="pill pill-dim" style={{ color: "#22d3ee", borderColor: "rgba(34,211,238,0.3)", background: "rgba(34,211,238,0.07)" }}>shipped</span>
                          </div>
                          <div className="pc-desc">{p.desc}</div>
                          <div className="pc-pills">
                            <span className="pill pill-dim">{p.track || "—"}</span>
                            {p.tags.slice(0, 3).map(t => <span key={t} className="pill pill-dim">#{t}</span>)}
                          </div>
                          <div className="archive-stats">
                            <div className="archive-stat">
                              <span className="archive-stat-lbl">Tasks</span>
                              <span className="archive-stat-val">{p.tasks.filter(t => t.done).length}/{p.tasks.length}</span>
                            </div>
                            {totalTime > 0 && (
                              <div className="archive-stat">
                                <span className="archive-stat-lbl">Focus time</span>
                                <span className="archive-stat-val" style={{ color }}>{fmtDuration(totalTime)}</span>
                              </div>
                            )}
                            {sessions.length > 0 && (
                              <div className="archive-stat">
                                <span className="archive-stat-lbl">Sessions</span>
                                <span className="archive-stat-val">{sessions.length}</span>
                              </div>
                            )}
                            <div className="archive-stat">
                              <span className="archive-stat-lbl">Created</span>
                              <span className="archive-stat-val">{new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                            </div>
                          </div>
                          <div className="pc-progress" style={{ marginTop: 8 }}>
                            <div className="pc-progress-fill" style={{ width: comp + "%", background: color }} />
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                            <button className="btn-cancel" style={{ fontSize: 9, padding: "3px 8px" }}
                              onClick={e => { e.stopPropagation(); updateProject(p.id, { status: "active" }); toast(p.name + " moved back to active."); }}>
                              Reactivate
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* SETTINGS */}
            <div className={"view" + (view === "settings" ? " active" : "")}>
              <div className="settings-wrap">
                <div><div className="settings-title">Settings</div><div className="settings-sub">Personalise your Meridian workspace</div></div>
                <div className="sg">
                  <div className="sg-title">Profile</div>
                  <div className="srow"><div className="si"><p>Your name</p><span>Used in greetings and the avatar</span></div>
                    <input className="s-input" value={settings.name} onChange={e => patchSettings({ name: e.target.value })} /></div>
                  <div className="srow"><div className="si"><p>Working hours</p><span>Affects urgency scoring</span></div>
                    <input className="s-input" value={settings.workingHours} onChange={e => patchSettings({ workingHours: e.target.value })} /></div>
                </div>
                <div className="sg">
                  <div className="sg-title">Accent palette <span className="settings-section-badge">colour + surfaces</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="accent-grid" style={{ width: "100%" }}>
                      {(Object.keys(ACCENT_THEMES) as AccentTheme[]).map(k => {
                        const th = ACCENT_THEMES[k];
                        return (
                          <div key={k}
                            className={"accent-swatch" + (settings.theme.accent === k ? " on" : "") + (th.light ? " light-swatch" : "")}
                            style={{ background: th.preview }}
                            onClick={() => patchTheme({ accent: k })}>
                            <span className="accent-swatch-label">{th.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="sg">
                  <div className="sg-title">Typography <span className="settings-section-badge">fonts + scale</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="theme-grid" style={{ width: "100%", gridTemplateColumns: "repeat(3,1fr)" }}>
                      {(Object.keys(TYPOGRAPHY_THEMES) as TypographyTheme[]).map(k => {
                        const th = TYPOGRAPHY_THEMES[k];
                        return (
                          <div key={k} className={"theme-option" + (settings.theme.typography === k ? " on" : "")} onClick={() => patchTheme({ typography: k })}>
                            <div className="typo-preview" style={{ fontFamily: th.vars["--font-display"], fontWeight: th.vars["--display-weight"] as unknown as number }}>Aa</div>
                            <div className="theme-option-label">{th.label}</div>
                            <div className="theme-option-desc">{th.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="sg">
                  <div className="sg-title">Layout density <span className="settings-section-badge">spacing</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="theme-grid" style={{ width: "100%" }}>
                      {(Object.keys(DENSITY_THEMES) as DensityTheme[]).map(k => {
                        const th = DENSITY_THEMES[k];
                        return <div key={k} className={"theme-option" + (settings.theme.density === k ? " on" : "")} onClick={() => patchTheme({ density: k })}><div className="theme-option-label">{th.label}</div><div className="theme-option-desc">{th.desc}</div></div>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="sg">
                  <div className="sg-title">Border radius <span className="settings-section-badge">shape</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="theme-grid" style={{ width: "100%" }}>
                      {(Object.keys(BORDER_RADIUS_THEMES) as BorderRadiusTheme[]).map(k => {
                        const th = BORDER_RADIUS_THEMES[k];
                        return <div key={k} className={"theme-option" + ((settings.theme.borderRadius ?? "sharp") === k ? " on" : "")} onClick={() => patchTheme({ borderRadius: k })}><div className="theme-option-label">{th.label}</div><div className="theme-option-desc">{th.desc}</div></div>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="sg">
                  <div className="sg-title">Card style <span className="settings-section-badge">cards + panels</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="theme-grid" style={{ width: "100%" }}>
                      {(Object.keys(CARD_STYLE_THEMES) as CardStyleTheme[]).map(k => {
                        const th = CARD_STYLE_THEMES[k];
                        return <div key={k} className={"theme-option" + ((settings.theme.cardStyle ?? "minimal") === k ? " on" : "")} onClick={() => patchTheme({ cardStyle: k })}><div className="theme-option-label">{th.label}</div><div className="theme-option-desc">{th.desc}</div></div>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="sg">
                  <div className="sg-title">Surface texture <span className="settings-section-badge">materials</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="theme-grid" style={{ width: "100%" }}>
                      {(Object.keys(TEXTURE_THEMES) as TextureTheme[]).map(k => {
                        const th = TEXTURE_THEMES[k];
                        return <div key={k} className={"theme-option" + (settings.theme.texture === k ? " on" : "")} onClick={() => patchTheme({ texture: k })}><div className="theme-option-label">{th.label}</div><div className="theme-option-desc">{th.desc}</div></div>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="sg">
                  <div className="sg-title">Animation speed <span className="settings-section-badge">motion</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="theme-grid" style={{ width: "100%" }}>
                      {(Object.keys(ANIMATION_SPEED_THEMES) as AnimationSpeedTheme[]).map(k => {
                        const th = ANIMATION_SPEED_THEMES[k];
                        return <div key={k} className={"theme-option" + ((settings.theme.animationSpeed ?? "normal") === k ? " on" : "")} onClick={() => patchTheme({ animationSpeed: k })}><div className="theme-option-label">{th.label}</div><div className="theme-option-desc">{th.desc}</div></div>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="sg">
                  <div className="sg-title">Sidebar width <span className="settings-section-badge">layout</span></div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <div className="theme-grid" style={{ width: "100%" }}>
                      {(Object.keys(SIDEBAR_WIDTH_THEMES) as SidebarWidthTheme[]).map(k => {
                        const th = SIDEBAR_WIDTH_THEMES[k];
                        return <div key={k} className={"theme-option" + ((settings.theme.sidebarWidth ?? "default") === k ? " on" : "")} onClick={() => patchTheme({ sidebarWidth: k })}><div className="theme-option-label">{th.label}</div><div className="theme-option-desc">{th.desc}</div></div>;
                      })}
                    </div>
                  </div>
                </div>
                <div className="sg">
                  <div className="sg-title">Integrations</div>
                  <div className="srow" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
                    <div className="si"><p>GitHub token</p><span>For importing issues as tasks. Stored locally only.</span></div>
                    <div style={{ display: "flex", gap: 8, width: "100%" }}>
                      <input className="s-input" style={{ flex: 1, width: "auto" }}
                        type="password"
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        value={ghTokenDraft || settings.gitHubToken}
                        onChange={e => setGhTokenDraft(e.target.value)} />
                      <button className="btn-cancel" onClick={async () => {
                        await saveGitHubToken(ghTokenDraft);
                        toast("GitHub token saved securely.");
                      }}>Save</button>
                      {settings.gitHubToken && <button className="btn-cancel" style={{ color: "#ef4444" }} onClick={() => { patchSettings({ gitHubToken: "" }); setGhTokenDraft(""); toast("Token removed."); }}>Remove</button>}
                    </div>
                  </div>
                  <div className="srow"><div className="si"><p>Ollama model</p><span>AI Advisor model — run: ollama pull llama3.2</span></div>
                    <input className="s-input" value={settings.ollamaModel} onChange={e => patchSettings({ ollamaModel: e.target.value })} placeholder="llama3.2" /></div>
                  <div className="srow"><div className="si"><p>Ollama URL</p><span>Default: http://localhost:11434</span></div>
                    <input className="s-input" value={settings.ollamaUrl} onChange={e => patchSettings({ ollamaUrl: e.target.value })} placeholder="http://localhost:11434" /></div>
                </div>
                <div className="sg">
                  <div className="sg-title">Daily Digest</div>
                  <div style={{ padding: "10px 18px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div><div className="digest-title">Morning priority notification</div><div className="digest-sub">Fires at 9am with your top 3 projects.</div></div>
                    <div className={"toggle" + (settings.digestEnabled ? " on" : "")} onClick={async () => {
                      if (!settings.digestEnabled) {
                        const perm = await requestNotificationPermission();
                        if (perm !== "granted") { toast("Enable notifications in your browser settings."); return; }
                        scheduleDailyDigest(projects, settings.name);
                      }
                      patchSettings({ digestEnabled: !settings.digestEnabled });
                    }} />
                  </div>
                  {sorted.length > 0 && (
                    <div className="digest-preview">
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 4 }}>Preview — today's digest</div>
                      {sorted.filter(p => p.status !== "shipped").slice(0, 3).map((p, i) => {
                        const sc = scoreProject(p, projects); const color = projectColor(p);
                        return (
                          <div key={p.id} className="digest-preview-item">
                            <span className="digest-preview-rank">{i + 1}.</span>
                            <div className="sb-dot" style={{ background: color, width: 6, height: 6, borderRadius: "50%", flexShrink: 0 }} />
                            {p.name}
                            <span className="digest-preview-score" style={{ color }}>{sc.score}%</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button className="digest-test-btn" onClick={async () => {
                    const perm = await requestNotificationPermission();
                    if (perm !== "granted") { toast("Enable notifications in browser settings first."); return; }
                    sendDigestNotification(projects, settings.name);
                    toast("Test notification sent.");
                  }}>Send test notification</button>
                </div>
                <div className="sg">
                  <div className="sg-title">Updates</div>
                  <div className="srow">
                    <div className="si">
                      <p>Check for updates</p>
                      <span>{updateInfo?.state === "available" ? `v${updateInfo.version} available` : updateInfo?.state === "ready" ? `v${updateInfo.version} ready to install` : "Meridian checks automatically on launch"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {updateInfo?.state === "ready" && (
                        <button className="btn-save" style={{ fontSize: 9 }} onClick={() => window.electron?.updater.install()}>
                          Restart &amp; install
                        </button>
                      )}
                      {(!updateInfo || updateInfo.state === "error") && (
                        <button className="btn-cancel" onClick={async () => {
                          if (!window.electron) { toast("Auto-updates only available in the desktop app."); return; }
                          const r = await window.electron.updater.check();
                          if (r?.error) toast("Update check failed: " + r.error);
                          else toast("Checking for updates…");
                        }}>Check now</button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="sg">
                  <div className="sg-title">Data</div>
                  <div className="srow"><div className="si"><p>Export all projects</p><span>Downloads as JSON</span></div>
                    <button className="btn-cancel" onClick={() => { exportJson(projects); toast("Exported."); }}>Export JSON</button></div>
                  <div className="srow"><div className="si"><p>Import projects</p><span>Load a Meridian export</span></div>
                    <button className="btn-cancel" onClick={() => fileRef.current?.click()}>Import JSON</button></div>
                  <div className="srow">
                    <div className="si"><p>Clear all data</p><span style={{ color: "#ef4444" }}>Cannot be undone</span></div>
                    <button className="btn-cancel" style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}
                      onClick={() => { const snap = projects; saveProjects([]); setView("dashboard"); toast("Data cleared — undo?"); undoRef.current = () => saveProjects(snap); undoTimer.current = setTimeout(() => { undoRef.current = null; }, 5000); }}>
                      Clear data
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}