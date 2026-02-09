'use client';

import { AnalysisFrame, GameStatePayload } from '@/lib/types';

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWX';

function gtpToXY(move: string, size: number): { x: number; y: number } | null {
  const up = move.toUpperCase();
  if (up === 'PASS') return null;
  const col = COLS.indexOf(up[0]);
  const row = Number(up.slice(1));
  if (col < 0 || Number.isNaN(row)) return null;
  return { x: col, y: size - row };
}

function formatVisits(v: number): string {
  if (v >= 1000) {
    return `${(v / 1000).toFixed(1)}k`;
  }
  return String(v);
}

export function GoBoard({
  state,
  frame,
  hoveredPv,
  stonesOnly,
  interactionDisabled,
  onPlay,
}: {
  state: GameStatePayload;
  frame: AnalysisFrame | null;
  hoveredPv: string[];
  stonesOnly: boolean;
  interactionDisabled: boolean;
  onPlay: (x: number, y: number) => void;
}) {
  const px = 740;
  const padding = 28;
  const size = state.boardSize;
  const grid = (px - padding * 2) / (size - 1);

  const stones = [...state.initialStones, ...state.moves].filter((m) => !m.isPass);
  const occupied = new Set(stones.map((s) => `${s.x},${s.y}`));
  const lastPlayedMove = [...state.moves].reverse().find((m) => !m.isPass) ?? null;

  const rawCandidates = (frame?.moveInfos ?? []).slice(0, 14);
  const maxVisits = Math.max(1, ...rawCandidates.map((m) => m.visits || 0));
  const candidates = rawCandidates.flatMap((m) => {
    const xy = gtpToXY(m.move, size);
    if (!xy) return [];
    return [
      {
        ...xy,
        order: m.order + 1,
        visits: m.visits,
        scoreLead: m.scoreLead,
        winrate: m.winrate,
        ratio: Math.max(0.35, Math.min(1, Math.sqrt((m.visits || 0) / maxVisits))),
      },
    ];
  });
  const pvMarkers = hoveredPv
    .slice(0, 12)
    .map((move, i) => ({ move, i }))
    .flatMap(({ move, i }) => {
      const xy = gtpToXY(move, size);
      if (!xy) return [];
      return [{ ...xy, index: i + 1 }];
    });

  return (
    <div className="boardShell">
      <div className="board" style={{ width: px, height: px }}>
        {!stonesOnly ? (
          <div className="boardLegend">
            <span><i className="legend best" /> Best move</span>
            <span><i className="legend alt" /> Alternatives</span>
            <span><i className="legend pv" /> PV hover</span>
            <span><i className="legend last" /> Last played</span>
          </div>
        ) : null}
        {Array.from({ length: size }).map((_, i) => (
          <div
            key={`h-${i}`}
            className="line"
            style={{ left: padding, top: padding + i * grid, width: px - 2 * padding, height: 1 }}
          />
        ))}
        {Array.from({ length: size }).map((_, i) => (
          <div
            key={`v-${i}`}
            className="line"
            style={{ left: padding + i * grid, top: padding, width: 1, height: px - 2 * padding }}
          />
        ))}

        {stones.map((s, i) => (
          <div
            key={`stone-${i}`}
            className={`stone ${s.player === 'B' ? 'black' : 'white'}`}
            style={{
              left: padding + (s.x as number) * grid - grid * 0.45,
              top: padding + (s.y as number) * grid - grid * 0.45,
              width: grid * 0.9,
              height: grid * 0.9,
            }}
          >
            {!stonesOnly ? <span className="stoneLabel">{i >= state.initialStones.length ? i - state.initialStones.length + 1 : ''}</span> : null}
          </div>
        ))}

        {!stonesOnly && lastPlayedMove ? (
          <div
            className="lastMoveMark"
            style={{
              left: padding + (lastPlayedMove.x as number) * grid - grid * 0.2,
              top: padding + (lastPlayedMove.y as number) * grid - grid * 0.2,
              width: grid * 0.4,
              height: grid * 0.4,
            }}
          />
        ) : null}

        {!stonesOnly
          ? candidates.map((c, i) => (
              <div
                key={`cand-${i}`}
                className={`candidate candidateRank${Math.min(c.order, 5)}`}
                style={{
                  left: padding + c.x * grid - grid * (0.25 + c.ratio * 0.47),
                  top: padding + c.y * grid - grid * (0.25 + c.ratio * 0.47),
                  width: grid * (0.5 + c.ratio * 0.94),
                  height: grid * (0.5 + c.ratio * 0.94),
                }}
                title={`#${c.order} | Visits ${c.visits} | Lead ${c.scoreLead.toFixed(2)} | Winrate ${(c.winrate * 100).toFixed(1)}%`}
              >
                <b>{c.order}</b>
                <small>{c.scoreLead >= 0 ? `+${c.scoreLead.toFixed(1)}` : c.scoreLead.toFixed(1)}</small>
                <small>{formatVisits(c.visits)}</small>
              </div>
            ))
          : null}

        {!stonesOnly
          ? pvMarkers.map((m, i) => (
              <div
                key={`pv-${i}`}
                className="pvMarker"
                style={{
                  left: padding + m.x * grid - grid * 0.28,
                  top: padding + m.y * grid - grid * 0.28,
                  width: grid * 0.56,
                  height: grid * 0.56,
                }}
              >
                {m.index}
              </div>
            ))
          : null}

        {Array.from({ length: size * size }).map((_, idx) => {
          const x = idx % size;
          const y = Math.floor(idx / size);
          if (occupied.has(`${x},${y}`)) return null;
          return (
            <button
              key={`hit-${idx}`}
              className="hit"
              title={interactionDisabled ? 'Disabled while analysis is running.' : 'Play move'}
              style={{
                left: padding + x * grid - grid * 0.5,
                top: padding + y * grid - grid * 0.5,
                width: grid,
                height: grid,
              }}
              disabled={interactionDisabled}
              onClick={() => onPlay(x, y)}
            />
          );
        })}
      </div>
    </div>
  );
}
