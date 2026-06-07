import type { Project, ProjectScore, FocusSession } from "./types";
import { PROJECT_COLORS } from "./data";

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

function urgency(d: number): number {
  if (d < 0)   return 34;
  if (d <= 3)  return 38;
  if (d <= 7)  return 30;
  if (d <= 21) return 18;
  return 9;
}

// ── DECAY ─────────────────────────────────────────────────────
export function decayPenaltyFor(p: Project): number {
  if (p.status === "shipped") return 0;
  const daysSince = Math.floor(
    (Date.now() - new Date(p.lastTouched ?? p.createdAt).getTime()) / 86400000
  );
  const threshold = p.decayDays ?? 7;
  if (daysSince <= threshold) return 0;
  // -2 points per day past the threshold, max -30
  return Math.min((daysSince - threshold) * 2, 30);
}

// ── SCORE ─────────────────────────────────────────────────────
export function scoreProject(p: Project, allProjects?: Project[]): ProjectScore {
  // Always recompute days from the deadline date if available
  const liveDaysLeft = p.deadlineDate
    ? Math.round((new Date(p.deadlineDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
    : p.daysLeft;

  const u = urgency(liveDaysLeft);
  const raw = Math.round(clamp(p.impact * 4.2 + p.confidence * 2.4 + p.energy * 2.1 + u - p.effort * 2.8, 0, 100));

  const decay = decayPenaltyFor(p);

  // Block penalty: -15 for each unshipped blocker
  let blockPenalty = 0;
  if (allProjects && p.blockedBy?.length) {
    const unblockedCount = p.blockedBy.filter(id => {
      const blocker = allProjects.find(x => x.id === id);
      return blocker && blocker.status !== "shipped";
    }).length;
    blockPenalty = unblockedCount * 15;
  }

  const score = Math.round(clamp(raw - decay - blockPenalty, 0, 100));

  let stage = "Parked";
  if (p.status === "shipped") stage = "Shipped";
  else if (score >= 68) stage = "Launch Lane";
  else if (score >= 50) stage = "Next Burn";
  else if (score >= 34) stage = "Incubate";

  return { score, rawScore: raw, decayPenalty: decay, blockPenalty, stage, liveDaysLeft };
}

export const projectColor = (p: Project): string =>
  PROJECT_COLORS[p.colorIdx % PROJECT_COLORS.length];

export function fmtDays(d: number): string {
  if (d < 0)   return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `${d}d left`;
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const taskCompletion = (p: Project): number => {
  if (!p.tasks.length) return 0;
  return Math.round(p.tasks.filter(t => t.done).length / p.tasks.length * 100);
};

export const uid = (): string => Math.random().toString(36).slice(2, 9);

export function exportJson(projects: Project[]): void {
  const blob = new Blob([JSON.stringify(projects, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: "meridian-export.json",
  });
  a.click();
}

export const sortedByScore = (projects: Project[], all?: Project[]): Project[] =>
  [...projects].sort((a, b) => scoreProject(b, all ?? projects).score - scoreProject(a, all ?? projects).score);

// ── FOCUS SESSION HELPERS ─────────────────────────────────────
export function totalFocusTime(sessions: FocusSession[]): number {
  return sessions.reduce((acc, s) => acc + s.duration, 0);
}

export function focusThisWeek(sessions: FocusSession[]): number {
  const monday = getMondayISO(new Date());
  return sessions
    .filter(s => s.date >= monday)
    .reduce((acc, s) => acc + s.duration, 0);
}

// ── WEEKLY REVIEW HELPERS ─────────────────────────────────────
export function getMondayISO(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function isMonday(): boolean {
  return new Date().getDay() === 1;
}

export function shouldPromptReview(lastPrompt: string): boolean {
  if (!lastPrompt) return isMonday();
  const monday = getMondayISO(new Date());
  return isMonday() && lastPrompt < monday;
}

// ── SCORE HISTORY ─────────────────────────────────────────────
export function appendScoreHistory(
  p: Project,
  score: number
): Project["scoreHistory"] {
  const today = new Date().toISOString().slice(0, 10);
  const hist = p.scoreHistory ?? [];
  // Only record once per day
  if (hist[hist.length - 1]?.date === today) {
    return hist.map(h => h.date === today ? { ...h, score } : h);
  }
  return [...hist.slice(-29), { date: today, score }]; // keep 30 days
}

// ── MARKDOWN EXPORT ───────────────────────────────────────────
export function projectToMarkdown(p: Project, sc: ProjectScore): string {
  const tasks = p.tasks.map(t =>
    `- [${t.done ? "x" : " "}] ${t.text}${t.note ? ` *(${t.note})*` : ""}`
  ).join("\n");
  return `# ${p.name}

**Track:** ${p.track || "—"}  
**Status:** ${p.status}  
**Priority score:** ${sc.score}%  
**Stage:** ${sc.stage}  
**Deadline:** ${fmtDays(p.daysLeft)}  
**Tags:** ${p.tags.join(", ") || "—"}

## Description
${p.desc}

## Tasks
${tasks || "No tasks yet."}

---
*Exported from Meridian on ${new Date().toLocaleDateString()}*
`;
}

// ── OLLAMA AI ─────────────────────────────────────────────────
// Ollama runs locally on the user's machine — no API key, no internet,
// no rate limits. Users install it once and pull any model they want.
// Default: llama3.2 (fast, smart, runs on CPU)
//
// Install: https://ollama.com
// Then:    ollama pull llama3.2

export const OLLAMA_DEFAULT_URL   = "http://localhost:11434";
export const OLLAMA_DEFAULT_MODEL = "llama3.2";

export interface OllamaStatus {
  running: boolean;
  models: string[];
  error?: string;
}

export async function checkOllama(baseUrl: string): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, models: [], error: `Ollama responded with ${res.status}` };
    const data = await res.json() as { models?: { name: string }[] };
    const models = (data.models ?? []).map(m => m.name.replace(/:latest$/, ""));
    return { running: true, models };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fetch") || msg.includes("connect") || msg.includes("ECONNREFUSED")) {
      return { running: false, models: [], error: "Ollama is not running. Start it with: ollama serve" };
    }
    return { running: false, models: [], error: msg };
  }
}

export async function askOllama(
  baseUrl: string,
  model: string,
  userMessage: string,
  projects: Project[]
): Promise<string> {
  const top = projects
    .slice(0, 8)
    .map(p => {
      const sc = scoreProject(p, projects);
      const flags = [
        sc.decayPenalty > 0 ? `stale(-${sc.decayPenalty}pts)` : "",
        sc.blockPenalty > 0 ? `blocked(-${sc.blockPenalty}pts)` : "",
      ].filter(Boolean).join(", ");
      const open = p.tasks.filter(t => !t.done).length;
      return `- ${p.name} (${p.track}): score ${sc.score}%, ${sc.stage}, ${p.status}, ${fmtDays(p.daysLeft)}, ${open} open tasks${flags ? ` [${flags}]` : ""}`;
    })
    .join("\n");

  const system =
    `You are Meridian AI, a sharp and concise project advisor built into a local productivity app. ` +
    `Answer in 2-3 sentences max. Be direct and actionable. Reference projects by name. ` +
    `Flag decaying or blocked projects.\n\nUser's current projects:\n${top}`;

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system",  content: system },
        { role: "user",    content: userMessage },
      ],
      stream: false,
      options: { temperature: 0.7, num_predict: 200 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    if (res.status === 404) throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}${body ? `: ${body.slice(0, 100)}` : ""}`);
  }

  const data = await res.json() as { message?: { content?: string }; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.message?.content ?? "").trim() || "No response — try again.";
}

export const OLLAMA_NOT_RUNNING_MSG =
  `Ollama isn't running. To set it up:\n\n` +
  `1. Download from ollama.com (free, Mac/Windows/Linux)\n` +
  `2. Run: ollama pull llama3.2\n` +
  `3. Ollama starts automatically — then try again here.`;

export function allTags(projects: Project[]): { tag: string; count: number }[] {
  const map: Record<string, number> = {};
  projects.forEach(p => p.tags.forEach(t => { map[t] = (map[t] ?? 0) + 1; }));
  return Object.entries(map)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function projectsByTag(projects: Project[], tag: string): Project[] {
  return projects.filter(p => p.tags.includes(tag));
}

// ── TIMELINE HELPERS ──────────────────────────────────────────
export interface TimelineEntry {
  project: Project;
  score: ProjectScore;
  color: string;
  startOffset: number; // days from today (negative = past)
  daysLeft: number;
  overdue: boolean;
}

export function buildTimeline(projects: Project[], all: Project[]): TimelineEntry[] {
  return projects
    .filter(p => p.status !== "shipped")
    .map(p => ({
      project: p,
      score: scoreProject(p, all),
      color: PROJECT_COLORS[p.colorIdx % PROJECT_COLORS.length],
      startOffset: -(30 - Math.min(p.daysLeft + 30, 60)), // rough start
      daysLeft: p.daysLeft,
      overdue: p.daysLeft < 0,
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

// ── PROJECT TEMPLATES ─────────────────────────────────────────
export interface ProjectTemplate {
  id: string;
  name: string;
  desc: string;
  track: string;
  impact: number;
  effort: number;
  energy: number;
  confidence: number;
  daysLeft: number;
  tags: string[];
  tasks: { text: string; priority: "high" | "med" | "low"; note: string }[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "oss-launch",
    name: "Open Source Launch",
    desc: "Package, document, and release an open source project to GitHub with a proper README, examples, and community scaffolding.",
    track: "Open Source",
    impact: 8, effort: 6, energy: 8, confidence: 7, daysLeft: 21,
    tags: ["oss", "release", "portfolio"],
    tasks: [
      { text: "Write comprehensive README with install, usage, and API docs", priority: "high", note: "Include badges and a demo GIF" },
      { text: "Add CONTRIBUTING.md and CODE_OF_CONDUCT.md", priority: "med", note: "" },
      { text: "Set up GitHub Actions CI pipeline", priority: "high", note: "" },
      { text: "Write at least 3 usage examples", priority: "high", note: "" },
      { text: "Tag and create first GitHub release with changelog", priority: "med", note: "" },
      { text: "Submit to relevant directories and communities", priority: "low", note: "HN, Reddit, Discord servers" },
    ],
  },
  {
    id: "freelance-client",
    name: "Freelance Client Project",
    desc: "Scoped client engagement — discovery, design, build, review, and handover with clear milestones and sign-off points.",
    track: "Freelance",
    impact: 9, effort: 7, energy: 6, confidence: 8, daysLeft: 30,
    tags: ["freelance", "client", "paid"],
    tasks: [
      { text: "Send project brief and scope of work document", priority: "high", note: "Include timeline and payment terms" },
      { text: "Collect assets, credentials, and brand guidelines", priority: "high", note: "" },
      { text: "Deliver first milestone and get written sign-off", priority: "high", note: "" },
      { text: "Mid-project check-in call or status email", priority: "med", note: "" },
      { text: "Final delivery with handover documentation", priority: "high", note: "" },
      { text: "Send invoice and request testimonial", priority: "med", note: "" },
    ],
  },
  {
    id: "learning-sprint",
    name: "Learning Sprint",
    desc: "Focused 2–4 week sprint to learn a new skill, framework, or domain. Output: a small project and personal notes.",
    track: "Learning",
    impact: 6, effort: 5, energy: 9, confidence: 7, daysLeft: 21,
    tags: ["learning", "skill", "personal"],
    tasks: [
      { text: "Define what 'done' looks like — specific skill or project goal", priority: "high", note: "" },
      { text: "Find and bookmark 3 high-quality resources", priority: "med", note: "" },
      { text: "Complete core tutorial or course module", priority: "high", note: "" },
      { text: "Build a small proof-of-concept project from scratch", priority: "high", note: "No copying — build it yourself" },
      { text: "Write a short reflection or blog post on what you learned", priority: "low", note: "" },
    ],
  },
  {
    id: "job-application",
    name: "Job Application",
    desc: "End-to-end job application — research, tailor materials, apply, follow up, and prepare for interviews.",
    track: "Career",
    impact: 9, effort: 5, energy: 6, confidence: 6, daysLeft: 14,
    tags: ["career", "job", "application"],
    tasks: [
      { text: "Research company, team, and role in depth", priority: "high", note: "Check LinkedIn, blog posts, recent news" },
      { text: "Tailor CV and cover letter to this specific role", priority: "high", note: "" },
      { text: "Submit application and log submission date", priority: "high", note: "" },
      { text: "Follow up if no response after 1 week", priority: "med", note: "" },
      { text: "Prepare for technical interview — review job description", priority: "high", note: "" },
      { text: "Prepare 5 behavioural answers using STAR format", priority: "med", note: "" },
    ],
  },
  {
    id: "product-launch",
    name: "Product Launch",
    desc: "Plan, build, and ship a product or feature with a coordinated launch — landing page, announcement, and early user feedback loop.",
    track: "Product",
    impact: 10, effort: 8, energy: 8, confidence: 6, daysLeft: 45,
    tags: ["product", "launch", "marketing"],
    tasks: [
      { text: "Define target audience and core value proposition", priority: "high", note: "" },
      { text: "Build and test the MVP feature set", priority: "high", note: "" },
      { text: "Create landing page with clear CTA", priority: "high", note: "" },
      { text: "Write launch announcement (blog, social, email)", priority: "med", note: "" },
      { text: "Seed to first 10 users and collect feedback", priority: "high", note: "" },
      { text: "Iterate on top 3 feedback items post-launch", priority: "med", note: "" },
    ],
  },
  {
    id: "research-sprint",
    name: "Research Sprint",
    desc: "Deep-dive research into a topic, technology, or market. Output: a written summary, decision, or recommendation document.",
    track: "Research",
    impact: 6, effort: 4, energy: 7, confidence: 8, daysLeft: 14,
    tags: ["research", "analysis", "writing"],
    tasks: [
      { text: "Define the research question clearly in one sentence", priority: "high", note: "" },
      { text: "Identify 5–8 primary sources to review", priority: "high", note: "" },
      { text: "Take structured notes with key findings", priority: "med", note: "" },
      { text: "Identify gaps, contradictions, and open questions", priority: "med", note: "" },
      { text: "Write a 1-page summary with a clear conclusion", priority: "high", note: "" },
    ],
  },
];

// ── GITHUB ISSUES ─────────────────────────────────────────────
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  labels: { name: string; color: string }[];
  html_url: string;
  state: string;
  created_at: string;
}

export async function fetchGitHubIssues(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubIssue[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=50`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error("Invalid GitHub token.");
    if (res.status === 404) throw new Error("Repository not found. Check owner/repo.");
    throw new Error(`GitHub error ${res.status}`);
  }
  const data = await res.json() as GitHubIssue[];
  // Filter out pull requests (they appear as issues in the API)
  return data.filter((i: GitHubIssue) => !("pull_request" in i));
}

// ── DAILY DIGEST ──────────────────────────────────────────────
export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return Promise.resolve("denied");
  return Notification.requestPermission();
}

export function sendDigestNotification(projects: Project[], name: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const top3 = sortedByScore(projects, projects)
    .filter(p => p.status !== "shipped")
    .slice(0, 3);

  if (!top3.length) return;

  const body = top3
    .map((p, i) => `${i + 1}. ${p.name} — ${scoreProject(p, projects).score}%`)
    .join("\n");

  new Notification(`Good morning${name ? `, ${name}` : ""} — your Meridian priorities`, {
    body,
    icon: "/favicon.ico",
    tag: "meridian-digest",
  });
}

export function scheduleDailyDigest(projects: Project[], name: string): void {
  const now = new Date();
  const next9am = new Date(now);
  next9am.setHours(9, 0, 0, 0);
  if (now >= next9am) next9am.setDate(next9am.getDate() + 1);
  const msUntil = next9am.getTime() - now.getTime();

  setTimeout(() => {
    sendDigestNotification(projects, name);
    // Reschedule for next day
    setInterval(() => sendDigestNotification(projects, name), 24 * 60 * 60 * 1000);
  }, msUntil);
}