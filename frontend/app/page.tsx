'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { AnalysisTree } from '@/components/AnalysisTree';
import { GoBoard } from '@/components/GoBoard';
import { connect, send, ServerEvent } from '@/lib/ws';
import { AnalysisFrame, GameStatePayload } from '@/lib/types';

const EMPTY_STATE: GameStatePayload = {
  boardSize: 19,
  rules: 'japanese',
  komi: 6.5,
  handicap: 0,
  initialStones: [],
  moves: [],
  currentPlayer: 'B',
};

export default function Page() {
  const wsRef = useRef<WebSocket | null>(null);
  const logsRef = useRef<HTMLPreElement | null>(null);
  const rightRef = useRef<HTMLElement | null>(null);
  const [wsReady, setWsReady] = useState(false);

  const [state, setState] = useState<GameStatePayload>(EMPTY_STATE);
  const [liveFrame, setLiveFrame] = useState<AnalysisFrame | null>(null);
  const [framesByMove, setFramesByMove] = useState<Record<number, AnalysisFrame[]>>({});
  const [selectedMove, setSelectedMove] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [analysisTargetMove, setAnalysisTargetMove] = useState(0);
  const [hoveredRank, setHoveredRank] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const [boardSize, setBoardSize] = useState(19);
  const [rules, setRules] = useState('japanese');
  const [komi, setKomi] = useState(6.5);
  const [handicap, setHandicap] = useState(0);
  const [maxVisits, setMaxVisits] = useState(1200);

  useEffect(() => {
    const ws = connect((event: ServerEvent) => {
      if (event.type === 'game_state') {
        setState(event.payload);
        const moveNum = event.payload.moves.length;
        setSelectedMove(moveNum);
      }
      if (event.type === 'analysis_update') {
        setLiveFrame(event.payload);
        setFramesByMove((prev) => {
          const key = event.payload.moveNumber;
          const old = prev[key] ?? [];
          return { ...prev, [key]: [...old, event.payload].slice(-500) };
        });
      }
      if (event.type === 'analysis_status') {
        setAnalysisEnabled(event.payload.enabled);
        setAnalysisTargetMove(event.payload.targetMoveNumber);
      }
      if (event.type === 'analysis_history_snapshot') {
        setFramesByMove((prev) => ({ ...prev, [event.payload.moveNumber]: event.payload.frames }));
      }
      if (event.type === 'server_log') {
        setLogs((prev) => [...prev.slice(-150), event.payload.message]);
      }
      if (event.type === 'error') {
        setLastError(event.payload.message);
        setLogs((prev) => [...prev.slice(-150), `ERROR: ${event.payload.message}`]);
      }
    });

    ws.onopen = () => {
      setWsReady(true);
      setLogs((prev) => [...prev.slice(-150), 'WebSocket connected']);
    };
    ws.onclose = () => {
      setWsReady(false);
      setLogs((prev) => [...prev.slice(-150), 'WebSocket disconnected']);
    };
    ws.onerror = () => {
      setLogs((prev) => [...prev.slice(-150), 'WebSocket error']);
    };

    wsRef.current = ws;
    return () => ws.close();
  }, []);

  const selectedFrames = framesByMove[selectedMove] ?? [];
  const selectedFrame = useMemo(() => selectedFrames[selectedFrames.length - 1] ?? null, [selectedFrames]);
  const currentFrame = useMemo(() => (framesByMove[state.moves.length] ?? []).slice(-1)[0] ?? null, [framesByMove, state.moves.length]);
  const hoveredMove = selectedFrame?.moveInfos?.[hoveredRank] ?? null;
  const hoveredPv = hoveredMove ? [hoveredMove.move, ...(hoveredMove.pv ?? [])] : [];

  useEffect(() => {
    setHoveredRank(0);
  }, [selectedMove, selectedFrame?.timestamp]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (rightRef.current) {
      rightRef.current.scrollTop = rightRef.current.scrollHeight;
    }
  }, [selectedFrame?.timestamp, logs.length, state.moves.length, selectedMove]);

  const createGame = () => {
    setLastError(null);
    send(wsRef.current, {
      type: 'create_game',
      boardSize,
      rules,
      komi,
      handicap,
    });
  };

  const onUploadSgf = async (file: File) => {
    const sgf = await file.text();
    send(wsRef.current, { type: 'create_game', sgf });
  };

  const playMove = (x: number, y: number) => {
    send(wsRef.current, { type: 'play_move', x, y, player: state.currentPlayer });
  };

  const analyzeMoveNumber = (moveNumber: number) => {
    setLastError(null);
    send(wsRef.current, { type: 'start_analysis', maxVisits, moveNumber });
  };

  const playKataGoMoveFromSelected = () => {
    setLastError(null);
    send(wsRef.current, { type: 'play_katago_move', moveNumber: selectedMove, rank: hoveredRank });
  };

  const requestHistory = (moveNumber: number) => {
    setSelectedMove(moveNumber);
    send(wsRef.current, { type: 'get_analysis_history', moveNumber });
  };

  return (
    <main className="page">
      <section className="left">
        <div className="controls">
          <div className="group">
            <label title="Board dimensions for a new game.">Board size</label>
            <select title="Board dimensions for a new game." value={boardSize} onChange={(e) => setBoardSize(Number(e.target.value))}>
              <option value={19}>19x19</option>
              <option value={13}>13x13</option>
              <option value={9}>9x9</option>
            </select>
          </div>
          <div className="group">
            <label title="Scoring/ruleset sent to KataGo.">Rules</label>
            <select title="Scoring/ruleset sent to KataGo." value={rules} onChange={(e) => setRules(e.target.value)}>
              <option value="japanese">Japanese</option>
              <option value="chinese">Chinese</option>
              <option value="korean">Korean</option>
              <option value="aga">AGA</option>
            </select>
          </div>
          <div className="group">
            <label title="Komi for new game setup.">Komi</label>
            <input title="Komi for new game setup." type="number" step="0.5" value={komi} onChange={(e) => setKomi(Number(e.target.value))} />
          </div>
          <div className="group">
            <label title="Number of handicap stones (for new game).">Handicap</label>
            <input title="Number of handicap stones (for new game)." type="number" min={0} max={9} value={handicap} onChange={(e) => setHandicap(Number(e.target.value))} />
          </div>
        </div>

        <GoBoard state={state} frame={selectedFrame ?? liveFrame} hoveredPv={hoveredPv} onPlay={playMove} />
        <div className="statusBar">
          <span title="Global analysis mode. ON means auto-analysis after moves.">Analysis: {analysisEnabled ? 'ON' : 'OFF'}</span>
          <span title="Move number currently being analyzed by KataGo.">Target position: {analysisTargetMove}</span>
          <span title="Current board move number.">Current position: {state.moves.length}</span>
          <span title="Total root visits in latest frame.">Visits: {selectedFrame?.rootInfo?.visits ?? 0}</span>
          <span title="Winrate for side to move in latest frame.">Winrate: {(((selectedFrame?.rootInfo?.winrate ?? 0) * 100)).toFixed(1)}%</span>
          <span title="Score lead from latest frame (points).">Lead: {(selectedFrame?.rootInfo?.scoreLead ?? 0).toFixed(2)}</span>
          <span title="Whether KataGo is currently searching.">Search: {selectedFrame?.isDuringSearch ? 'running' : 'idle'}</span>
        </div>
        {lastError ? <div className="errorBanner">{lastError}</div> : null}
      </section>

      <section className="right" ref={rightRef} title="Правая панель: управление анализом, кандидаты, дерево вариантов и логи.">
        <div className="panel" title="Панель действий для партии и анализа.">
          <h2 title="Основные кнопки управления.">Controls</h2>
          <div className="rightControls">
            <button title="Create a new empty game using current settings." onClick={createGame} disabled={!wsReady}>New Game</button>
            <label title="Load an SGF and replace current game." className="upload buttonLike">
              Upload SGF
              <input
                type="file"
                accept=".sgf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadSgf(file);
                }}
              />
            </label>
            <button title="Remove last move from current line." onClick={() => send(wsRef.current, { type: 'undo_move' })} disabled={!wsReady}>Undo</button>
            <label title="Visit budget per analysis request." className="groupInline">
              Max visits
              <input
                title="Visit budget per analysis request."
                type="number"
                min={50}
                step={50}
                value={maxVisits}
                onChange={(e) => setMaxVisits(Number(e.target.value))}
              />
            </label>
            <button title="Analyze the current board position now." onClick={() => analyzeMoveNumber(state.moves.length)} disabled={!wsReady}>Analyze Current</button>
            <button title="Analyze selected position from move history." onClick={() => analyzeMoveNumber(selectedMove)} disabled={!wsReady}>Analyze Selected</button>
            <button title="Play KataGo suggested move at selected position." onClick={playKataGoMoveFromSelected} disabled={!wsReady}>KataGo Move Here</button>
            <button
              className="dangerButton"
              title="Stop current KataGo search immediately."
              onClick={() => send(wsRef.current, { type: 'stop_analysis' })}
              disabled={!wsReady}
            >
              Stop Thinking
            </button>
          </div>
        </div>

        <div className="panel" title="Выбор позиции по номеру хода для просмотра снимков анализа.">
          <h2 title="Список всех позиций текущей партии.">Move History</h2>
          <div className="list" title="Нажмите позицию, чтобы загрузить её историю анализа.">
            {Array.from({ length: state.moves.length + 1 }).map((_, i) => (
              <button title={`Show analysis snapshots for position ${i}.`} key={i} onClick={() => requestHistory(i)} className={selectedMove === i ? 'active' : ''}>
                Position {i}
              </button>
            ))}
          </div>
        </div>

        <div className="panel" title="Лучшие ходы от KataGo для выбранной позиции.">
          <h2 title="Таблица рекомендованных ходов.">Candidates</h2>
          <table title="Наведите на строку, чтобы выделить вариант на доске.">
            <thead>
              <tr>
                <th title="Candidate rank from KataGo (1 = best).">#</th>
                <th title="Move coordinate (GTP notation).">Move</th>
                <th title="Visit count for this candidate.">Visits</th>
                <th title="Search weight / utility from KataGo output.">Weight</th>
                <th title="Win probability for side to move.">Winrate</th>
                <th title="Estimated score lead in points.">Lead</th>
              </tr>
            </thead>
            <tbody>
              {(selectedFrame?.moveInfos ?? []).slice(0, 15).map((m) => (
                <tr
                  key={`${m.move}-${m.order}`}
                  onMouseEnter={() => setHoveredRank(m.order)}
                  className={hoveredRank === m.order ? 'rowHover' : ''}
                  title={`PV: ${[m.move, ...(m.pv ?? [])].slice(0, 8).join(' ')}`}
                >
                  <td title="Ранг кандидата.">{m.order + 1}</td>
                  <td title="Координата хода.">{m.move}</td>
                  <td title="Сколько симуляций пришлось на ход.">{m.visits}</td>
                  <td title="Внутренний вес кандидата в поиске.">{m.weight?.toFixed(2)}</td>
                  <td title="Оценка вероятности победы.">{(100 * (m.winrate ?? 0)).toFixed(1)}%</td>
                  <td title="Оценка лидерства в очках.">{m.scoreLead?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel" title="Дерево продолжений, построенное из principal variation.">
          <h2 title="Главные варианты из текущего анализа.">Variation Tree (from PV)</h2>
          <AnalysisTree frame={selectedFrame} />
        </div>

        <div className="panel" title="Служебные сообщения движка и соединения.">
          <h2 title="Логи backend/KataGo в реальном времени.">Engine Logs</h2>
          <div title="WebSocket state between browser and backend.">Socket: {wsReady ? 'connected' : 'disconnected'}</div>
          <div title="Whether current board position has a received analysis frame.">Live frame at current position: {currentFrame ? 'yes' : 'no'}</div>
          <pre ref={logsRef} title="Автопрокрутка до последней записи включена.">{logs.slice(-120).join('\n')}</pre>
        </div>
      </section>
    </main>
  );
}
