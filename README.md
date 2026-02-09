# KataGo Live Analysis (Next.js + Python + Docker)

Realtime Go review app with:
- SGF upload or new empty game setup
- Rules, komi, handicap options
- Live KataGo thinking stream over WebSocket
- Candidate moves with visits/weight/winrate/score lead
- Move history and per-position analysis snapshots
- Variation tree built from KataGo PV lines

## Stack
- Frontend: Next.js (React)
- Backend: FastAPI + WebSocket
- Engine: KataGo `analysis` mode
- Runtime: Docker Compose

## Project Layout
- `frontend/` Next.js client
- `backend/` Python websocket server
- `docker-compose.yml` service orchestration
- `infra/assets/` containerized downloader for KataGo binary and model
- `configs/analysis_example.cfg` KataGo analysis config

## Requirements
1. Docker + Docker Compose
2. Internet access from containers (for first startup download)

## Run
```bash
docker compose up --build
```

This compose file includes an internal `gateway` (nginx):
- `gateway` publishes host port `80`
- `frontend` and `backend` stay internal (`expose` only)
- `assets-init` downloads latest KataGo + model into Docker volumes
- routing:
  - `/` -> `frontend:80`
  - `/api/` -> `backend:8000`
  - `/api/ws/game` -> `backend:8000/ws/game` (WebSocket upgrade)

Backend container mounts:
- `katago_data` volume -> `/opt/katago` (contains `/opt/katago/katago`)
- `model_data` volume -> `/models` (contains `/models/model.bin.gz`)
- `./configs` -> `/configs` (uses `/configs/analysis_example.cfg`)

Frontend WebSocket uses same-host path by default: `/api/ws/game`.

## WebSocket API
Public endpoint (through reverse proxy): `/api/ws/game`
Internal backend endpoint: `/ws/game`

Client -> Server message types:
- `create_game` with either:
  - `{ type: "create_game", sgf: "(...)" }`
  - `{ type: "create_game", boardSize, rules, komi, handicap }`
- `play_move` `{ type: "play_move", x, y, player }`
- `undo_move` `{ type: "undo_move" }`
- `start_analysis` `{ type: "start_analysis", maxVisits }`
- `stop_analysis` `{ type: "stop_analysis" }`
- `get_analysis_history` `{ type: "get_analysis_history", moveNumber }`

Server -> Client message types:
- `game_state`
- `analysis_update`
- `analysis_history_snapshot`
- `server_log`
- `error`

## Notes
- This app streams raw-ish KataGo analysis fields (`rootInfo`, `moveInfos`, `policy`, `ownership`) in near realtime.
- If you want stronger accuracy or speed, tune `configs/analysis_example.cfg` and model quality.

## Troubleshooting
- Re-download latest engine/model:
  - `docker compose run --rm -e FORCE_UPDATE=1 assets-init`
  - `docker compose up --build`
