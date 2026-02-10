'use client';

import { AnalysisFrame, GameStatePayload } from './types';

export type ServerEvent =
  | { type: 'game_state'; payload: GameStatePayload }
  | { type: 'analysis_update'; payload: AnalysisFrame }
  | { type: 'analysis_status'; payload: { enabled: boolean; targetMoveNumber: number; maxVisits: number; previewVisits?: number } }
  | { type: 'analysis_history_snapshot'; payload: { moveNumber: number; frames: AnalysisFrame[] } }
  | { type: 'server_log'; payload: { message: string } }
  | { type: 'error'; payload: { message: string } };

function resolveWsUrl(raw: string): string {
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
    return raw;
  }
  if (raw.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${raw}`;
  }
  return raw;
}

export function connect(onEvent: (event: ServerEvent) => void): WebSocket {
  const configured = process.env.NEXT_PUBLIC_WS_URL ?? '/api/ws/game';
  const url = resolveWsUrl(configured);
  const ws = new WebSocket(url);
  ws.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data) as ServerEvent);
    } catch {
      // ignore malformed payload
    }
  };
  return ws;
}

export function send(ws: WebSocket | null, payload: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}
