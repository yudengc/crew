# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Crew.App** — an Agent Team Orchestrator desktop application built with:
- **Backend**: WPF/.NET 7 (`Crew.App/`) — hosts a WebView2 control
- **Frontend**: React 19 + TypeScript + Vite (`crew-ui/`) — runs in WebView2
- **State**: Zustand store (`crew-ui/src/stores/appStore.ts`)
- **Styling**: Tailwind CSS 4
- **Storage**: JSON files in `%APPDATA%/CrewApp/`
- **Logging**: Serilog (logs in `%APPDATA%/CrewApp/logs/`)

The WPF backend and React frontend communicate via a `ClaireBridge` WebMessage API.
The React app can also run standalone in a browser without the WPF backend — `bridge.ts` provides a mock bridge with in-memory data for development.

## Development Plan & Progress

### Phase 1: Stability & Data Security ✅ COMPLETED
- [x] Concurrent file I/O data corruption fix (SemaphoreSlim + atomic writes)
- [x] HttpClient thread safety (per-request HttpRequestMessage)
- [x] anthropic-version header
- [x] Sub-task AI errors properly surfaced
- [x] TaskCenter polling uses `getState()` to avoid stale closures

### Phase 2: Core Engine Upgrade ✅ COMPLETED
- [x] **Agent Loop (ReAct Pattern)**: Tool calling loop with max 15 iterations. Claude Tool Use + OpenAI Function Calling support.
- [x] **SSE Streaming**: Claude + OpenAI SSE parsing. Real-time push via PostWebMessageAsJson.
- [x] **Cancellation**: Full CancellationToken chain from UI → bridge → backend.
- [x] **Retry with Exponential Backoff**: 429/5xx → 1s→2s→4s→8s retry. ApiException class.
- [x] **Tool Registry**: 5 standard tools (read_file, write_file, list_files, web_search, execute_command). Sandboxed with path safety.
- [x] **Bridge Protocol**: Promise-based request/response with PostWebMessageAsJson. ClaireBridge injected via HTTP server.

### Phase 3: Memory System L0-L3 ⬜ PENDING
- [ ] L0: Session cache
- [ ] L1: Context compression (every 5 rounds)
- [ ] L2: LanceDB vector memory
- [ ] L3: Knowledge graph rules

### Phase 4: Frontend Experience ✅ MOSTLY COMPLETE
- [x] Toast notifications (sonner)
- [x] Confirm dialog (custom modal)
- [x] Error boundary
- [x] Loading & empty states
- [x] TeamChat real-time streaming with cancel
- [x] TaskCenter mock orchestration pipeline
- [x] White/light theme with Tailwind CSS v4

### Phase 5: Computer Use ⬜ PENDING
### Phase 6: Marketplace & Publishing ⬜ PENDING
### Phase 7: App Packaging ⬜ PENDING

## Known Issues (Desktop WebView2)
- Bridge deserialization: `BridgeRequest.Data` field conflict when bridge sends object vs string. Fix in progress — bridge JS now flattens streamId to top level and passes data as JSON string.
- Desktop app shows white screen (JS deserialization error blocks bridge). Browser dev mode works fully.

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
- `executeTaskOrchestrated` → `OrchestrationService`

### Data Service (`DataService.cs`)
Handles JSON file CRUD for: `agents.json`, `teams.json`, `tasks.json`, `marketplace.json`, `settings.json`, `chats.json`, `listings.json`

### AI Service (`AiService.cs`)
Proxies LLM API calls to Claude (`api.anthropic.com/v1/messages`) or OpenAI (`api.openai.com/v1/chat/completions`).
Also defines `AiRequest` and `AppSettings` classes used throughout the backend.

### Orchestration Service (`OrchestrationService.cs`)
Handles `executeTaskOrchestrated` — a 3-phase AI-powered pipeline for team task execution:
1. **Decompose** — AI manager agent breaks the task into sub-tasks assigned to specific team members
2. **Execute** — all sub-tasks run in parallel (each agent works on its assigned sub-task with its own model/config)
3. **Synthesize** — the manager agent combines all sub-task results into a final output

Progress is persisted to `tasks.json` after each phase, so the frontend can track `phase` transitions (`idle → decomposing → executing → synthesizing → completed`).

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
- Vite `base: './'` is required for the WebView2 `file://` protocol to resolve assets correctly
- Tailwind CSS 4 is used for all styling (no CSS modules or styled-components)