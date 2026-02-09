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
  const [stonesOnly, setStonesOnly] = useState(false);

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
  const isAnalysisRunning = Boolean(
    liveFrame?.isDuringSearch ||
      currentFrame?.isDuringSearch ||
      (selectedMove === analysisTargetMove && selectedFrame?.isDuringSearch)
  );
  const hasSelectedAnalysis = Boolean(
    selectedFrame && selectedFrame.moveNumber === selectedMove && (selectedFrame.moveInfos?.length ?? 0) > 0
  );
  const canMutateGame = wsReady && !isAnalysisRunning;
  const canRunAnalysis = wsReady && !isAnalysisRunning;
  const canSelectPosition = wsReady && !isAnalysisRunning;
  const canPlayKataGoMove = wsReady && !isAnalysisRunning && hasSelectedAnalysis;
  const canPlayOnBoard = wsReady && !isAnalysisRunning;
  const blockedByAnalysisHint = 'Disabled while analysis is running. Wait for completion or click Stop Analysis.';
  const missingAnalysisHint = 'Run analysis first for the selected position, then play KataGo move.';
  const analysisStateMessage = isAnalysisRunning
    ? `Analyzing position ${analysisTargetMove}...`
    : hasSelectedAnalysis
      ? `Analysis is ready for position ${selectedMove}. Hover candidates and play a move.`
      : `No analysis for position ${selectedMove} yet. Click Analyze Selected.`;

  useEffect(() => {
    setHoveredRank(0);
  }, [selectedMove, selectedFrame?.timestamp]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

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
    if (!canPlayOnBoard) return;
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
    if (!canSelectPosition) return;
    setSelectedMove(moveNumber);
    send(wsRef.current, { type: 'get_analysis_history', moveNumber });
  };

  return (
    <main className="page">
      <section className="left">
        <div className="controls">
          <div className="group">
            <label title="Board dimensions for a new game.">Board size</label>
            <select
              title={canMutateGame ? 'Board dimensions for a new game.' : blockedByAnalysisHint}
              value={boardSize}
              onChange={(e) => setBoardSize(Number(e.target.value))}
              disabled={!canMutateGame}
            >
              <option value={19}>19x19</option>
              <option value={13}>13x13</option>
              <option value={9}>9x9</option>
            </select>
          </div>
          <div className="group">
            <label title="Scoring/ruleset sent to KataGo.">Rules</label>
            <select
              title={canMutateGame ? 'Scoring/ruleset sent to KataGo.' : blockedByAnalysisHint}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              disabled={!canMutateGame}
            >
              <option value="japanese">Japanese</option>
              <option value="chinese">Chinese</option>
              <option value="korean">Korean</option>
              <option value="aga">AGA</option>
            </select>
          </div>
          <div className="group">
            <label title="Komi for new game setup.">Komi</label>
            <input
              title={canMutateGame ? 'Komi for new game setup.' : blockedByAnalysisHint}
              type="number"
              step="0.5"
              value={komi}
              onChange={(e) => setKomi(Number(e.target.value))}
              disabled={!canMutateGame}
            />
          </div>
          <div className="group">
            <label title="Number of handicap stones (for new game).">Handicap</label>
            <input
              title={canMutateGame ? 'Number of handicap stones (for new game).' : blockedByAnalysisHint}
              type="number"
              min={0}
              max={9}
              value={handicap}
              onChange={(e) => setHandicap(Number(e.target.value))}
              disabled={!canMutateGame}
            />
          </div>
        </div>

        <div className="boardActions">
          <button
            className={stonesOnly ? 'activeToggle' : ''}
            title="Show only stones on the board, without labels and overlays."
            onClick={() => setStonesOnly((v) => !v)}
          >
            {stonesOnly ? 'Show Overlays' : 'Stones Only'}
          </button>
        </div>

        <GoBoard
          state={state}
          frame={selectedFrame ?? liveFrame}
          hoveredPv={hoveredPv}
          stonesOnly={stonesOnly}
          interactionDisabled={!canPlayOnBoard}
          onPlay={playMove}
        />
        {!stonesOnly ? (
          <div className="statusBar">
            <span title="Global analysis mode. ON means auto-analysis after moves.">Analysis: {analysisEnabled ? 'ON' : 'OFF'}</span>
            <span title="Move number currently being analyzed by KataGo.">Target position: {analysisTargetMove}</span>
            <span title="Current board move number.">Current position: {state.moves.length}</span>
            <span title="Total root visits in latest frame.">Visits: {selectedFrame?.rootInfo?.visits ?? 0}</span>
            <span title="Winrate for side to move in latest frame.">Winrate: {(((selectedFrame?.rootInfo?.winrate ?? 0) * 100)).toFixed(1)}%</span>
            <span title="Score lead from latest frame (points).">Lead: {(selectedFrame?.rootInfo?.scoreLead ?? 0).toFixed(2)}</span>
            <span title="Whether KataGo is currently searching.">Search: {selectedFrame?.isDuringSearch ? 'running' : 'idle'}</span>
          </div>
        ) : null}
        {lastError ? <div className="errorBanner">{lastError}</div> : null}
      </section>

      <section className="right" title="Right panel: moves, analysis, variation tree, and logs.">
        <div className="panel" title="Game actions and move selection.">
          <h2 title="Game controls.">Game and Moves</h2>
          <p className="panelHint" title="First create/load a game, then choose a move position.">
            Create a game, load SGF, and choose the position to analyze.
          </p>
          <div className="rightControls twoCols">
            <button
              title={canMutateGame ? 'Create a new empty game using the settings on the left.' : blockedByAnalysisHint}
              onClick={createGame}
              disabled={!canMutateGame}
            >
              New Game
            </button>
            <label
              title={canMutateGame ? 'Upload an SGF file and replace the current game.' : blockedByAnalysisHint}
              className={`upload buttonLike ${canMutateGame ? '' : 'disabled'}`}
            >
              Upload SGF
              <input
                title={canMutateGame ? 'Choose an SGF file to upload.' : blockedByAnalysisHint}
                type="file"
                accept=".sgf"
                disabled={!canMutateGame}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadSgf(file);
                }}
              />
            </label>
            <button
              title={canMutateGame ? 'Undo the last move in the current line.' : blockedByAnalysisHint}
              onClick={() => send(wsRef.current, { type: 'undo_move' })}
              disabled={!canMutateGame}
            >
              Undo Move
            </button>
            <button
              title={
                canPlayKataGoMove
                  ? 'Play KataGo suggested move for selected position and candidate.'
                  : isAnalysisRunning
                    ? blockedByAnalysisHint
                    : missingAnalysisHint
              }
              onClick={playKataGoMoveFromSelected}
              disabled={!canPlayKataGoMove}
            >
              Play KataGo Move
            </button>
          </div>
        </div>

        <div className="panel" title="Select a move number to view analysis snapshots.">
          <h2 title="All positions in the current game.">Position Selection</h2>
          <p className="panelHint" title="Click a position to open its cached analysis history.">
            Pick a move, then run analysis for either the current or selected position.
          </p>
          <div className="list" title={canSelectPosition ? 'Click a position to load its analysis history.' : blockedByAnalysisHint}>
            {Array.from({ length: state.moves.length + 1 }).map((_, i) => (
              <button
                title={canSelectPosition ? `Show analysis for position ${i}.` : blockedByAnalysisHint}
                key={i}
                onClick={() => requestHistory(i)}
                className={selectedMove === i ? 'active' : ''}
                disabled={!canSelectPosition}
              >
                Position {i}
              </button>
            ))}
          </div>
        </div>

        <div className="panel" title="Start and stop analysis controls.">
          <h2 title="KataGo analysis controls.">Analysis</h2>
          <p className="panelHint" title="Set visit budget and choose which position to analyze.">
            Separate buttons for analyzing current and selected positions.
          </p>
          <div className="analysisGuide" title="Suggested analysis flow.">
            <span className="guideStep guideDone">1. Select position ({selectedMove})</span>
            <span className={`guideStep ${isAnalysisRunning ? 'guideCurrent' : hasSelectedAnalysis ? 'guideDone' : 'guideTodo'}`}>
              2. Run analysis
            </span>
            <span className={`guideStep ${canPlayKataGoMove ? 'guideDone' : hasSelectedAnalysis ? 'guideCurrent' : 'guideTodo'}`}>
              3. Play KataGo move
            </span>
          </div>
          <div className="analysisNote" title="Current analysis status.">{analysisStateMessage}</div>
          <div className="rightControls twoCols">
            <label title="Visits budget per analysis run." className="groupInline fullWidth">
              Visits limit
              <input
                title={canRunAnalysis ? 'Visits budget per analysis run.' : blockedByAnalysisHint}
                type="number"
                min={50}
                step={50}
                value={maxVisits}
                onChange={(e) => setMaxVisits(Number(e.target.value))}
                disabled={!canRunAnalysis}
              />
            </label>
            <button
              title={canRunAnalysis ? 'Run analysis for the current board position.' : blockedByAnalysisHint}
              onClick={() => analyzeMoveNumber(state.moves.length)}
              disabled={!canRunAnalysis}
            >
              Analyze Current
            </button>
            <button
              title={canRunAnalysis ? 'Run analysis for the position selected in move history.' : blockedByAnalysisHint}
              onClick={() => analyzeMoveNumber(selectedMove)}
              disabled={!canRunAnalysis}
            >
              Analyze Selected
            </button>
            <button
              className="dangerButton"
              title="Immediately stop the current KataGo search."
              onClick={() => send(wsRef.current, { type: 'stop_analysis' })}
              disabled={!wsReady || !isAnalysisRunning}
            >
              Stop Analysis
            </button>
          </div>
        </div>

        <div className="panel" title="Best KataGo candidate moves for the selected position.">
          <h2 title="Recommended move table.">Candidates</h2>
          <p className="panelHint" title="Hover a row to highlight its variation on the board.">
            Hover a row to highlight the corresponding variation.
          </p>
          <table title="Hover a row to highlight the variation on the board.">
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
                  <td title="Candidate rank.">{m.order + 1}</td>
                  <td title="Move coordinate.">{m.move}</td>
                  <td title="Number of simulations for this move.">{m.visits}</td>
                  <td title="Internal candidate weight in search.">{m.weight?.toFixed(2)}</td>
                  <td title="Estimated win probability.">{(100 * (m.winrate ?? 0)).toFixed(1)}%</td>
                  <td title="Estimated score lead in points.">{m.scoreLead?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel" title="Variation tree built from principal variations.">
          <h2 title="Main lines from the current analysis.">Variation Tree (PV)</h2>
          <AnalysisTree frame={selectedFrame} />
        </div>

        <div className="panel" title="Engine and connection service messages.">
          <h2 title="Realtime backend/KataGo logs.">Engine Logs</h2>
          <div title="WebSocket state between browser and backend.">Socket: {wsReady ? 'connected' : 'disconnected'}</div>
          <div title="Whether an analysis frame exists for the current board position.">Analysis frame for current position: {currentFrame ? 'yes' : 'no'}</div>
          <pre ref={logsRef} title="This log area auto-scrolls to the latest message.">{logs.slice(-120).join('\n')}</pre>
        </div>
      </section>
    </main>
  );
}
