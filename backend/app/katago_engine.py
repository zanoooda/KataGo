from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from .types import GameState, Move

COLS = "ABCDEFGHJKLMNOPQRSTUVWX"


def xy_to_gtp(x: int, y: int, board_size: int) -> str:
    return f"{COLS[x]}{board_size - y}"


def move_to_katago(move: Move, board_size: int) -> list[str]:
    if move.is_pass:
        return [move.player, "pass"]
    assert move.x is not None and move.y is not None
    return [move.player, xy_to_gtp(move.x, move.y, board_size)]


@dataclass
class AnalysisRequest:
    max_visits: int
    report_every: float
    include_policy: bool = False
    include_ownership: bool = False
    include_moves_ownership: bool = False


class KataGoEngine:
    def __init__(self) -> None:
        self.binary = os.getenv("KATAGO_BINARY", "/opt/katago/katago")
        self.config = os.getenv("KATAGO_CONFIG", "/opt/katago/configs/analysis_example.cfg")
        self.model = os.getenv("KATAGO_MODEL", "/models/model.bin.gz")
        self.process: asyncio.subprocess.Process | None = None
        self.reader_task: asyncio.Task[None] | None = None
        self.log_task: asyncio.Task[None] | None = None
        self.on_update: Callable[[dict[str, Any]], Awaitable[None]] | None = None
        self.current_query_id: str | None = None

    async def start(self, on_update: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        if self.process is not None and self.process.returncode is None:
            self.on_update = on_update
            return
        if self.process is not None and self.process.returncode is not None:
            await self._cleanup_process_state()
        self.on_update = on_update
        self.process = await asyncio.create_subprocess_exec(
            self.binary,
            "analysis",
            "-config",
            self.config,
            "-model",
            self.model,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self.reader_task = asyncio.create_task(self._read_stdout())
        self.log_task = asyncio.create_task(self._read_stderr())

    async def stop(self) -> None:
        if self.process is None:
            await self._cleanup_process_state()
            return
        if self.reader_task:
            self.reader_task.cancel()
        if self.log_task:
            self.log_task.cancel()
        if self.process.returncode is None:
            try:
                self.process.terminate()
            except ProcessLookupError:
                pass
            try:
                await self.process.wait()
            except ProcessLookupError:
                pass
        await self._cleanup_process_state()

    async def terminate_current(self) -> None:
        if self.process is None or self.current_query_id is None:
            return
        try:
            # Modern KataGo requires every request to include a string "id".
            # Send both forms for compatibility across versions.
            await self._send(
                {
                    "id": f"terminate-{uuid.uuid4()}",
                    "action": "terminate",
                    "terminateId": self.current_query_id,
                }
            )
        except (RuntimeError, BrokenPipeError, ConnectionResetError):
            await self._cleanup_process_state()
        self.current_query_id = None

    async def analyze(self, state: GameState, req: AnalysisRequest) -> None:
        if self.process is None or self.process.returncode is not None:
            raise RuntimeError("KataGo process is not started")

        await self.terminate_current()
        self.current_query_id = f"query-{uuid.uuid4()}"

        payload = {
            "id": self.current_query_id,
            "boardXSize": state.board_size,
            "boardYSize": state.board_size,
            "rules": state.rules,
            "komi": state.komi,
            "initialStones": [move_to_katago(m, state.board_size) for m in state.initial_stones],
            "moves": [move_to_katago(m, state.board_size) for m in state.moves],
            "maxVisits": req.max_visits,
            "includePolicy": req.include_policy,
            "includeOwnership": req.include_ownership,
            "includeMovesOwnership": req.include_moves_ownership,
            "reportDuringSearchEvery": req.report_every,
        }
        await self._send(payload)

    async def _send(self, payload: dict[str, Any]) -> None:
        if self.process is None or self.process.stdin is None or self.process.returncode is not None:
            raise RuntimeError("KataGo stdin unavailable")
        self.process.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        await self.process.stdin.drain()

    async def _read_stdout(self) -> None:
        if self.process is None or self.process.stdout is None:
            return
        while True:
            line = await self.process.stdout.readline()
            if not line:
                if self.on_update:
                    await self.on_update({"type": "katago_log", "message": "KataGo stdout closed"})
                return
            try:
                data = json.loads(line.decode("utf-8", errors="ignore").strip())
            except json.JSONDecodeError:
                continue
            if self.on_update:
                await self.on_update(data)

    async def _read_stderr(self) -> None:
        if self.process is None or self.process.stderr is None:
            return
        while True:
            line = await self.process.stderr.readline()
            if not line:
                return
            msg = line.decode("utf-8", errors="ignore").strip()
            if msg and self.on_update:
                await self.on_update({"type": "katago_log", "message": msg})

    async def _cleanup_process_state(self) -> None:
        self.current_query_id = None
        self.process = None
        self.reader_task = None
        self.log_task = None
