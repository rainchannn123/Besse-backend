# Socket.IO Integration Guide

This guide explains how to integrate the backend real-time updates into your frontend using Socket.IO. It describes authentication, joining game rooms, the events emitted by the server, and recommended client-side patterns for handling updates. The server sends a "full" game-state payload on important changes so your frontend can mirror the REST `GET /api/games/:sessionId` response in real time.

---

## Quick summary

- Use Socket.IO client to connect and authenticate using the same JWT used for REST API calls (handshake `auth.token` or query `?token=`).
- Join the game session with `join-game` (send `{ sessionId }`) after connecting.
- Listen for `game-state-full` to receive the complete game-state payload (mirrors REST response shape), plus `game-state-updated`, `system-message`, and `player-action` for complementary events.
- Trigger game actions through the REST API endpoints (recommended). The server will broadcast updates via sockets; sockets are primarily for receiving real-time updates.

---

## Connection & Authentication

Server expects the JWT token in `socket.handshake.auth.token` or `socket.handshake.query.token`.

Recommended connection pattern (modern Socket.IO client):

```js
// npm: socket.io-client (v4+)
import { io } from 'socket.io-client';

const token = localStorage.getItem('token'); // or wherever you store it
const socket = io(process.env.REACT_APP_API_WS_URL || 'http://localhost:5000', {
  autoConnect: false,
  transports: ['websocket'],
  auth: {
    token,
  },
});

// connect when ready (e.g. after user logs in)
socket.connect();

// handle connection errors
socket.on('connect_error', (err) => {
  console.error('Socket connect error', err?.message || err);
});

socket.on('connect', () => {
  console.log('Connected to game socket', socket.id);
});

socket.on('disconnect', (reason) => {
  console.warn('Socket disconnected', reason);
});
```

Notes:
- If your environment or client library cannot set `handshake.auth`, you may pass the token as a query `?token=...` (server accepts `handshake.query.token` as fallback).
- Keep token refresh in mind (if you refresh JWT, re-authenticate by disconnecting and reconnecting with the new token).

---

## Join a game (room)

After connecting, join the session room to receive session-scoped events:

```js
function joinGame(sessionId) {
  socket.emit('join-game', { sessionId });

  // server will emit back `joined-game` on success
  socket.once('joined-game', (payload) => {
    console.log('Joined game:', payload);
    // payload: { sessionId, userId, userName }
  });
}

function leaveGame(sessionId) {
  socket.emit('leave-game', { sessionId });
}
```

The server validates access to the session and will reject if the user is not a participant.

---

## Important events (server -> client)

Below are the primary socket events you should handle. The server sends both compact events (keeps prior behavior) and a new full-state event `game-state-full`.

- `game-state-full` (recommended): Full game state payload (mirrors `GET /api/games/:sessionId` response). Use this to fully replace or reconcile your local game state.
  - Example payload structure:
    {
      sessionId: string,
      timestamp: number,
      gameState: { /* full GameState object (same as REST) */ },
      playerRoles: { municipality, mrf, broker },
      playerNames: { municipality, mrf, broker },
      countdownTimeRemaining: number | null,
      turnSummary: { turn, budget, health, co2, wasteInventory, pendingBatches, completedProjects, status },
      statistics: { totalWaste, pendingWaste, completedProjects, totalTransactions, averageCO2PerTurn },
      actionType: string | null, // e.g. 'waste-collected', 'turn-ended'
      actionDetails: object | null
    }

- `game-state-updated`: Compact update event used by several server-side broadcasts.
  - payload: { sessionId, gameState, actionType, actionDetails, timestamp }

- `system-message`: Short human-readable system notifications. Example: `{ message, type: 'info'|'warning'|'error', timestamp }`.

- `player-action`: Notifications about a player's action. Example: `{ playerId, playerName, action, details, timestamp }`.

- `joined-game`: Confirmation when the client successfully joined a room. Example: `{ sessionId, userId, userName }`.

- `error`: Socket error event (server may emit). Example: `{ message }`.

Note: Keep listeners idempotent — events may arrive multiple times on reconnect or network noise.

---

## Example: Receiving the full payload and updating UI (React + Redux/Context)

This example shows a simple pattern to handle `game-state-full` and merge with local state.

