from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .katago_engine import AnalysisRequest, KataGoEngine
from .sgf_utils import apply_handicap_stones, parse_sgf_to_state
from .types import GameState, Move

app = FastAPI(title="KataGo Realtime Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


COLS = "ABCDEFGHJKLMNOPQRSTUVWX"


def gtp_to_xy(move: str, board_size: int) -> tuple[int, int] | None:
    up = move.upper()
    if up == "PASS":
        return None
    col = COLS.find(up[0])
    if col < 0:
        return None
    try:
        row = int(up[1:])
    except ValueError:
        return None
    y = board_size - row
    return col, y


class Session:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.state = GameState()
        self.engine = KataGoEngine()
        self.enabled = True
        self.max_visits = 1200
        self.frames_by_move: dict[int, list[dict[str, Any]]] = defaultdict(list)
        self.lock = asyncio.Lock()
        self.analysis_target_move = 0

    async def send(self, payload: dict[str, Any]) -> None:
        await self.ws.send_text(json.dumps(payload))

    async def start(self) -> None:
        await self.send({"type": "game_state", "payload": self.state.to_payload()})
        await self.send(
            {
                "type": "analysis_status",
                "payload": {
                    "enabled": self.enabled,
                    "targetMoveNumber": self.analysis_target_move,
                    "maxVisits": self.max_visits,
                },
            }
        )
        if self.enabled:
            await self.start_analysis(move_number=len(self.state.moves))

    async def stop(self) -> None:
        try:
            await self.engine.stop()
        except Exception:
            # Avoid crashing websocket finalizer on already-dead process cleanup.
            pass

    def _state_for_move_number(self, move_number: int) -> GameState:
        total = len(self.state.moves)
        target = max(0, min(move_number, total))
        steps_back = total - target
        current_player = self.state.current_player
        if steps_back % 2 == 1:
            current_player = "W" if current_player == "B" else "B"
        return GameState(
            board_size=self.state.board_size,
            rules=self.state.rules,
            komi=self.state.komi,
            handicap=self.state.handicap,
            initial_stones=list(self.state.initial_stones),
            moves=list(self.state.moves[:target]),
            current_player=current_player,
        )

    async def create_game(self, msg: dict[str, Any]) -> None:
        sgf = msg.get("sgf")
        if isinstance(sgf, str) and sgf.strip():
            self.state = parse_sgf_to_state(sgf)
        else:
            self.state = GameState(
                board_size=int(msg.get("boardSize", 19)),
                rules=str(msg.get("rules", "japanese")).lower(),
                komi=float(msg.get("komi", 6.5)),
            )
            handicap = int(msg.get("handicap", 0))
            if handicap > 0:
                apply_handicap_stones(self.state, handicap)

        self.frames_by_move = defaultdict(list)
        await self.send({"type": "game_state", "payload": self.state.to_payload()})
        if self.enabled:
            await self.start_analysis(move_number=len(self.state.moves))

    async def play_move(self, msg: dict[str, Any]) -> None:
        move = Move(
            player=str(msg.get("player", self.state.current_player)).upper(),
            x=msg.get("x"),
            y=msg.get("y"),
            is_pass=bool(msg.get("isPass", False)),
        )
        self.state.moves.append(move)
        self.state.current_player = "W" if move.player == "B" else "B"
        await self.send({"type": "game_state", "payload": self.state.to_payload()})
        if self.enabled:
            await self.start_analysis(move_number=len(self.state.moves))

    async def undo(self) -> None:
        if not self.state.moves:
            return
        self.state.moves.pop()
        self.state.current_player = "W" if len(self.state.moves) % 2 == 1 else "B"
        await self.send({"type": "game_state", "payload": self.state.to_payload()})
        if self.enabled:
            await self.start_analysis(move_number=len(self.state.moves))

    async def start_analysis(self, max_visits: int | None = None, move_number: int | None = None) -> None:
        if max_visits is not None:
            self.max_visits = max(50, int(max_visits))
        target_move = len(self.state.moves) if move_number is None else int(move_number)
        target_state = self._state_for_move_number(target_move)
        self.analysis_target_move = len(target_state.moves)
        try:
            await self.engine.start(self._on_katago_update)
            await self.engine.analyze(target_state, AnalysisRequest(max_visits=self.max_visits, report_every=0.15))
            self.enabled = True
            await self.send(
                {
                    "type": "analysis_status",
                    "payload": {
                        "enabled": True,
                        "targetMoveNumber": self.analysis_target_move,
                        "maxVisits": self.max_visits,
                    },
                }
            )
        except FileNotFoundError:
            self.enabled = False
            await self.send(
                {
                    "type": "error",
                    "payload": {
                        "message": "KataGo binary not found. Expected at KATAGO_BINARY path.",
                    },
                }
            )
        except PermissionError:
            self.enabled = False
            await self.send(
                {
                    "type": "error",
                    "payload": {
                        "message": (
                            "KataGo binary is not executable. Run: chmod +x katago/katago "
                            "on the host, then restart containers."
                        ),
                    },
                }
            )
        except OSError as exc:
            self.enabled = False
            await self.send(
                {
                    "type": "error",
                    "payload": {
                        "message": f"Failed to start KataGo: {exc}",
                    },
                }
            )
        except RuntimeError as exc:
            self.enabled = False
            await self.send(
                {
                    "type": "error",
                    "payload": {
                        "message": f"KataGo process is not available: {exc}",
                    },
                }
            )

    async def stop_analysis(self) -> None:
        self.enabled = False
        await self.engine.terminate_current()
        await self.send(
            {
                "type": "analysis_status",
                "payload": {
                    "enabled": False,
                    "targetMoveNumber": self.analysis_target_move,
                    "maxVisits": self.max_visits,
                },
            }
        )

    async def send_history(self, move_number: int) -> None:
        await self.send(
            {
                "type": "analysis_history_snapshot",
                "payload": {
                    "moveNumber": move_number,
                    "frames": self.frames_by_move.get(move_number, []),
                },
            }
        )

    async def play_katago_move(self, move_number: int, rank: int = 0) -> None:
        target = max(0, min(move_number, len(self.state.moves)))
        frames = self.frames_by_move.get(target, [])
        if not frames:
            await self.send(
                {
                    "type": "error",
                    "payload": {
                        "message": (
                            f"No analysis for position {target}. Run analysis on this position first."
                        ),
                    },
                }
            )
            return

        frame = frames[-1]
        move_infos = frame.get("moveInfos", [])
        if not move_infos or rank < 0 or rank >= len(move_infos):
            await self.send(
                {
                    "type": "error",
                    "payload": {"message": "No candidate move found in current analysis frame."},
                }
            )
            return

        best = move_infos[rank]
        move_str = str(best.get("move", ""))
        xy = gtp_to_xy(move_str, self.state.board_size)
        player = self._state_for_move_number(target).current_player

        # Jump to selected position, then play KataGo suggestion from there.
        self.state.moves = list(self.state.moves[:target])
        if xy is None:
            self.state.moves.append(Move(player=player, is_pass=True))
        else:
            x, y = xy
            self.state.moves.append(Move(player=player, x=x, y=y, is_pass=False))
        self.state.current_player = "W" if player == "B" else "B"

        await self.send({"type": "game_state", "payload": self.state.to_payload()})
        if self.enabled:
            await self.start_analysis(move_number=len(self.state.moves))

    async def _on_katago_update(self, data: dict[str, Any]) -> None:
        if data.get("type") == "katago_log":
            await self.send({"type": "server_log", "payload": data})
            return
        if data.get("error"):
            await self.send(
                {
                    "type": "error",
                    "payload": {"message": f"KataGo error: {data.get('error')}"},
                }
            )
            return

        move_number = self.analysis_target_move
        frame = {
            "timestamp": time.time(),
            "moveNumber": move_number,
            "isDuringSearch": bool(data.get("isDuringSearch", False)),
            "rootInfo": data.get("rootInfo", {}),
            "moveInfos": data.get("moveInfos", []),
            "ownership": data.get("ownership", []),
            "policy": data.get("policy", []),
        }

        self.frames_by_move[move_number].append(frame)
        if len(self.frames_by_move[move_number]) > 500:
            self.frames_by_move[move_number] = self.frames_by_move[move_number][-500:]

        await self.send({"type": "analysis_update", "payload": frame})

        if not frame["isDuringSearch"]:
            await self.send_history(move_number)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/game")
async def ws_game(ws: WebSocket) -> None:
    await ws.accept()
    session = Session(ws)
    await session.start()

    try:
        while True:
            msg = json.loads(await ws.receive_text())
            msg_type = msg.get("type")
            async with session.lock:
                if msg_type == "create_game":
                    await session.create_game(msg)
                elif msg_type == "play_move":
                    await session.play_move(msg)
                elif msg_type == "undo_move":
                    await session.undo()
                elif msg_type == "start_analysis":
                    await session.start_analysis(msg.get("maxVisits"), msg.get("moveNumber"))
                elif msg_type == "stop_analysis":
                    await session.stop_analysis()
                elif msg_type == "get_analysis_history":
                    await session.send_history(int(msg.get("moveNumber", len(session.state.moves))))
                elif msg_type == "play_katago_move":
                    await session.play_katago_move(
                        int(msg.get("moveNumber", len(session.state.moves))),
                        int(msg.get("rank", 0)),
                    )
                else:
                    await session.send({"type": "error", "payload": {"message": f"Unknown type: {msg_type}"}})
    except WebSocketDisconnect:
        pass
    finally:
        await session.stop()
