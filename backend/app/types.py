from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Move:
    player: str
    x: int | None = None
    y: int | None = None
    is_pass: bool = False


@dataclass
class GameState:
    board_size: int = 19
    rules: str = "japanese"
    komi: float = 6.5
    handicap: int = 0
    initial_stones: list[Move] = field(default_factory=list)
    moves: list[Move] = field(default_factory=list)
    current_player: str = "B"

    def to_payload(self) -> dict[str, Any]:
        return {
            "boardSize": self.board_size,
            "rules": self.rules,
            "komi": self.komi,
            "handicap": self.handicap,
            "initialStones": [
                {"player": m.player, "x": m.x, "y": m.y, "isPass": m.is_pass}
                for m in self.initial_stones
            ],
            "moves": [
                {"player": m.player, "x": m.x, "y": m.y, "isPass": m.is_pass}
                for m in self.moves
            ],
            "currentPlayer": self.current_player,
        }
