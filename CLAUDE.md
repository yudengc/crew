# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Crew.App** — an Agent Team Orchestrator desktop application built with:
- **Backend**: WPF/.NET 7 (`Crew.App/`) — hosts a WebView2 control
- **Frontend**: React 19 + TypeScript + Vite (`crew-ui/`) — runs in WebView2
- **State**: Zustand store (`crew-ui/src/stores/appStore.ts`)
- **Storage**: JSON files in `%APPDATA%/CrewApp/`
- **Logging**: Serilog (logs in `%APPDATA%/CrewApp/logs/`)

The WPF backend and React frontend communicate via a `ClaireBridge` WebMessage API.

## Build & Run Commands

### Frontend (crew-ui)
```bash
cd crew-ui
npm run dev      # Dev server at http://localhost:5173
npm run build    # Production build → Crew.App/ui/
npm run lint     # ESLint
```

### Backend (Crew.App)
```bash
dotnet build    # Builds Crew.sln
dotnet run      # Run from solution root
```

The WPF app loads the React UI from `Crew.App/ui/index.html` in production, or `http://localhost:5173` in dev (when `ui/index.html` doesn't exist).

### Run Single Test
Tests are not yet present in this codebase.

## Architecture

### WPF ↔ React Bridge (`MainWindow.xaml.cs`)
The `OnWebMessageReceived` handler routes actions to services:
- `getAgents`, `saveAgent`, `deleteAgent`
- `getTeams`, `saveTeam`, `deleteTeam`
- `getTasks`, `saveTask`, `deleteTask`
- `getMarketplace`, `getSettings`, `saveSettings`
- `callAi` → `AiService` (Claude/OpenAI)
- `getChat`, `sendChatMessage`
- `publishAgent`, `unpublishAgent`, `getListing`

### Data Service (`DataService.cs`)
Handles JSON file CRUD for: `agents.json`, `teams.json`, `tasks.json`, `marketplace.json`, `settings.json`, `chats.json`, `listings.json`

### AI Service (`AiService.cs`)
Proxies LLM API calls to Claude (`api.anthropic.com/v1/messages`) or OpenAI (`api.openai.com/v1/chat/completions`).

### Frontend Views (`crew-ui/src/views/`)
- `Onboarding.tsx` — First-run setup
- `Marketplace.tsx` — Browse/buy agents
- `AgentFactory.tsx` — Create/edit agents
- `Teams.tsx` — Manage agent teams
- `TeamChat.tsx` — Chat with team members
- `TaskCenter.tsx` — Task assignment and tracking
- `Settings.tsx` — API keys and preferences

## Key Conventions
- All C# data models (Agent, Team, TaskItem, etc.) are in `DataService.cs`
- Frontend types mirror C# models in `crew-ui/src/types/index.ts`
- Bridge callbacks are registered via `window.ClaireBridge.onResult()` and `window.ClaireBridge.onError()`
- Default model: `claude-sonnet-4-20250514`