# BESSE Frontend Integration Guide

A comprehensive guide for frontend developers integrating with the BESSE backend API. This document provides detailed endpoint specifications, request/response schemas, real-time WebSocket integration patterns, and complete integration examples for building a full-featured BESSE client application.

## Recent Updates (v2.0)
- **Random Team Assignment**: `joinLobby` now supports optional `lobbyCode` for automatic team assignment
- **Pair Score Real-Time Updates**: Pair scores are updated in database during gameplay and saved at game end
- **Win/Loss Determination**: Games end with 'won' or 'lost' status based on pair health >= 60%
- **Enhanced Broker Actions**: Direct access to MRF materials for selling and transferring
- **Pair Details API**: New endpoint to retrieve pair statistics and rankings

## Table of Contents

- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [WebSocket Integration](#websocket-integration)
  - [Connection Management](#connection-management)
  - [Real-Time Events](#real-time-events)
  - [React Hook Integration](#react-hook-integration)
- [API Endpoints](#api-endpoints)
  - [Authentication Endpoints](#authentication-endpoints)
  - [Lobby Management](#lobby-management)
  - [Team Pairing System](#team-pairing-system)
  - [Game State & Control](#game-state--control)
  - [Municipality Endpoints](#municipality-endpoints)
  - [MRF Endpoints](#mrf-endpoints)
  - [Broker Endpoints](#broker-endpoints)
- [Error Handling](#error-handling)
- [Type Definitions](#type-definitions)
- [Integration Examples](#integration-examples)
  - [Complete Game Flow](#complete-game-flow)
  - [React Component Examples](#react-component-examples)
  - [State Management Patterns](#state-management-patterns)

---

## Quick Start

### Base Configuration
```typescript
const API_BASE_URL = 'http://localhost:5000/api';
const WS_BASE_URL = 'http://localhost:5000';

// JWT token storage
let authToken: string | null = null;

const apiClient = {
  get: (endpoint: string) => fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': authToken ? `Bearer ${authToken}` : '',
      'Content-Type': 'application/json'
    }
  }),
  post: (endpoint: string, data?: any) => fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': authToken ? `Bearer ${authToken}` : '',
      'Content-Type': 'application/json'
    },
    body: data ? JSON.stringify(data) : undefined
  })
};
```

### WebSocket Setup
```typescript
import io from 'socket.io-client';

class GameSocket {
  private socket: any;
  private currentSessionId: string | null = null;

  connect(token: string) {
    this.socket = io(WS_BASE_URL, {
      auth: { token }
    });

    this.socket.on('connect', () => {
      console.log('Connected to BESSE server');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from BESSE server');
    });
  }

  joinGame(sessionId: string) {
    this.currentSessionId = sessionId;
    this.socket.emit('join-game', { sessionId });
  }

  leaveGame() {
    if (this.currentSessionId) {
      this.socket.emit('leave-game', { sessionId: this.currentSessionId });
      this.currentSessionId = null;
    }
  }

  // Event listeners will be added per component
}
```

---

## Authentication

### Register User
```typescript
POST /api/auth/register

interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

interface RegisterResponse {
  success: true;
  message: "User registered successfully";
  data: {
    user: {
      _id: string;
      name: string;
      email: string;
      role: "player";
      createdAt: string;
      updatedAt: string;
    }
  }
}

// Usage
const register = async (userData: RegisterRequest): Promise<RegisterResponse> => {
  const response = await apiClient.post('/auth/register', userData);
  const data = await response.json();
  if (data.success) {
    authToken = data.data.token;
  }
  return data;
};
```

### Login User
```typescript
POST /api/auth/login

interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  success: true;
  message: "Login successful";
  data: {
    user: {
      _id: string;
      name: string;
      email: string;
      role: "player";
    };
    token: string;
  }
}

// Usage
const login = async (credentials: LoginRequest): Promise<LoginResponse> => {
  const response = await apiClient.post('/auth/login', credentials);
  const data = await response.json();
  if (data.success) {
    authToken = data.data.token;
  }
  return data;
};
```

### Get User Profile
```typescript
GET /api/auth/profile

interface ProfileResponse {
  success: true;
  message: "Profile retrieved successfully";
  data: {
    user: {
      _id: string;
      name: string;
      email: string;
      role: "player";
      currentSession: string | null;
    }
  }
}

// Usage
const getProfile = async (): Promise<ProfileResponse> => {
  const response = await apiClient.get('/auth/profile');
  return response.json();
};
```

---

## WebSocket Integration

### Connection Management
```typescript
class GameWebSocket {
  private socket: any;
  private eventListeners: { [key: string]: Function[] } = {};

  constructor() {
    this.setupEventForwarding();
  }

  connect(token: string) {
    this.socket = io(WS_BASE_URL, { auth: { token } });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.emit('connected');
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.emit('disconnected');
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('WebSocket connection error:', error);
      this.emit('connection_error', error);
    });
  }

  private setupEventForwarding() {
    const events = [
      'joined-game', 'lobby-state-update', 'game-state-update', 'game-state-full', 'waste-collected',
      'waste-rejected', 'material-ordered', 'waste-processed',
      'material-graded', 'material-sold-external', 'material-transferred',
      'system-check-update', 'turn-ended', 'game-complete',
      'system-message', 'player-action', 'pairing-joined',
      'pairing-status-update', 'teams-paired', 'partner-eliminated',
      'pairing-left', 'pair-score-updated', 'error'
    ];

    events.forEach(event => {
      this.socket?.on(event, (data: any) => {
        this.emit(event, data);
      });
    });
  }

  // Event emitter pattern
  on(event: string, callback: Function) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  private emit(event: string, data?: any) {
    const listeners = this.eventListeners[event] || [];
    listeners.forEach(callback => callback(data));
  }

  // Game room management
  joinGame(sessionId: string) {
    this.socket?.emit('join-game', { sessionId });
  }

  leaveGame(sessionId: string) {
    this.socket?.emit('leave-game', { sessionId });
  }

  disconnect() {
    this.socket?.disconnect();
  }
}
```

### Real-Time Update Payload

Every 30 seconds or on any action, the server sends a specific data payload to all players:

```typescript
interface RealtimeUpdatePayload {
  sessionId: string;
  currentBudget: number; // e.g., 8750.50
  totalCO2: number; // e.g., 142.8
  wastePending: {
    batch_id: string; // e.g., "w-8823"
    mass: number; // e.g., 15.5
    deadline: string; // e.g., "10:25:00"
    status: string; // "pending" or "overdue"
  } | null;
  materialAvailable: {
    item_id: string; // e.g., "m-551"
    type: string; // "paper", "plastic", etc.
    grade: string; // "A", "B", "C"
    mass: number; // e.g., 8.0
  } | null;
}
```

This payload is included in the `game-state-full` event under the `realtimeUpdate` property.

### Pair Data Payload

When teams are paired, the `game-state-full` event includes pair information:

```typescript
interface PairDataPayload {
  pairId: string;
  partnerSessionId: string;
  teamRole: 'Team A' | 'Team B';
  pairStatus: 'active' | 'team_a_eliminated' | 'team_b_eliminated' | 'completed';
  partnerHealth?: number; // Current partner city health
  partnerBudget?: number; // Current partner budget
  partnerCO2?: number; // Current partner CO2 emissions
  partnerGameStatus?: 'active' | 'lost' | 'complete'; // Partner game status
}
```

This payload is included in the `game-state-full` event under the `pairData` property. Use this to display real-time partner information and handle elimination states.

### Teams-Paired Event Implementation

The `teams-paired` event is emitted when two teams are successfully matched for competitive gameplay. This event transitions the application from pairing queue to game preparation.

**Event Payload:**
```typescript
interface TeamsPairedPayload {
  pairId: string;           // Unique pair identifier (format: pair-XXXX)
  partnerSessionId: string; // Session ID of the partner team
  teamRole: 'Team A' | 'Team B'; // Assigned role in the pair
  sessionId: string;        // Current team's session ID
  timestamp: number;        // Event timestamp
}
```

**Frontend Implementation:**
```typescript
// In your WebSocket event handler
ws.on('teams-paired', (data: TeamsPairedPayload) => {
  // Update pairing status
  setPairingStatus({
    isInQueue: false,
    position: 0,
    estimatedWaitTime: 0,
    isPaired: true,
    pairId: data.pairId,
    partnerSessionId: data.partnerSessionId,
    teamRole: data.teamRole,
  });

  // Show success notification
  showNotification(`Teams paired! You are ${data.teamRole}`, 'success');

  // Navigate to game preparation screen
  navigateToGamePreparation(data.pairId, data.teamRole);

  // Optionally fetch initial pair data
  fetchPartnerMetrics(data.partnerSessionId);
});
```

**UI State Transitions:**
- **Before**: User in pairing queue with position indicator
- **After**: User in paired state with team role and partner info
- **Next**: Transition to game start or competitive gameplay

### Real-Time Events

#### 📥 **Incoming Events (Listen)**

| Event | Description | Payload |
|-------|-------------|---------|
| `joined-game` | Successfully joined game room | `{ sessionId, userId, userName }` |
| `lobby-state-update` | Lobby state update when all roles selected and status becomes ready | `{ sessionId, lobbyState, timestamp }` |
| `game-state-update` | Full game state synchronization | `{ sessionId, gameState, timestamp }` |
| `game-state-full` | Full game state with computed extras | `{ gameState, playerRoles, playerNames, countdownTimeRemaining, turnSummary, statistics, realtimeUpdate, pairData, actionType, actionDetails, sessionId, timestamp }` |
| `waste-collected` | Waste collection completed | `{ sessionId, gameState, timestamp }` |
| `waste-rejected` | Waste rejection completed | `{ sessionId, gameState, timestamp }` |
| `material-ordered` | Material order placed | `{ sessionId, gameState, timestamp }` |
| `waste-processed` | Waste processing completed by MRF | `{ sessionId, gameState, timestamp }` |
| `material-graded` | Material quality grade assigned | `{ sessionId, gameState, timestamp }` |
| `material-sold-external` | Material sold to external market | `{ sessionId, gameState, timestamp }` |
| `material-transferred` | Material transferred to municipality | `{ sessionId, gameState, timestamp }` |
| `system-check-update` | Automatic system updates (30s) | `{ sessionId, gameState, timestamp }` |
| `turn-ended` | Turn progression | `{ sessionId, gameState, timestamp }` |
| `system-message` | Info/warning/error messages | `{ message, type, timestamp }` |
| `player-action` | Player activity notifications | `{ playerId, playerName, action, details, timestamp }` |
| `pairing-joined` | Team joined pairing queue | `{ sessionId, position, estimatedWaitTime, timestamp }` |
| `pairing-status-update` | Pairing queue status changed | `{ sessionId, status: { isPaired, pairId, partnerSessionId, teamRole }, timestamp }` |
| `teams-paired` | Teams successfully paired for competition | `{ pairId, partnerSessionId, teamRole, sessionId, timestamp }` |
| `partner-eliminated` | Partner team has been eliminated | `{ sessionId, partnerSessionId, reason, timestamp }` |
| `game-complete` | Game ended with final results | `{ pairAverageHealth, teamAHealth, teamBHealth, teamABudget, teamBBudget, teamACO2, teamBCO2, sessionId, timestamp }` |
| `pair-score-updated` | Pair score updated in database | `{ pairId, averagePairHealth, teamAHealth, teamBHealth, pairStatus, sessionId, timestamp }` |
| `countdown-warning` | 1-second countdown warnings | `{ message, team, timeRemaining, sessionId, timestamp }` |
| `pairing-left` | Team left pairing queue | `{ sessionId, timestamp }` |
| `error` | Error notifications | `{ message }` |

#### 📤 **Outgoing Events (Emit)**

| Event | Description | Payload |
|-------|-------------|---------|
| `join-game` | Join game room | `{ sessionId }` |
| `leave-game` | Leave game room | `{ sessionId }` |

### React Hook Integration

```typescript
import { useEffect, useState, useCallback } from 'react';

export interface Notification {
  id: number;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

export const useGameWebSocket = (
  token: string,
  sessionId: string | null,
  setPairingStatus?: (status: any) => void,
  setRealtimeUpdate?: (update: RealtimeUpdatePayload | null) => void,
  setPairData?: (pairData: PairDataPayload | null) => void
) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [partnerMetrics, setPartnerMetrics] = useState<any>(null);
  const [pairData, setPairDataState] = useState<PairDataPayload | null>(null);

  const addNotification = useCallback((message: string, type: Notification['type'] = 'info') => {
    const notification: Notification = {
      id: Date.now(),
      message,
      type
    };
    setNotifications(prev => [...prev.slice(-4), notification]); // Keep last 5 notifications
  }, []);

  useEffect(() => {
    if (!token) return;

    const ws = new GameWebSocket();

    // Connection events
    ws.on('connected', () => {
      setIsConnected(true);
      setConnectionError(null);
      addNotification('Connected to game server', 'success');
    });

    ws.on('disconnected', () => {
      setIsConnected(false);
      addNotification('Disconnected from game server', 'warning');
    });

    ws.on('connection_error', (error) => {
      setConnectionError(error.message);
      addNotification(`Connection error: ${error.message}`, 'error');
    });

    // Game state events
    ws.on('lobby-state-update', (data) => {
      // Update lobby state when all roles are selected and status becomes ready
      // This indicates the lobby is ready for game start
      console.log('Lobby ready:', data.lobbyState);
      // Update UI to show lobby is ready, enable start game button, etc.
    });

    ws.on('game-state-update', (data) => {
      setGameState(data.gameState);
    });

    ws.on('game-state-full', (data) => {
      setGameState(data.gameState);
      setRealtimeUpdate(data.realtimeUpdate);
      setPairDataState(data.pairData);
      setPairData?.(data.pairData);
    });

    ws.on('game-state-full', (data) => {
      setGameState(data.gameState);
      // Access realtimeUpdate: data.realtimeUpdate
      // Access countdownTimeRemaining: data.countdownTimeRemaining
    });

    ws.on('waste-collected', (data) => {
      setGameState(data.gameState);
      addNotification('Waste collected successfully', 'success');
    });

    ws.on('waste-rejected', (data) => {
      setGameState(data.gameState);
      addNotification('Waste rejected - landfill penalties applied', 'warning');
    });

    ws.on('waste-processed', (data) => {
      setGameState(data.gameState);
      addNotification('Waste processed into materials', 'success');
    });

    ws.on('material-graded', (data) => {
      setGameState(data.gameState);
      addNotification(`Material graded as ${data.grade}`, 'info');
    });

    ws.on('material-ordered', (data) => {
      setGameState(data.gameState);
      addNotification('Material order placed', 'success');
    });

    ws.on('material-sold-external', (data) => {
      setGameState(data.gameState);
      addNotification('Material sold to external market', 'success');
    });

    ws.on('material-transferred', (data) => {
      setGameState(data.gameState);
      addNotification('Material transferred to municipality', 'info');
    });

    ws.on('game-complete', (data) => {
      setGameState(data.gameState);
      addNotification(`Game Complete! Pair Score: ${data.pairAverageHealth}%`, 'success');
      // Handle game end UI with data.teamAHealth, data.teamBHealth, etc.
    });

    // System events
    ws.on('system-message', (data) => {
      addNotification(data.message, data.type as Notification['type']);
    });

    ws.on('system-check-update', (data) => {
      setGameState(data.gameState);
      // Optional: Show subtle update indicator
    });

    ws.on('turn-ended', (data) => {
      setGameState(data.gameState);
      addNotification(`Turn ${data.turnNumber} completed`, 'info');
    });

    // Player activity
    ws.on('player-action', (data) => {
      addNotification(`${data.playerName} performed: ${data.action}`, 'info');
    });

    // Pairing system events
    ws.on('pairing-joined', (data) => {
      addNotification(`Joined pairing queue at position ${data.position}`, 'info');
      // Update pairing status in store
      setPairingStatus?.({
        isInQueue: true,
        position: data.position,
        estimatedWaitTime: data.estimatedWaitTime,
        isPaired: false,
        pairId: null,
        partnerSessionId: null,
        teamRole: null,
      });
    });

    ws.on('pairing-status-update', (data) => {
      // Update pairing status
      setPairingStatus?.(data.status);
    });

    ws.on('teams-paired', (data) => {
      addNotification(`Teams paired! You are ${data.teamRole}`, 'success');
      setPairingStatus?.({
        isInQueue: false,
        position: 0,
        estimatedWaitTime: 0,
        isPaired: true,
        pairId: data.pairId,
        partnerSessionId: data.partnerSessionId,
        teamRole: data.teamRole,
      });
      // Transition to game start or paired lobby
      // This event indicates teams are now paired and ready for competitive gameplay
    });

    ws.on('partner-eliminated', (data) => {
      addNotification(`Partner team ${data.partnerSessionId} eliminated: ${data.reason}`, 'warning');
      // Update pairing status to reflect partner elimination
      setPairingStatus?.((prev: any) => prev ? {
        ...prev,
        pairStatus: data.partnerSessionId === prev.partnerSessionId ? 'Partner Eliminated' : prev.pairStatus
      } : null);
    });

    ws.on('pairing-left', (data) => {
      addNotification('Left pairing queue', 'info');
      setPairingStatus?.(null);
    });

    // Error handling
    ws.on('error', (data) => {
      addNotification(`Error: ${data.message}`, 'error');
    });

    // Connect and join game
    ws.connect(token);

    if (sessionId) {
      ws.joinGame(sessionId);
    }

    return () => {
      ws.disconnect();
    };
  }, [token, sessionId, addNotification, setPairingStatus, setRealtimeUpdate, setPairData]);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    gameState,
    isConnected,
    connectionError,
    notifications,
    partnerMetrics,
    realtimeUpdate,
    pairData,
    clearNotifications,
    addNotification
  };
};
```

---

## API Endpoints

### Authentication Endpoints

#### Register User
```typescript
POST /api/auth/register
Authorization: None

Request: RegisterRequest
Response: RegisterResponse
```

#### Login User
```typescript
POST /api/auth/login
Authorization: None

Request: LoginRequest
Response: LoginResponse
```

#### Get User Profile
```typescript
GET /api/auth/profile
Authorization: Bearer Token

Response: ProfileResponse
```

### Lobby Management

#### Get Available Lobbies
```typescript
GET /api/lobby/available
Authorization: Bearer Token

interface LobbyListResponse {
  success: true;
  message: "Available lobbies retrieved successfully";
  data: {
    lobbies: Array<{
      _id: string;
      sessionId: string;
      lobbyCode: string;
      players: Array<{
        userId: string;
        name: string;
        selectedRole: string | null;
        joinedAt: string;
      }>;
      status: "waiting" | "ready";
      maxPlayers: 3;
      createdAt: string;
    }>
  }
}
```

#### Create Lobby
```typescript
POST /api/lobby/create
Authorization: Bearer Token

interface CreateLobbyResponse {
  success: true;
  message: "Lobby created successfully";
  data: {
    lobby: {
      _id: string;
      sessionId: string;
      lobbyCode: string;
      leader: string;
      players: Array<{
        userId: string;
        name: string;
        selectedRole: string | null;
        joinedAt: string;
      }>;
      status: "waiting";
      maxPlayers: 3;
    }
  }
}
```

#### Join Lobby
```typescript
POST /api/lobby/join
Authorization: Bearer Token

interface JoinLobbyRequest {
  lobbyCode?: string; // Optional: 6-character lobby code. If not provided, randomly assigns to available lobby or creates new
}

interface JoinLobbyResponse {
  success: true;
  message: "Joined lobby successfully";
  data: {
    lobby: {
      _id: string;
      sessionId: string;
      lobbyCode: string;
      leader: string;
      players: Array<{
        userId: string;
        name: string;
        selectedRole: string | null;
        joinedAt: string;
      }>;
      status: "waiting";
      maxPlayers: 3;
    }
  }
}
```

#### Select Role
```typescript
POST /api/lobby/select-role
Authorization: Bearer Token

interface SelectRoleRequest {
  sessionId: string;
  role: "municipality" | "mrf" | "broker";
}

interface SelectRoleResponse {
  success: true;
  message: "Role selected successfully";
  data: {
    lobby: {
      // Updated lobby object
    }
  }
}
```

#### Get Lobby State
```typescript
GET /api/lobby/{sessionId}
Authorization: Bearer Token

interface LobbyStateResponse {
  success: true;
  message: "Lobby state retrieved successfully";
  data: {
    lobbyState: {
      sessionId: string;
      lobbyCode: string;
      leader: string;
      players: Array<{
        userId: string;
        name: string;
        selectedRole: string | null;
        joinedAt: string;
      }>;
      status: "waiting" | "ready";
      createdAt: string;
      maxPlayers: 3;
    }
  }
}
```

#### Start Game
```typescript
POST /api/lobby/start-game
Authorization: Bearer Token

interface StartGameRequest {
  sessionId: string;
}

interface StartGameResponse {
  success: true;
  message: "Game started successfully";
  data: {
    gameState: {
      // Complete game state object
    }
  }
}

// WebSocket Events Triggered:
// - joined-game
// - game-state-update
```

### Team Pairing System

#### Join Pairing Queue
```typescript
POST /api/lobby/pairing/join
Authorization: Bearer Token

interface JoinPairingQueueRequest {
  sessionId: string;
}

interface JoinPairingQueueResponse {
  success: true;
  message: "Joined pairing queue";
  data: {
    result: {
      queuePosition: number;
      message: string;
    };
  }
}

// Usage
const joinPairingQueue = async (sessionId: string): Promise<JoinPairingQueueResponse> => {
  const response = await apiClient.post('/lobby/pairing/join', { sessionId });
  return response.json();
};
```

#### Get Pairing Queue Status
```typescript
GET /api/lobby/pairing/status/{sessionId}
Authorization: Bearer Token

interface PairingStatusResponse {
  success: true;
  message: "Pairing queue status";
  data: {
    status: {
      queuePosition: number | null;
      totalInQueue: number;
      message: string;
    };
  }
}

// Usage
const getPairingStatus = async (sessionId: string): Promise<PairingStatusResponse> => {
  const response = await apiClient.get(`/lobby/pairing/status/${sessionId}`);
  return response.json();
};
```

#### Leave Pairing Queue
```typescript
POST /api/lobby/pairing/leave
Authorization: Bearer Token

interface LeavePairingQueueRequest {
  sessionId: string;
}

interface LeavePairingQueueResponse {
  success: true;
  message: "Left pairing queue";
}

// Usage
const leavePairingQueue = async (sessionId: string): Promise<LeavePairingQueueResponse> => {
  const response = await apiClient.post('/lobby/pairing/leave', { sessionId });
  return response.json();
};
```

#### Get Partner Team Metrics
```typescript
GET /api/lobby/pairing/partner/{sessionId}
Authorization: Bearer Token

interface PartnerMetricsResponse {
  success: true;
  message: "Partner metrics retrieved";
  data: {
    metrics: {
      sessionId: string;
      pairId: string;
      budget: number;
      cityHealth: number;
      totalCO2: number;
      currentTurn: number;
      gameStatus: "active" | "won" | "lost";
    }
  }
}

// Usage
const getPartnerMetrics = async (sessionId: string): Promise<PartnerMetricsResponse> => {
  const response = await apiClient.get(`/lobby/pairing/partner/${sessionId}`);
  return response.json();
};
```

#### Get Pairing Result
```typescript
GET /api/lobby/pairing/result/{sessionId}
Authorization: Bearer Token

interface PairingResultResponse {
  success: true;
  message: "Pair result retrieved";
  data: {
    result: {
      pairId: string;
      partnerSessionId: string;
      teamRole: "Team A" | "Team B";
      pairStatus: "Active" | "Team A Eliminated" | "Team B Eliminated" | "Pair Completed";
    }
  }
}

// Usage
const getPairingResult = async (sessionId: string): Promise<PairingResultResponse> => {
  const response = await apiClient.get(`/lobby/pairing/result/${sessionId}`);
  return response.json();
};
```

### Game State & Control

#### Get Game State
```typescript
GET /api/games/{sessionId}
Authorization: Bearer Token

interface GameStateResponse {
  success: true;
  message: "Game state retrieved successfully";
  data: {
    gameState: {
      sessionId: string;
      currentTurn: number;
      budget: number;
      cityHealth: number;
      totalCO2: number;
      totalTransportTrips: number;
      totalLandfillTons: number;
      gameStatus: "active" | "won" | "lost";
      players: {
        municipality: string;
        mrf: string;
        broker: string;
      };
      playerNames: {
        municipality: string;
        mrf: string;
        broker: string;
      };
      currentGameDay: number;
      currentGameHour: number;
      minutesElapsed: number;
      gameOverCountdown: {
        active: boolean;
        startTime: number | null;
        reason: "health" | "budget" | "time" | null;
      };
      activityLog: string[];
      wasteInventory: number;
      maxCapacity: number;
      constants: GameConstants;
      wasteBatches: WasteBatch[];
      mrfQueue: MRFQueue[];
      materialInventory: Material[];
      transactions: Transaction[];
      cityProjects: CityProject[];
      gameStartTime: number;
      lastWasteSpawnTime: number;
      lastAutoSaveTime: number;
      activeLocks: { [key: string]: { playerId: string; timestamp: number; type: 'batch' | 'queue' | 'material'; } };
      pairId?: string | null;
      partnerSessionId?: string | null;
      teamRole?: 'Team A' | 'Team B' | null;
      pairStatus?: 'active' | 'team_a_eliminated' | 'team_b_eliminated' | 'completed' | null;
      };
    userRole: string;
    userRoles: string[];
    countdownTimeRemaining: number | null;
  }
}
```

#### Get Player Role
```typescript
GET /api/games/{sessionId}/player-role
Authorization: Bearer Token

interface PlayerRoleResponse {
  success: true;
  message: "Player role retrieved successfully";
  data: {
    role: "municipality" | "mrf" | "broker";
  }
}
```

#### Get Pair Details
```typescript
GET /api/games/pair/{pairId}/details
Authorization: Bearer Token

interface PairDetailsResponse {
  success: true;
  message: "Pair details retrieved successfully";
  data: {
    pairDetails: {
      pairId: string;
      averagePairHealth: number;
      teamAHealth: number | null;
      teamBHealth: number | null;
      teamABudget: number;
      teamBBudget: number;
      teamACO2: number;
      teamBCO2: number;
      teamAGameStatus: string; // "active", "lost", "complete"
      teamBGameStatus: string; // "active", "lost", "complete"
      teamAPairStatus: string; // "active", "eliminated"
      teamBPairStatus: string; // "active", "eliminated"
      teamASessionId: string;
      teamBSessionId: string;
      status: string; // "Active", "Team A Eliminated", "Team B Eliminated"
      gameEndTimestamp: Date | undefined;
    }
  }
}

// Usage
const getPairDetails = async (pairId: string): Promise<PairDetailsResponse> => {
  const response = await apiClient.get(`/games/pair/${pairId}/details`);
  return response.json();
};
```

#### End Turn
```typescript
POST /api/games/{sessionId}/end-turn
Authorization: Bearer Token

interface EndTurnResponse {
  success: true;
  message: "Turn ended successfully";
  data: {
    gameState: {
      // Updated game state
    };
    userRole: string;
  }
}

// WebSocket Events Triggered:
// - turn-ended
// - game-state-update
```

#### Get Pair Details
```typescript
GET /api/games/pair/{pairId}/details
Authorization: Bearer Token

interface PairDetailsResponse {
  success: true;
  message: "Pair details retrieved successfully";
  data: {
    pairDetails: {
      pairId: string;
      averagePairHealth: number;
      teamAHealth: number | null;
      teamBHealth: number | null;
      teamABudget: number;
      teamBBudget: number;
      teamACO2: number;
      teamBCO2: number;
      teamAGameStatus: string; // "active", "lost", "complete"
      teamBGameStatus: string; // "active", "lost", "complete"
      teamAPairStatus: string; // "active", "eliminated"
      teamBPairStatus: string; // "active", "eliminated"
      teamASessionId: string;
      teamBSessionId: string;
      status: string; // "Active", "Team A Eliminated", "Team B Eliminated"
      gameEndTimestamp: Date;
    }
  }
}

// Usage
const getPairDetails = async (pairId: string): Promise<PairDetailsResponse> => {
  const response = await apiClient.get(`/games/pair/${pairId}/details`);
  return response.json();
};
```

### Municipality Endpoints

#### Collect Waste
```typescript
POST /api/games/{sessionId}/collect-waste
Authorization: Bearer Token (Municipality only)

interface CollectWasteRequest {
  batchId: string;
}

interface CollectWasteResponse {
  success: true;
  message: "Waste collected successfully";
  data: {
    gameState: {
      // Updated game state with collection costs and CO2
    }
  }
}

// WebSocket Events Triggered:
// - waste-collected
// - game-state-update
```

#### Reject Waste
```typescript
POST /api/municipality/reject-waste
Authorization: Bearer Token (Municipality only)

interface RejectWasteRequest {
  batchId: string;
  sessionId: string;
}

interface RejectWasteResponse {
  success: true;
  message: "Waste rejected";
  data: {
    gameState: {
      // Updated game state with landfill costs and health recalculation
    }
  }
}

// WebSocket Events Triggered:
// - waste-rejected
// - game-state-update
```

#### Get Waste Batches
```typescript
GET /api/municipality/waste-batches/{sessionId}
Authorization: Bearer Token (Municipality only)

interface WasteBatchesResponse {
  success: true;
  message: "Waste batches retrieved successfully";
  data: {
    batches: Array<{
      id: string;
      playerId: string;
      turnGenerated: number;
      generationTime: number;
      origin: "Residential" | "Commercial" | "Industrial";
      mass: number;
      composition: {
        paper: number;
        plastic: number;
        metal: number;
        glass: number;
        wood?: number;
      };
      status: "PENDING" | "DELIVERED" | "FAILED";
      collectionDeadline: number;
      lockToken: string | null;
      lockedAt: number | null;
    }>;
    wasteInventory: number;
    maxCapacity: number;
    budget: number;
  }
}
```

#### View Broker Materials
```typescript
GET /api/municipality/broker-materials/{sessionId}
Authorization: Bearer Token (Municipality only)

interface BrokerMaterialsResponse {
  success: true;
  message: "Broker materials retrieved successfully";
  data: {
    materials: Array<{
      id: string;
      type: string;
      quality: "A" | "B" | "C" | "F";
      mass: number;
      contamination: number;
      owner: "broker";
    }>;
    municipalityBudget: number;
  }
}
```

#### Place Material Order
```typescript
POST /api/municipality/place-order/{sessionId}
Authorization: Bearer Token (Municipality only)

interface PlaceOrderRequest {
  materialId: string;
  quantity: number;
}

interface PlaceOrderResponse {
  success: true;
  message: "Material order placed successfully";
  data: {
    gameState: {
      // Updated game state
    }
  }
}

// WebSocket Events Triggered:
// - material-ordered
// - game-state-update
```

#### Get City Projects
```typescript
GET /api/municipality/city-projects/{sessionId}
Authorization: Bearer Token (Municipality only)

interface CityProjectsResponse {
  success: true;
  message: "City projects retrieved successfully";
  data: {
    projects: Array<{
      id: string;
      name: string;
      requiredMaterials: {
        paper?: number;
        plastic?: number;
        metal?: number;
        glass?: number;
        wood?: number;
      };
      progress: number;
      completed: boolean;
      healthBonus: number;
      deadline: number;
    }>;
    municipalityInventory: Array<{
      id: string;
      type: string;
      quality: string;
      mass: number;
      owner: "municipality";
    }>;
  }
}
```

### MRF Endpoints

#### Process Waste
```typescript
POST /api/mrf/process-waste
Authorization: Bearer Token (MRF only)

interface ProcessWasteRequest {
  queueId: string;
  sessionId: string;
}

interface ProcessWasteResponse {
  success: true;
  message: "Waste processed successfully";
  data: {
    gameState: {
      // Updated game state with processing results
    }
  }
}

// WebSocket Events Triggered:
// - game-state-update
```

#### Assign Grade
```typescript
POST /api/mrf/assign-grade
Authorization: Bearer Token (MRF only)

interface AssignGradeRequest {
  materialId: string;
  grade: "A" | "B" | "C" | "F";
  sessionId: string;
}

interface AssignGradeResponse {
  success: true;
  message: "Grade assigned successfully";
  data: {
    gameState: {
      // Updated game state
    }
  }
}

// WebSocket Events Triggered:
// - game-state-update
```

#### Get MRF Queue
```typescript
GET /api/mrf/queue/{sessionId}
Authorization: Bearer Token (MRF only)

interface MRFQueueResponse {
  success: true;
  message: "MRF queue retrieved successfully";
  data: {
    queue: Array<{
      id: string;
      batchId: string;
      arrivalTime: number;
      delivered: boolean;
    }>;
  }
}
```

#### Get MRF Inventory
```typescript
GET /api/mrf/inventory/{sessionId}
Authorization: Bearer Token (MRF only)

interface MRFInventoryResponse {
  success: true;
  message: "MRF inventory retrieved successfully";
  data: {
    inventory: Array<{
      id: string;
      type: string;
      quality: "A" | "B" | "C" | "F";
      mass: number;
      contamination: number;
      owner: "mrf";
      listed: boolean;
    }>;
  }
}
```

### Broker Endpoints

#### Buy Material
```typescript
POST /api/broker/buy-material
Authorization: Bearer Token (Broker only)

interface BuyMaterialRequest {
  materialId: string;
  buyer: "municipality" | "broker";
  sessionId: string;
}

interface BuyMaterialResponse {
  success: true;
  message: "Material purchased successfully";
  data: {
    gameState: {
      // Updated game state
    }
  }
}

// WebSocket Events Triggered:
// - game-state-update
```

#### Use Material for Project
```typescript
POST /api/broker/use-material
Authorization: Bearer Token (Broker only)

interface UseMaterialRequest {
  materialId: string;
  projectId: string;
  sessionId: string;
}

interface UseMaterialResponse {
  success: true;
  message: "Material used for project";
  data: {
    gameState: {
      // Updated game state
    }
  }
}

// WebSocket Events Triggered:
// - game-state-update
```

#### Get Marketplace
```typescript
GET /api/broker/marketplace/{sessionId}
Authorization: Bearer Token (Broker only)

interface MarketplaceResponse {
  success: true;
  message: "Marketplace retrieved successfully";
  data: {
    marketplace: Array<{
      id: string;
      type: string;
      quality: "A" | "B" | "C" | "F";
      mass: number;
      contamination: number;
      owner: "mrf";
      listed: true;
    }>;
  }
}
```

#### Get Projects
```typescript
GET /api/broker/projects/{sessionId}
Authorization: Bearer Token (Broker only)

interface ProjectsResponse {
  success: true;
  message: "Projects retrieved successfully";
  data: {
    projects: Array<{
      id: string;
      name: string;
      requiredMaterials: {
        paper?: number;
        plastic?: number;
        metal?: number;
        glass?: number;
        wood?: number;
      };
      progress: number;
      completed: boolean;
      healthBonus: number;
      deadline: number;
    }>;
  }
}
```

#### Get Broker Inventory
```typescript
GET /api/broker/inventory/{sessionId}
Authorization: Bearer Token (Broker only)

interface BrokerInventoryResponse {
  success: true;
  message: "Broker inventory retrieved successfully";
  data: {
    inventory: Array<{
      id: string;
      type: string;
      quality: "A" | "B" | "C" | "F";
      mass: number;
      contamination: number;
      owner: "broker";
      listed: boolean;
    }>;
  }
}
```

#### Get Municipality Inventory
```typescript
GET /api/broker/municipality-inventory/{sessionId}
Authorization: Bearer Token (Broker only)

interface MunicipalityInventoryResponse {
  success: true;
  message: "Municipality inventory retrieved successfully";
  data: {
    inventory: Array<{
      id: string;
      type: string;
      quality: "A" | "B" | "C" | "F";
      mass: number;
      contamination: number;
      owner: "municipality";
      listed: boolean;
    }>;
  }
}
```

#### Sell to External Market
```typescript
POST /api/broker/sell-external
Authorization: Bearer Token (Broker only)

interface SellExternalRequest {
  materialId: string;
  sessionId: string;
}

interface SellExternalResponse {
  success: true;
  message: "Material sold to external market successfully";
  data: {
    gameState: {
      // Updated game state with revenue added to budget
    }
  }
}

// Usage
const sellToExternalMarket = async (
  materialId: string,
  sessionId: string
): Promise<SellExternalResponse> => {
  const response = await apiClient.post('/broker/sell-external', {
    materialId,
    sessionId
  });
  return response.json();
};

// WebSocket Events Triggered:
// - material-sold-external
// - game-state-update
```

#### Transfer to Municipality
```typescript
POST /api/broker/transfer-municipality
Authorization: Bearer Token (Broker only)

interface TransferMunicipalityRequest {
  materialId: string;
  projectId: string;
  sessionId: string;
}

interface TransferMunicipalityResponse {
  success: true;
  message: "Material transferred to municipality successfully";
  data: {
    gameState: {
      // Updated game state with material transferred
    }
  }
}

// Usage
const transferToMunicipality = async (
  materialId: string,
  projectId: string,
  sessionId: string
): Promise<TransferMunicipalityResponse> => {
  const response = await apiClient.post('/broker/transfer-municipality', {
    materialId,
    projectId,
    sessionId
  });
  return response.json();
};

// WebSocket Events Triggered:
// - material-transferred
// - game-state-update
```

#### Transfer to Municipality
```typescript
POST /api/broker/transfer-municipality
Authorization: Bearer Token (Broker only)

interface TransferMunicipalityRequest {
  materialId: string;
  projectId: string;
  sessionId: string;
}

interface TransferMunicipalityResponse {
  success: true;
  message: "Material transferred to municipality successfully";
  data: {
    gameState: {
      // Updated game state with material transferred
    }
  }
}

// Usage
const transferToMunicipality = async (
  materialId: string,
  projectId: string,
  sessionId: string
): Promise<TransferMunicipalityResponse> => {
  const response = await apiClient.post('/broker/transfer-municipality', {
    materialId,
    projectId,
    sessionId
  });
  return response.json();
};

// WebSocket Events Triggered:
// - material-transferred
// - game-state-update
```

#### Transfer to Municipality
```typescript
POST /api/broker/transfer-municipality
Authorization: Bearer Token (Broker only)

interface TransferMunicipalityRequest {
  materialId: string;
  projectId: string;
  sessionId: string;
}

interface TransferMunicipalityResponse {
  success: true;
  message: "Material transferred to municipality successfully";
  data: {
    gameState: {
      // Updated game state with material transferred
    }
  }
}

// Usage
const transferToMunicipality = async (
  materialId: string,
  projectId: string,
  sessionId: string
): Promise<TransferMunicipalityResponse> => {
  const response = await apiClient.post('/broker/transfer-municipality', {
    materialId,
    projectId,
    sessionId
  });
  return response.json();
};

// WebSocket Events Triggered:
// - game-state-update
```

#### Get Transaction History
```typescript
GET /api/broker/transactions/{sessionId}
Authorization: Bearer Token (Broker only)

interface TransactionHistoryResponse {
  success: true;
  message: "Transaction history retrieved successfully";
  data: {
    transactions: Array<{
      id: string;
      turn: number;
      buyer: string; // "broker", "municipality", or "External Market"
      seller: string; // "mrf", "broker", etc.
      itemType: string; // material type
      itemId: string;
      mass: number;
      price: number;
      transactionType: "external_sale" | "internal_transfer";
      revenue: number;
    }>;
  }
}

// Usage
const getTransactionHistory = async (sessionId: string): Promise<TransactionHistoryResponse> => {
  const response = await apiClient.get(`/broker/transactions/${sessionId}`);
  return response.json();
};
```

---

## Error Handling

### Standard Error Response
```typescript
interface ErrorResponse {
  success: false;
  message: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

### Error Handling Example
```typescript
const handleApiCall = async <T>(apiCall: Promise<Response>): Promise<T> => {
  try {
    const response = await apiCall;

    if (!response.ok) {
      const errorData: ErrorResponse = await response.json();
      throw new Error(errorData.message);
    }

    const data: T = await response.json();
    return data;
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
};

// Usage
try {
  const gameState = await handleApiCall<GameStateResponse>(
    apiClient.get(`/games/${sessionId}`)
  );
  // Handle success
} catch (error) {
  // Handle error - show user friendly message
  showErrorToast(error.message);
}
```

---

## Type Definitions

```typescript
// Core Types
type MaterialType = 'paper' | 'plastic' | 'metal' | 'glass' | 'wood';
type QualityGrade = 'A' | 'B' | 'C' | 'F';
type PlayerRole = 'municipality' | 'mrf' | 'broker';
type WasteOrigin = 'Residential' | 'Commercial' | 'Industrial';
type BatchStatus = 'PENDING' | 'DELIVERED' | 'FAILED';
type GameStatus = 'active' | 'won' | 'lost' | 'complete';

interface GameConstants {
  // Time & Session - UPDATED to match manual exactly
  REAL_TIME_GAME_DURATION_MINUTES: number; // 30 minutes real-world time
  GAME_DURATION_DAYS: number; // 7 game days
  WASTE_SPAWN_INTERVAL_MINUTES: number; // 2 minutes real-world time
  AUTO_SAVE_INTERVAL_SECONDS: number; // 30 seconds
  BATCH_COLLECTION_DEADLINE_MINUTES: number; // 10 minutes game time
  OVERDUE_BATCH_HEALTH_PENALTY: number; // 2% per overdue batch
  FIXED_DISTANCE_TO_MRF_KM: number; // 10 km fixed distance

  // Starting values
  STARTING_BUDGET: number;
  STARTING_HEALTH: number;
  WINNING_HEALTH: number;
  LOSING_HEALTH: number;

  // CO2 Factors (UPDATED to match manual exactly)
  CO2_TRANSPORT_FACTOR_PER_TON_KM: number; // 120 kg CO2 / ton / km
  CO2_PROCESSING_FACTOR_PER_TON_MIN: number; // 15 kg CO2 / ton / min
  CO2_DUMPING_FACTOR_PER_TON_MIN: number; // 250 kg CO2 / ton / min
  CO2_FACTOR_TRANSPORT: number; // 1.6 tons per truck
  CO2_FACTOR_LANDFILL: number; // 2.5 tons per ton

  // Costs (UPDATED to match manual exactly)
  TRANSPORT_COST_PER_TON_KM: number; // $2.50 / ton / km
  DUMPING_FEE: number; // $50 / ton
  OPERATING_COST: number; // $500 / shift

  // Material Properties (UPDATED to match manual table exactly - includes Wood)
  MATERIAL_PROPERTIES: {
    paper: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    plastic: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    metal: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    glass: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    wood: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
  };

  // Quality Multipliers - UPDATED to match manual exactly
  QUALITY_MULTIPLIERS: {
    material: {
      A: number; // 1.25x
      B: number; // 1.0x
      C: number; // 0.5x
    };
    waste: {
      B: number; // 0.3x
      C: number; // 0.2x
      F: number; // 0.1x
    };
  };

  // Health Calculation (UPDATED to match manual exactly)
  WASTE_PENALTY_THRESHOLD: number; // 100 tons
  CO2_PENALTY_THRESHOLD: number; // 200 tons
  HEALTH_PENALTY_PER_TON_OVER: number; // 1% per ton over waste threshold
  HEALTH_PENALTY_PER_50_TONS_CO2_OVER: number; // 1% per 50 tons over CO2 threshold
  PROJECT_COMPLETION_BONUS: number; // 5% per project

  // Game Over Countdown
  COUNTDOWN_DURATION_SECONDS: number; // 180 seconds (3 minutes)
  COUNTDOWN_RECOVERY_HEALTH_THRESHOLD: number; // 5%
  COUNTDOWN_RECOVERY_BUDGET_THRESHOLD: number; // $1,000
}

// Request/Response Interfaces
interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
}

interface GameState {
  sessionId: string;
  currentTurn: number;
  budget: number;
  cityHealth: number;
  totalCO2: number;
  wasteInventory: number;
  maxCapacity: number;
  constants: GameConstants;
  wasteBatches: WasteBatch[];
  mrfQueue: MRFQueue[];
  materialInventory: Material[];
  transactions: Transaction[];
  cityProjects: CityProject[];
  activityLog: string[];
  gameStatus: GameStatus;
  players: Record<PlayerRole, string>;
  playerNames: Record<PlayerRole, string>;
  // Real-time game mechanics
  gameStartTime: number;
  lastWasteSpawnTime: number;
  lastAutoSaveTime: number;
  minutesElapsed: number;
  currentGameDay: number;
  currentGameHour: number;
  // Active locks for concurrent processing prevention
  activeLocks: {
    [key: string]: {
      playerId: string;
      timestamp: number;
      type: 'batch' | 'queue' | 'material';
    };
  };
  // Pairing information for paired-team mode
  pairId?: string | null;
  partnerSessionId?: string | null;
  teamRole?: 'Team A' | 'Team B' | null;
  pairStatus?:
    | 'active'
    | 'team_a_eliminated'
    | 'team_b_eliminated'
    | 'completed'
    | null;
  // Pair data for frontend (included in game-state-full event)
  pairData?: PairDataPayload | null;
  // Game Over Countdown System
  gameOverCountdown: {
    active: boolean;
    startTime: number | null;
    reason: 'health' | 'budget' | 'time' | null;
  };
  // Transport tracking
  totalTransportTrips: number;
  totalLandfillTons: number;
}

interface WasteBatch {
  id: string;
  playerId: string; // Player who initiated collection
  turnGenerated: number;
  generationTime: number; // Timestamp when batch was generated
  origin: WasteOrigin;
  mass: number;
  composition: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood?: number;
  };
  status: BatchStatus;
  collectionDeadline: number; // Timestamp deadline for collection
  lockToken: string | null; // Lock token to prevent double processing
  lockedAt: number | null; // Timestamp when batch was locked
}

interface Material {
  id: string;
  type: MaterialType;
  materialOrWaste: boolean; // TRUE = material, FALSE = waste
  quality: QualityGrade;
  mass: number;
  contamination: number;
  owner: 'mrf' | 'broker' | 'municipality';
  listed: boolean;
}

interface MRFQueue {
  id: string;
  batchId: string;
  playerId: string; // Player who initiated MRF processing
  arrivalTime: number; // Timestamp
  delivered: boolean; // If TRUE, hide from "IN TRANSIT" list
  lockToken: string | null; // Lock token to prevent double processing
}

interface CityProject {
  id: string;
  name: string;
  requiredMaterials: Partial<Record<MaterialType, number>>;
  progress: number;
  completed: boolean;
  healthBonus: number;
  deadline: number;
}

// NEW: Pairing System Types
interface PairingStatus {
  isInQueue: boolean;
  position: number;
  estimatedWaitTime: number; // seconds
  isPaired: boolean;
  pairId: string | null;
  partnerSessionId: string | null;
  teamRole: 'Team A' | 'Team B' | null;
}

interface PartnerMetrics {
  sessionId: string;
  pairId: string;
  budget: number;
  cityHealth: number;
  totalCO2: number;
  currentTurn: number;
  gameStatus: GameStatus;
}

// NEW: Enhanced Transaction Types
interface Transaction {
  id: string;
  turn: number;
  buyer: string; // "broker", "municipality", or "External Market"
  seller: string; // "mrf", "broker", etc.
  itemType: MaterialType;
  itemId: string;
  mass: number;
  price: number;
  transactionType: 'external_sale' | 'internal_transfer';
  revenue: number;
}

// NEW: Notification Types
interface Notification {
  id: number;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

// NEW: Real-time Update Payload
interface RealtimeUpdatePayload {
  sessionId: string;
  currentBudget: number;
  totalCO2: number;
  wastePending: {
    batch_id: string;
    mass: number;
    deadline: string;
    status: string;
  } | null;
  materialAvailable: {
    item_id: string;
    type: string;
    grade: string;
    mass: number;
  } | null;
}

// NEW: Pair Data Payload
interface PairDataPayload {
  pairId: string;
  partnerSessionId: string;
  teamRole: 'Team A' | 'Team B';
  pairStatus: 'active' | 'team_a_eliminated' | 'team_b_eliminated' | 'completed';
  partnerHealth?: number;
  partnerBudget?: number;
  partnerCO2?: number;
  partnerGameStatus?: 'active' | 'lost' | 'complete';
}
```

---

## Integration Examples

### Complete Game Flow
```typescript
class BESSEGame {
  private sessionId: string | null = null;
  private userRole: PlayerRole | null = null;
  private webSocket: GameWebSocket;
  private pairingStatus: any = null;

  constructor(private token: string) {
    this.webSocket = new GameWebSocket();
    this.setupWebSocketListeners();
  }

  private setupWebSocketListeners() {
    this.webSocket.on('game-state-update', (data) => {
      this.handleGameStateUpdate(data.gameState);
    });

    this.webSocket.on('system-message', (data) => {
      this.showNotification(data.message, data.type);
    });

    // Pairing system event listeners
    this.webSocket.on('pairing-joined', (data) => {
      this.showNotification(`Joined pairing queue at position ${data.position}`, 'info');
      this.handlePairingJoined(data);
    });

    this.webSocket.on('pairing-status-update', (data) => {
      this.handlePairingStatusUpdate(data.status);
    });

    this.webSocket.on('teams-paired', (data) => {
      this.showNotification(`Teams paired! You are ${data.teamRole}`, 'success');
      this.handleTeamsPaired(data);
      // Update pairing status and transition to game
      this.pairingStatus = {
        isInQueue: false,
        position: 0,
        estimatedWaitTime: 0,
        isPaired: true,
        pairId: data.pairId,
        partnerSessionId: data.partnerSessionId,
        teamRole: data.teamRole,
      };
    });

    this.webSocket.on('partner-eliminated', (data) => {
      this.showNotification(`Partner team eliminated: ${data.reason}`, 'warning');
      this.handlePartnerEliminated(data);
    });

    this.webSocket.on('pairing-left', (data) => {
      this.showNotification('Left pairing queue', 'info');
      this.handlePairingLeft();
    });
  }

  async joinGame(lobbyCode?: string) {
    const requestBody = lobbyCode ? { lobbyCode } : {};
    const response = await apiClient.post('/lobby/join', requestBody);
    const data = await response.json();

    if (data.success) {
      this.sessionId = data.data.lobby.sessionId;
      this.webSocket.connect(this.token);
      this.webSocket.joinGame(this.sessionId);
      return data.data.lobby;
    }
  }

  async selectRole(role: PlayerRole) {
    const response = await apiClient.post('/lobby/select-role', {
      sessionId: this.sessionId,
      role
    });
    const data = await response.json();

    if (data.success) {
      this.userRole = role;
    }
    return data;
  }

  async startGame() {
    const response = await apiClient.post('/lobby/start-game', {
      sessionId: this.sessionId
    });
    return response.json();
  }

  // NEW: Pairing system methods
  async joinPairingQueue() {
    const response = await apiClient.post('/lobby/pairing/join', {
      sessionId: this.sessionId
    });
    return response.json();
  }

  async getPairingStatus() {
    const response = await apiClient.get(`/lobby/pairing/status/${this.sessionId}`);
    return response.json();
  }

  async getPartnerMetrics() {
    const response = await apiClient.get(`/lobby/pairing/partner/${this.sessionId}`);
    return response.json();
  }

  async leavePairingQueue() {
    const response = await apiClient.post('/lobby/pairing/leave', {
      sessionId: this.sessionId
    });
    return response.json();
  }

  async getGameState() {
    const response = await apiClient.get(`/games/${this.sessionId}`);
    return response.json();
  }

  // Role-specific actions
  async collectWaste(batchId: string) {
    const response = await apiClient.post(`/games/${this.sessionId}/collect-waste`, {
      batchId
    });
    return response.json();
  }

  async processWaste(queueId: string) {
    const response = await apiClient.post('/mrf/process-waste', {
      queueId,
      sessionId: this.sessionId
    });
    return response.json();
  }

  async buyMaterial(materialId: string, buyer: PlayerRole) {
    const response = await apiClient.post('/broker/buy-material', {
      materialId,
      buyer,
      sessionId: this.sessionId
    });
    return response.json();
  }

  // NEW: Enhanced broker methods
  async sellToExternalMarket(materialId: string) {
    const response = await apiClient.post('/broker/sell-external', {
      materialId,
      sessionId: this.sessionId
    });
    return response.json();
  }

  async transferToMunicipality(materialId: string, projectId: string) {
    const response = await apiClient.post('/broker/transfer-municipality', {
      materialId,
      projectId,
      sessionId: this.sessionId
    });
    return response.json();
  }

  async getTransactionHistory() {
    const response = await apiClient.get(`/broker/transactions/${this.sessionId}`);
    return response.json();
  }

  // NEW: Pair details methods
  async getPairDetails(pairId: string) {
    const response = await apiClient.get(`/games/pair/${pairId}/details`);
    return response.json();
  }

  // NEW: Get real-time update payload
  getRealtimeUpdate() {
    // Access from latest game-state-full event
    return this.gameState?.realtimeUpdate;
  }

  private handleGameStateUpdate(gameState: GameState) {
    // Update UI with new game state
    this.updateUI(gameState);

    // Check win/lose conditions - game ends at 30 min with win/lose based on pair health >= 60%
    if (gameState.gameStatus !== 'active') {
      this.handleGameEnd(gameState.gameStatus);
    }
  }

  private updateUI(gameState: GameState) {
    // Update budget, health, CO2 displays
    // Update player inventories
    // Update available actions based on role
  }

  private showNotification(message: string, type: string) {
    // Show toast notification
  }

  private handleGameEnd(status: GameStatus) {
    // Show win/lose screen
    // Clean up game session
  }

  // Pairing system event handlers
  private handlePairingJoined(data: any) {
    // Update local pairing status
    this.pairingStatus = {
      isInQueue: true,
      position: data.position,
      estimatedWaitTime: data.estimatedWaitTime,
      isPaired: false,
      pairId: null,
      partnerSessionId: null,
      teamRole: null,
    };
  }

  private handlePairingStatusUpdate(status: any) {
    // Update pairing status
    this.pairingStatus = { ...this.pairingStatus, ...status };
  }

  private handleTeamsPaired(data: any) {
    // Update pairing status with pair information
    this.pairingStatus = {
      isInQueue: false,
      position: 0,
      estimatedWaitTime: 0,
      isPaired: true,
      pairId: data.pairId,
      partnerSessionId: data.partnerSessionId,
      teamRole: data.teamRole,
    };

    // Start game or transition to paired state
    this.handleTeamsPairedTransition(data);
  }

  private handlePartnerEliminated(data: any) {
    // Update pairing status to reflect partner elimination
    if (this.pairingStatus) {
      this.pairingStatus.pairStatus = 'Partner Eliminated';
    }

    // Handle UI updates for partner elimination
    this.handlePartnerElimination(data);
  }

  private handlePairingLeft() {
    // Clear pairing status
    this.pairingStatus = null;
  }

  private handleTeamsPairedTransition(data: any) {
    // Transition to game start or paired lobby
    // This could trigger navigation to game screen or update UI
  }

  private handlePartnerElimination(data: any) {
    // Update UI to show partner eliminated status
    // Could show different game end conditions or continue solo
  }

  // Public getter for pairing status
  getPairingStatus() {
    return this.pairingStatus;
  }
}
```

### React Component Example
```typescript
import React, { useState, useEffect } from 'react';

export const GameDashboard: React.FC<{ sessionId: string; token: string }> = ({
  sessionId,
  token
}) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const game = new BESSEGame(token);

    const loadGameState = async () => {
      try {
        const response = await game.getGameState();
        if (response.success) {
          setGameState(response.data.gameState);
        }
      } catch (error) {
        console.error('Failed to load game state:', error);
      } finally {
        setLoading(false);
      }
    };

    loadGameState();

    // WebSocket will handle real-time updates
    game.joinGame(sessionId);

    return () => {
      game.cleanup();
    };
  }, [sessionId, token]);

  if (loading) return <div>Loading game...</div>;
  if (!gameState) return <div>Failed to load game</div>;

  return (
    <div className="game-dashboard">
      <div className="game-stats">
        <div>Budget: ${gameState.budget}</div>
        <div>Health: {gameState.cityHealth}%</div>
        <div>CO2: {gameState.totalCO2} tons</div>
        <div>Day: {gameState.currentGameDay}</div>
      </div>

      {/* Role-specific UI components */}
      <RoleInterface gameState={gameState} />
    </div>
  );
};
```

### State Management Patterns

#### Game State Management with Zustand
```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface GameStore {
  // Authentication
  token: string | null;
  user: any | null;

  // Lobby state
  currentLobby: any | null;
  selectedRole: PlayerRole | null;

  // Pairing state
  pairingStatus: {
    isInQueue: boolean;
    position: number;
    estimatedWaitTime: number;
    isPaired: boolean;
    pairId: string | null;
    partnerSessionId: string | null;
    teamRole: 'Team A' | 'Team B' | null;
  } | null;

  // Game state
  gameState: GameState | null;
  partnerMetrics: any | null;
  realtimeUpdate: RealtimeUpdatePayload | null;
  pairData: PairDataPayload | null;

  // UI state
  notifications: Notification[];
  isConnected: boolean;
  connectionError: string | null;

  // Actions
  setToken: (token: string | null) => void;
  setUser: (user: any) => void;
  setCurrentLobby: (lobby: any) => void;
  setSelectedRole: (role: PlayerRole | null) => void;
  setPairingStatus: (status: any) => void;
  setGameState: (state: GameState | null) => void;
  setRealtimeUpdate: (update: RealtimeUpdatePayload | null) => void;
  setPartnerMetrics: (metrics: any) => void;
  addNotification: (notification: Notification) => void;
  clearNotifications: () => void;
  setConnectionStatus: (connected: boolean, error?: string) => void;
}

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    token: null,
    user: null,
    currentLobby: null,
    selectedRole: null,
    pairingStatus: null,
    gameState: null,
    partnerMetrics: null,
    realtimeUpdate: null,
    pairData: null,
    notifications: [],
    isConnected: false,
    connectionError: null,

    // Actions
    setToken: (token) => set({ token }),
    setUser: (user) => set({ user }),
    setCurrentLobby: (lobby) => set({ currentLobby: lobby }),
    setSelectedRole: (role) => set({ selectedRole: role }),

    setPairingStatus: (status) => set({ pairingStatus: status }),

    setGameState: (state) => set({ gameState: state }),
    setRealtimeUpdate: (update) => set({ realtimeUpdate: update }),
    setPairData: (pairData) => set({ pairData }),

    setPartnerMetrics: (metrics) => set({ partnerMetrics: metrics }),

    addNotification: (notification) =>
      set((state) => ({
        notifications: [...state.notifications.slice(-4), notification]
      })),

    clearNotifications: () => set({ notifications: [] }),

    setConnectionStatus: (connected, error) =>
      set({ isConnected: connected, connectionError: error || null }),
  }))
);

// Selectors for computed values
export const useGameStats = () =>
  useGameStore((state) => {
    if (!state.gameState) return null;
    return {
      budget: state.gameState.budget,
      health: state.gameState.cityHealth,
      co2: state.gameState.totalCO2,
      day: state.gameState.currentGameDay,
      turn: state.gameState.currentTurn,
    };
  });

export const usePairingInfo = () =>
  useGameStore((state) => ({
    isPaired: state.pairingStatus?.isPaired || false,
    teamRole: state.pairingStatus?.teamRole || null,
    partnerMetrics: state.partnerMetrics,
    pairData: state.pairData,
  }));

export const useGameNotifications = () =>
  useGameStore((state) => state.notifications);
```

#### Pairing System Integration
```typescript
import { useGameStore } from './store/gameStore';
import { useGameWebSocket } from './hooks/useGameWebSocket';

export const usePairingSystem = () => {
  const {
    pairingStatus,
    setPairingStatus,
    addNotification,
    token,
    currentLobby
  } = useGameStore();

  const { isConnected, realtimeUpdate, pairData } = useGameWebSocket(token, currentLobby?.sessionId, setPairingStatus, setRealtimeUpdate, setPairData);

  const joinPairingQueue = async () => {
    if (!currentLobby?.sessionId) return;

    try {
      const response = await apiClient.post('/lobby/pairing/join', {
        sessionId: currentLobby.sessionId
      });

      if (response.success) {
        setPairingStatus({
          isInQueue: true,
          position: response.data.result.position || 1,
          estimatedWaitTime: response.data.result.estimatedWaitTime || 30,
          isPaired: false,
          pairId: null,
          partnerSessionId: null,
          teamRole: null,
        });
        addNotification({
          id: Date.now(),
          message: 'Joined pairing queue',
          type: 'info'
        });
      }
    } catch (error) {
      addNotification({
        id: Date.now(),
        message: 'Failed to join pairing queue',
        type: 'error'
      });
    }
  };

  const checkPairingStatus = async () => {
    if (!currentLobby?.sessionId || !pairingStatus?.isInQueue) return;

    try {
      const response = await apiClient.get(
        `/lobby/pairing/status/${currentLobby.sessionId}`
      );

      if (response.success) {
        const status = response.data.status;
        setPairingStatus({
          ...pairingStatus,
          ...status,
        });

        if (status.isPaired && !pairingStatus.isPaired) {
          addNotification({
            id: Date.now(),
            message: 'Teams paired! Game starting soon.',
            type: 'success'
          });
        }
      }
    } catch (error) {
      console.error('Failed to check pairing status:', error);
    }
  };

  // Auto-check pairing status every 5 seconds when in queue
  React.useEffect(() => {
    if (!pairingStatus?.isInQueue || pairingStatus?.isPaired) return;

    const interval = setInterval(checkPairingStatus, 5000);
    return () => clearInterval(interval);
  }, [pairingStatus?.isInQueue, pairingStatus?.isPaired]);

  return {
    pairingStatus,
    joinPairingQueue,
    checkPairingStatus,
    pairData,
  };
};
```

#### Enhanced Broker Dashboard Component
```typescript
import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

export const BrokerDashboard: React.FC = () => {
  const { gameState, token } = useGameStore();
  const [marketplace, setMarketplace] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [brokerInventory, setBrokerInventory] = useState([]);

  useEffect(() => {
    if (gameState?.sessionId) {
      loadBrokerData();
    }
  }, [gameState?.sessionId]);

  const loadBrokerData = async () => {
    try {
      const [marketplaceRes, inventoryRes, transactionsRes] = await Promise.all([
        apiClient.get(`/broker/marketplace/${gameState.sessionId}`),
        apiClient.get(`/broker/inventory/${gameState.sessionId}`),
        apiClient.get(`/broker/transactions/${gameState.sessionId}`)
      ]);

      if (marketplaceRes.success) setMarketplace(marketplaceRes.data.marketplace);
      if (inventoryRes.success) setBrokerInventory(inventoryRes.data.inventory);
      if (transactionsRes.success) setTransactions(transactionsRes.data.transactions);
    } catch (error) {
      console.error('Failed to load broker data:', error);
    }
  };

  const sellToExternalMarket = async (materialId: string) => {
    try {
      const response = await apiClient.post('/broker/sell-external', {
        materialId,
        sessionId: gameState.sessionId
      });

      if (response.success) {
        // WebSocket will update the state automatically
        // No need to manually refresh
      }
    } catch (error) {
      console.error('Failed to sell material:', error);
    }
  };

  const transferToMunicipality = async (materialId: string, projectId: string) => {
    try {
      const response = await apiClient.post('/broker/transfer-municipality', {
        materialId,
        projectId,
        sessionId: gameState.sessionId
      });

      if (response.success) {
        // WebSocket will update the state automatically
        // No need to manually refresh
      }
    } catch (error) {
      console.error('Failed to transfer material:', error);
    }
  };

  return (
    <div className="broker-dashboard">
      <div className="broker-stats">
        <h3>Broker Dashboard</h3>
        <div className="stats-grid">
          <div>Team Budget: ${gameState?.budget || 0}</div>
          <div>Materials in Inventory: {brokerInventory.length}</div>
          <div>Marketplace Listings: {marketplace.length}</div>
          <div>Total Transactions: {transactions.length}</div>
        </div>
      </div>

      <div className="marketplace-section">
        <h4>Marketplace</h4>
        {marketplace.map((material: any) => (
          <div key={material.id} className="marketplace-item">
            <span>{material.mass}t {material.type} (Grade {material.quality})</span>
            <button onClick={() => sellToExternalMarket(material.id)}>
              Sell to Market
            </button>
          </div>
        ))}
      </div>

      <div className="inventory-section">
        <h4>Broker Inventory</h4>
        {brokerInventory.map((material: any) => (
          <div key={material.id} className="inventory-item">
            <span>{material.mass}t {material.type} (Grade {material.quality})</span>
            {/* Add transfer to municipality functionality */}
          </div>
        ))}
      </div>

      <div className="transactions-section">
        <h4>Transaction History</h4>
        {transactions.slice(-10).reverse().map((transaction: any) => (
          <div key={transaction.id} className="transaction-item">
            <span>Turn {transaction.turn}: {transaction.buyer} bought {transaction.mass}t {transaction.itemType} for ${transaction.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### Pairing System React Component Example

```typescript
import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { usePairingSystem } from '../hooks/usePairingSystem';

export const PairingLobby: React.FC = () => {
  const { currentLobby, token } = useGameStore();
  const { pairingStatus, joinPairingQueue, checkPairingStatus, pairData } = usePairingSystem();
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    // Auto-check pairing status every 10 seconds when in queue
    if (pairingStatus?.isInQueue && !pairingStatus?.isPaired) {
      const interval = setInterval(checkPairingStatus, 10000);
      return () => clearInterval(interval);
    }
  }, [pairingStatus?.isInQueue, pairingStatus?.isPaired, checkPairingStatus]);

  const handleJoinQueue = async () => {
    setIsJoining(true);
    try {
      await joinPairingQueue();
    } catch (error) {
      console.error('Failed to join pairing queue:', error);
    } finally {
      setIsJoining(false);
    }
  };

  if (!currentLobby) {
    return <div>Please join a lobby first</div>;
  }

  return (
    <div className="pairing-lobby">
      <h2>Team Pairing</h2>

      {!pairingStatus?.isInQueue && !pairingStatus?.isPaired && (
        <div className="queue-waiting">
          <p>Waiting for all team members to complete role selection...</p>
          <button
            onClick={handleJoinQueue}
            disabled={isJoining}
            className="join-queue-btn"
          >
            {isJoining ? 'Joining Queue...' : 'Join Pairing Queue'}
          </button>
        </div>
      )}

      {pairingStatus?.isInQueue && !pairingStatus?.isPaired && (
        <div className="in-queue">
          <h3>In Pairing Queue</h3>
          <p>Position: {pairingStatus.position}</p>
          <p>Estimated wait time: {Math.ceil(pairingStatus.estimatedWaitTime / 60)} minutes</p>
          <div className="queue-spinner">Waiting for another team...</div>
        </div>
      )}

      {pairingStatus?.isPaired && (
        <div className="paired">
          <h3>Teams Paired!</h3>
          <p>You are: <strong>{pairingStatus.teamRole}</strong></p>
          <p>Partner Team: {pairingStatus.partnerSessionId}</p>
          <p>Pair ID: {pairingStatus.pairId}</p>
          {pairData && (
            <div className="partner-status">
              <h4>Partner Status:</h4>
              <p>Health: {pairData.partnerHealth}%</p>
              <p>Budget: ${pairData.partnerBudget}</p>
              <p>CO2: {pairData.partnerCO2} tons</p>
              <p>Status: {pairData.partnerGameStatus}</p>
            </div>
          )}
          <button className="start-game-btn">Start Competitive Game</button>
        </div>
      )}

      {pairingStatus?.pairStatus === 'Partner Eliminated' && (
        <div className="partner-eliminated">
          <h3>Partner Team Eliminated</h3>
          <p>Your score will represent the pair.</p>
          <p>Continue playing to maximize your team's performance.</p>
        </div>
      )}
    </div>
  );
};
```

This integration guide provides everything needed to build a complete BESSE frontend application with real-time multiplayer capabilities, team pairing system, and comprehensive broker trading features.