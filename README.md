<div align="center">

```
 ·  M E R I D I A N  ·
```

**Priority-scored project command centre.**
Local-first. AI-powered. Yours forever.

[![Made with React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=white&labelColor=20232a)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=1e293b)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?style=flat-square&logo=vite&logoColor=white&labelColor=1e1e2e)](https://vitejs.dev)
[![Electron](https://img.shields.io/badge/Electron-Desktop-47848f?style=flat-square&logo=electron&logoColor=white&labelColor=1a1a2e)](https://electronjs.org)
[![Ollama](https://img.shields.io/badge/AI-Ollama-ff6b35?style=flat-square&logoColor=white&labelColor=1a1a1a)](https://ollama.com)

</div>

---

> Meridian is a **local desktop app** for builders, developers, and creatives who want to track their projects with intelligence - not noise. Every project gets a live priority score. Every decision has context. Nothing ever leaves your machine.

---

## ✦ What is Meridian?

Most project trackers show you everything equally. Meridian doesn't.

It scores every project across **impact, effort, energy, confidence, and deadline urgency** - then ranks them in real time. Open Meridian on a Monday morning and you already know exactly what to work on. The AI advisor (running locally via Ollama) has your full project context and gives direct, actionable answers.

**Built for people who have too many things going on and need signal, not more noise.**

---

## ✦ Features

### Core
|                             |                                                                                  |
|-----------------------------|----------------------------------------------------------------------------------|
| **Priority scoring engine** | Every project scored across 5 axes. Updated live.                                |
| **Priority decay**          | Scores drop if you haven't touched a project. A decay bar shows staleness.       |
| **Per-project colours**     | Each project gets its own colour - runs through everything.                      |
| **Focus Mode**              | Full-screen single-project view with a built-in Pomodoro timer. Sessions logged. |
| **Dependency graph**        | Link projects as blockers. Score penalties propagate automatically.              |

### Views
|                  |                                                                                    |
|------------------|------------------------------------------------------------------------------------|
| **Dashboard**    | Live-scored cards, velocity sparklines, top priority strip.                        |
| **Kanban**       | Fully customisable - rename, recolour, add/remove columns, drag cards, WIP limits. |
| **Timeline**     | Gantt-style deadline view. Collision warnings. Today line.                         |
| **Tags**         | First-class tag filtering, tag cloud, cross-project velocity chart.                |
| **Dependencies** | Canvas-rendered force graph of project relationships.                              |
| **Weekly Review**| Monday prompt, shipped/blocked checklist, AI summary, review history.              |
| **AI Advisor**   | Asks your local Ollama model questions about your actual live project data.        |

### Polish
- `Cmd+K` / `Ctrl+K` command palette - search projects, jump to views, run actions
- 6 accent palettes × 3 typography styles × 3 density levels × 4 surface textures
- Markdown export for any project
- GitHub Issues sync - import open issues as tasks
- Daily digest notification - top 3 priorities at 9am
- 6 project templates - Open Source Launch, Freelance Client, Learning Sprint, and more
- Import / Export JSON - full workspace backup

---

## ✦ Quick start

### Option A - Desktop app (no VS Code needed)

**Requirements:** [Node.js](https://nodejs.org) (v18 or later) - that's it.

```bash
# 1. Clone or download the repo
git clone https://github.com/YOUR_USERNAME/meridian
cd meridian

# 2. Install dependencies
npm install

# 3. Run as a desktop app
npm run electron:dev
```

Meridian opens as a native window. No browser needed.

---

### Option B - Browser (classic dev mode)

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

---

### Option C - Build a distributable (share with anyone)

```bash
# Build for your current platform
npm run electron:build

# Or target a specific platform
npm run electron:build:win      # Windows .exe installer
npm run electron:build:mac      # macOS .dmg
npm run electron:build:linux    # Linux .AppImage
```

The output lands in `/release`. Share the installer - recipients need nothing else installed.

---

## ✦ AI setup (optional but recommended)

Meridian uses **Ollama** - a free, local AI runtime. Your data never leaves your machine.

**1. Install Ollama**

Download from **[ollama.com](https://ollama.com)** - available for Mac, Windows, and Linux. Run the installer. Ollama starts automatically in the background.

**2. Pull a model**

Open a terminal and run:

```bash
ollama pull llama3.2
```

This downloads the Llama 3.2 model (~2GB, once only). Verify with:

```bash
ollama list
```

**3. Connect in Meridian**

Open Meridian → **AI Advisor** → hit **Check status**. If Ollama is running you'll see green. Start asking questions - the AI reads your live project data.

**Other models you can use:**

```bash
ollama pull mistral       # Great for reasoning
ollama pull gemma2        # Fast and capable
ollama pull phi3          # Very lightweight
ollama pull codellama     # Good if you track code projects
```

Change the model in **Settings → Integrations** or directly in the AI Advisor panel.

---

## ✦ How the scoring works

Every project is scored 0–100 based on:

| Factor         | Weight   | Description                                      |
|----------------|----------|--------------------------------------------------|
| **Impact**     | High     | How much does shipping this move things forward? |
| **Energy**     | Medium   | How motivated are you to work on it right now?   |
| **Confidence** | Medium   | How clearly defined is the path to done?         |
| **Effort**     | Negative | How much work is it? High effort reduces score.  |
| **Urgency**    | Variable | Days to deadline. Overdue = max urgency.         |

**Modifiers that reduce score:**
- **Decay** - -2pts per day past your inactivity threshold (default 7 days)
- **Blocked** - -15pts per unshipped dependency

The score updates every time you open a project, check off a task, or the date changes.

---

## ✦ Keyboard shortcuts

| Shortcut           | Action                |
|--------------------|----------------------=|
| `Cmd+K` / `Ctrl+K` | Open command palette  |
| `↑` `↓` in palette | Navigate results      |
| `Enter` in palette | Open selected         |
| `Esc`              | Close palette / modal |

---

## ✦ Project structure

```
meridian/
├── electron/
│   ├── main.cjs          # Electron main process
│   └── preload.cjs       # Secure context bridge
├── src/
│   ├── App.tsx           # Main React application
│   ├── types.ts          # TypeScript interfaces
│   ├── data.ts           # Seed data & defaults
│   ├── utils.ts          # Scoring, AI, helpers
│   ├── themes.ts         # Theme system (4 axes)
│   └── styles.css        # All styles
├── public/
│   └── icon.png          # App icon
├── package.json          # Scripts + Electron build config
└── vite.config.ts        # Vite + Electron base path
```

---

## ✦ Customisation

**Change the colour palette** - edit `PROJECT_COLORS` in `src/data.ts`

**Change default Kanban columns** - edit `DEFAULT_KANBAN_COLUMNS` in `src/data.ts`

**Add project templates** - add entries to `PROJECT_TEMPLATES` in `src/utils.ts`

**Change decay rate** - the default is -2pts/day after 7 days of inactivity. Edit `decayPenaltyFor()` in `src/utils.ts`

---

## ✦ Tech stack

| Layer        | Technology                                       |
|--------------|--------------------------------------------------|
| UI framework | React 18 + TypeScript                            |
| Build tool   | Vite 5                                           | 
| Desktop shell| Electron                                         |
| AI runtime   | Ollama (local)                                   |
| Persistence  | localStorage (local-first)                       |
| Styling      | Pure CSS with custom properties                  |
| Fonts        | DM Serif Display, DM Mono, Inter, Dancing Script |

No database. No backend. No cloud. No subscription. No tracking.

---

## ✦ Contributing

Contributions welcome. Open an issue first for anything significant.

```bash
git clone https://github.com/YOUR_USERNAME/meridian
cd meridian
npm install
npm run dev
```

---

## ✦ Download

> Don't want to run from source? Download the latest installer directly.

**[→ Latest Release](https://github.com/MA-V4/meridian/releases/latest)**

| Platform | Download         |
|----------|------------------|
| Windows  | `.exe` installer |
| macOS    | `.dmg`           |
| Linux    | `.AppImage`      |

No terminal needed. Download, install, open.

---

## ✦ Licence

Copyright © 2026 Mihran Ali.

This project is **source-available** - you can view the code and use it for personal, non-commercial purposes. You may not redistribute it, sell it, or use it commercially without written permission.

See the full [LICENCE](./LICENCE) file for details.

**Want to use Meridian commercially or integrate it into a product?**
Get in touch at [mihranali.vercel.app](https://mihranali.vercel.app).

---

<div align="center">

Built with care by [Mihran Ali](https://mihranali.vercel.app)

*"The right project at the right time."*

</div>