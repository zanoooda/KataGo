from __future__ import annotations

from sgfmill import sgf

from .types import GameState, Move


HANDICAP_POINTS = {
    9: [(2, 6), (6, 2), (6, 6), (2, 2), (4, 4), (2, 4), (6, 4), (4, 2), (4, 6)],
    13: [(3, 9), (9, 3), (9, 9), (3, 3), (6, 6), (3, 6), (9, 6), (6, 3), (6, 9)],
    19: [(3, 15), (15, 3), (15, 15), (3, 3), (9, 9), (3, 9), (15, 9), (9, 3), (9, 15)],
}


def apply_handicap_stones(state: GameState, handicap: int) -> None:
    points = HANDICAP_POINTS.get(state.board_size, [])
    h = max(0, min(handicap, len(points)))
    state.handicap = h
    state.initial_stones = [Move(player="B", x=x, y=y) for x, y in points[:h]]
    state.current_player = "W" if h > 1 else "B"


def parse_sgf_to_state(content: str) -> GameState:
    game = sgf.Sgf_game.from_string(content)
    root = game.get_root()
    board_size = game.get_size()
    rules = str(root.get("RU") or "japanese").lower()
    komi = float(root.get("KM") or 6.5)
    handicap = int(root.get("HA") or 0)

    state = GameState(board_size=board_size, rules=rules, komi=komi)

    black_setup, white_setup, _ = root.get_setup_stones()
    for y, x in black_setup or []:
        state.initial_stones.append(Move(player="B", x=x, y=y))
    for y, x in white_setup or []:
        state.initial_stones.append(Move(player="W", x=x, y=y))

    if handicap > 0 and not state.initial_stones:
        apply_handicap_stones(state, handicap)

    for node in game.get_main_sequence()[1:]:
        color, move = node.get_move()
        if color is None:
            continue
        player = "B" if color.lower() == "b" else "W"
        if move is None:
            state.moves.append(Move(player=player, is_pass=True))
        else:
            y, x = move
            state.moves.append(Move(player=player, x=x, y=y))

    if state.moves:
        state.current_player = "W" if state.moves[-1].player == "B" else "B"

    return state