```js
// inside a React effect or custom hook
useEffect(() => {
  if (!socket) return;

  const onFullState = (payload) => {
    // Option A: Replace the entire game state
    setGameState(payload.gameState);

    // Option B: Merge with local UI-only fields while keeping canonical truth
    // setGameState(prev => ({ ...prev, ...payload.gameState }));

    // You can also compute derived UI state from payload.turnSummary or payload.statistics
    setTurnSummary(payload.turnSummary);
    setStats(payload.statistics);

    // Optionally show an in-app notification for `payload.actionType`
    if (payload.actionType === 'waste-collected') {
      showToast('Waste collected by municipality');
    }
  };

  socket.on('game-state-full', onFullState);

  return () => {
    socket.off('game-state-full', onFullState);
  };
}, [socket]);
```

Guidelines:
- Treat `gameState` from socket as authoritative; prefer server state to resolve conflicts.
- For highly interactive UI elements (e.g., drag/drop or optimistic updates), apply optimistic UI locally but reconcile with server payload when `game-state-full` arrives.

---

## Example: Minimizing re-renders and handling frequent updates

System checks may emit updates frequently. To avoid UI thrashing:

- Debounce or throttle updates before writing to global state.
- Compare incoming `gameState.lastAutoSaveTime` or `timestamp` and ignore duplicates.
- Use `turnSummary` or `statistics` to update only summary widgets.

Example throttle using lodash:

```js
import { throttle } from 'lodash';

const applyFullState = throttle((payload) => {
  setGameState(payload.gameState);
}, 500); // at most twice per second

socket.on('game-state-full', applyFullState);
```

---

## Emitting actions from client

Most gameplay actions are implemented as REST endpoints (recommended). Example endpoints live under `/api/games/:sessionId` and `/api/municipality/:sessionId/*`.

Reasons to use REST for actions:
- Simpler authentication (standard headers)
- Easier retry and error handling
- Clear audit trail in logs and DB

Example: Collect waste (Municipality player)

```js
await fetch(`/api/municipality/${sessionId}/collect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ batchId }),
});
```

After the backend processes the action, it will broadcast the real-time update via sockets (e.g., `game-state-full` + `game-state-updated`). Your client only needs to listen and update state accordingly.

If you prefer socket-emitted actions, you can implement a small wrapper that calls the REST endpoint under the hood, but that’s optional.

---

## Reconnect & token refresh

- If the JWT expires, disconnect and reconnect with the refreshed token. Example:

```js
async function refreshAndReconnect() {
  const newToken = await refreshJwt();
  socket.auth = { token: newToken };
  socket.disconnect();
  socket.connect();
}
```

- On network reconnect, the client should `join-game` again to re-subscribe to the room.

---

## TypeScript interfaces (suggested)

You can add the following interfaces on the frontend for better typing (example):

```ts
interface FullGameStatePayload {
  sessionId: string;
  timestamp: number;
  gameState: GameState;
  playerRoles: Record<string, string>;
  playerNames: Record<string, string>;
  countdownTimeRemaining: number | null;
  turnSummary: TurnSummary;
  statistics: GameStatistics;
  actionType?: string | null;
  actionDetails?: any | null;
}
```

Match these types to your frontend models for compile-time safety.

---

## Security notes

- Always authenticate socket connections with the same JWT used for REST.
- The server validates user membership in the session when joining a room, but your frontend should still enforce UI restrictions (e.g., hide municipality controls for non-municipality users).

---

## Server-side events reference (short)

- `game-state-full` — Full authoritative game state (recommended)
- `game-state-updated` — Compact update (legacy)
- `system-message` — Info/warning/error messages
- `player-action` — Player action notifications
- `joined-game` — Confirm join success
- `error` — Error details

---

## Example full client flow (React + hooks)

1. After user logs in, instantiate `socket` with JWT in `auth`.
2. Connect socket.
3. Call `joinGame(sessionId)` when user navigates to the game page.
4. Listen for `game-state-full` and `system-message` and update state.
5. Make gameplay changes through REST endpoints; the server will broadcast updates.
6. On page unmount, call `leaveGame(sessionId)` and `socket.disconnect()`.

---

## Next.js 16 + zustand Integration (Full README-style)

If your frontend is Next.js 16 and you use `zustand` for client state, the following sections show a complete, copy-paste-ready integration that matches the style and examples in this README: connection, authentication, room joining, receiving `game-state-full`, reducing re-renders, and an example client component.

Prerequisites
- `socket.io-client` (v4+)
- `zustand`
- A helper to get the current JWT token (e.g. `getToken()`)

1) `zustand` store (file: `src/stores/useGameStore.ts`)

```ts
import create from 'zustand';

type GameStore = {
  socket: ReturnType<typeof import('socket.io-client').io> | null;
  gameState: any | null;
  turnSummary: any | null;
  statistics: any | null;
  setSocket: (s: any | null) => void;
  setFullState: (payload: any) => void;
  clear: () => void;
};

export const useGameStore = create<GameStore>((set) => ({
  socket: null,
  gameState: null,
  turnSummary: null,
  statistics: null,
  setSocket: (s) => set({ socket: s }),
  setFullState: (payload) =>
    set(() => ({
      gameState: payload.gameState,
      turnSummary: payload.turnSummary,
      statistics: payload.statistics,
    })),
  clear: () => set({ socket: null, gameState: null, turnSummary: null, statistics: null }),
}));
```

2) `useGameSocket` hook (file: `src/hooks/useGameSocket.ts`)

```ts
"use client";

import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useGameStore } from '../stores/useGameStore';
import { getToken } from '../utils/auth'; // implement according to your auth flow

export function useGameSocket(sessionId: string | null) {
  const setSocket = useGameStore((s) => s.setSocket);
  const setFullState = useGameStore((s) => s.setFullState);

  useEffect(() => {
    if (!sessionId) return;

    const token = getToken();
    if (!token) return;

    const socket = io(process.env.NEXT_PUBLIC_API_WS_URL || '', {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token },
    });

    setSocket(socket);

    socket.connect();

    // Join room
    socket.emit('join-game', { sessionId });

    socket.on('joined-game', (payload) => {
      console.debug('joined-game', payload);
    });

    socket.on('game-state-full', (payload) => {
      // store authoritative payload in zustand
      setFullState(payload);
    });

    socket.on('system-message', (msg) => {
      // show notification
      console.info('system-message', msg);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error', err?.message || err);
    });

    return () => {
      try {
        socket.emit('leave-game', { sessionId });
      } catch (err) {
        // ignore
      }
      socket.disconnect();
      setSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}
```

3) Client component example (Next.js app router, client component)

```tsx
"use client";

import { useRouter } from 'next/router';
import { useGameSocket } from '../../../src/hooks/useGameSocket';
import { useGameStore } from '../../../src/stores/useGameStore';

export default function GamePageClient() {
  const router = useRouter();
  const { sessionId } = router.query as { sessionId?: string };

  useGameSocket(sessionId || null);

  const gameState = useGameStore((s) => s.gameState);

  return (
    <main>
      <h1>Game {sessionId}</h1>
      <pre>{JSON.stringify(gameState, null, 2)}</pre>
    </main>
  );
}
```

4) Token refresh & reconnect

If you refresh JWTs in your app, re-authenticate the socket like this:

```ts
function refreshSocketToken(socket, newToken, sessionId) {
  if (!socket) return;
  socket.auth = { token: newToken };
  socket.disconnect();
  socket.connect();
  socket.emit('join-game', { sessionId });
}
```

5) Reducing re-renders and high-frequency updates

- Throttle applying `game-state-full` in your store (e.g. `lodash.throttle`).
- Alternatively, update only `turnSummary` or `statistics` fields for high-frequency events.

6) TypeScript typings

Add interfaces in `src/types/socket.ts` to share types between frontend and backend if desired. Example:

```ts
export interface FullGameStatePayload {
  sessionId: string;
  timestamp: number;
  gameState: any;
  playerRoles: Record<string, string>;
  playerNames: Record<string, string>;
  countdownTimeRemaining: number | null;
  turnSummary: any;
  statistics: any;
  actionType?: string | null;
  actionDetails?: any | null;
}
```

---

Would you like me to create the `src/stores` and `src/hooks` files in this repository now (TypeScript), or add the TypeScript interfaces under `src/types` so you can import them into the frontend? 
