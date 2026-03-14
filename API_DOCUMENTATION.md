# BESSE Backend API Documentation

A comprehensive RESTful API with **WebSocket real-time capabilities** for the **BESSE** circular economy simulation game, featuring cooperative gameplay where three specialized roles (Municipality, MRF, Broker) work together to manage urban waste systems and balance competing objectives: **Budget ($)**, **City Health (%)**, and **CO₂ Emissions**.

## 🚀 **New Features (Latest Update)**

- **🔌 WebSocket Real-Time Updates**: Live game state synchronization
- **🎯 6-Character Lobby Codes**: Unique alphanumeric codes for joining games
- **👑 Lobby Leadership**: Automatic leader assignment for lobby creators
- **🔒 Active Lock Mechanisms**: Prevent concurrent processing conflicts
- **📡 Real-Time Broadcasting**: Instant updates for all game events
- **⚡ Automated System Checks**: Background process every 30 seconds
- **🩺 Dynamic Health Recalculation**: Real-time health updates after every action
- **♻️ Enhanced Waste Rejection**: Proper CO2 emissions and health penalty calculations
- **📊 Comprehensive Activity Logging**: Detailed breakdowns of all game changes
- **👥 Team Pairing System**: Automatic pairing of teams for competitive gameplay
- **📋 Game Logic Manual**: Complete backend logic documentation with formulas and workflows
- **🔄 Pairing Queue Management**: Join/leave pairing queues with status tracking
- **🤝 Partner Team Metrics**: Real-time monitoring of paired team performance
- **📈 Enhanced Broker Transactions**: External sales and municipality transfers

## 🎮 Game Overview

**BESSE** is a 30-minute real-time multiplayer simulation where players cooperate to:
- **🏛️ Municipality**: Collect and transport waste from city streets
- **🏭 MRF**: Process waste into recyclable materials with quality grading
- **💼 Broker**: Trade materials and allocate resources to city projects

**Win Condition**: Maintain city health above 60% after 7 game days (30 minutes real-time).

---

## Table of Contents

- [Getting Started](#getting-started)
- [Authentication](#authentication)
- [WebSocket Real-Time API](#websocket-real-time-api)
- [Game Mechanics](#game-mechanics)
- [Game Logic Manual](#game-logic-manual)
- [Endpoints](#endpoints)
  - [Authentication Routes](#1-authentication-routes-apiauth)
  - [Lobby Routes](#2-lobby-routes-apilobby)
  - [Game Routes](#3-game-routes-apigames)
  - [Municipality Routes](#4-municipality-routes-apimunicipality)
  - [MRF Routes](#5-mrf-routes-apimrf)
  - [Broker Routes](#6-broker-routes-apibroker)
- [Data Models](#data-models)
- [Error Handling](#error-handling)
- [Response Codes](#response-codes)
- [Game Flow](#game-flow)
- [Quick Start Examples](#quick-start-examples)
- [Best Practices](#best-practices)

---

## Game Logic Manual

For detailed game logic, calculations, workflows, and backend mechanics, refer to the [GAME_LOGIC_MANUAL.md](GAME_LOGIC_MANUAL.md) file. This comprehensive manual covers:

- Game initialization and constants
- Real-time system updates and cycles
- Role-specific workflows (Municipality, MRF, Broker)
- Health and CO2 calculation formulas
- Win/lose conditions and countdown mechanics
- Active lock mechanisms for concurrency control
- Material processing and quality grading
- Transaction logic and market dynamics

---

## WebSocket Real-Time API

BESSE features **real-time multiplayer capabilities** through WebSocket connections, enabling instant synchronization of game state across all connected players.

### Connection Setup

**WebSocket URL**: `ws://localhost:5000` (or `wss://` for production)

**Authentication**: Include JWT token in connection handshake
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: {
    token: 'your_jwt_token_here'
  }
});
```

### Room Management

Games are organized into **session-based rooms** for isolated multiplayer experiences:

```javascript
// Join a game room
socket.emit('join-game', {
  sessionId: 'game_session_uuid'
});

// Leave a game room
socket.emit('leave-game', {
  sessionId: 'game_session_uuid'
});
```

### Real-Time Events

#### 📥 **Incoming Events (Listen)**

| Event | Description | Payload |
|-------|-------------|---------|
| `joined-game` | Successfully joined game room | `{ sessionId, userId, userName }` |
| `game-state-update` | Full game state synchronization | `{ sessionId, gameState, timestamp }` |
| `waste-collected` | Waste collection completed | `{ sessionId, gameState, timestamp }` |
| `waste-rejected` | Waste rejection completed | `{ sessionId, gameState, timestamp }` |
| `material-ordered` | Material order placed | `{ sessionId, gameState, timestamp }` |
| `system-check-update` | Automatic system updates (30s) | `{ sessionId, gameState, timestamp }` |
| `turn-ended` | Turn progression | `{ sessionId, gameState, timestamp }` |
| `system-message` | Info/warning/error messages | `{ message, type, timestamp }` |
| `player-action` | Player activity notifications | `{ playerId, playerName, action, details, timestamp }` |
| `error` | Error notifications | `{ message }` |

#### 📤 **Outgoing Events (Emit)**

| Event | Description | Payload |
|-------|-------------|---------|
| `join-game` | Join game room | `{ sessionId }` |
| `leave-game` | Leave game room | `{ sessionId }` |

### Event Examples

```javascript
// Listen for game state updates
socket.on('game-state-update', (data) => {
  console.log('Game state updated:', data.gameState);
  updateUI(data.gameState);
});

// Listen for system messages
socket.on('system-message', (data) => {
  showNotification(data.message, data.type);
});

// Listen for player actions
socket.on('player-action', (data) => {
  console.log(`${data.playerName} performed: ${data.action}`);
});

// Handle errors
socket.on('error', (data) => {
  console.error('WebSocket error:', data.message);
  showError(data.message);
});
```

### Real-Time Features

- **🔄 Live Synchronization**: All players see game state changes instantly
- **📢 System Notifications**: Automatic waste spawning, health penalties
- **👥 Player Activity**: Real-time feedback on other players' actions
- **⚡ Performance**: Room-based broadcasting prevents cross-game interference
- **🔐 Security**: JWT authentication required for all connections

### Connection Lifecycle

```javascript
socket.on('connect', () => {
  console.log('Connected to BESSE server');
  // Join game room after connection
  socket.emit('join-game', { sessionId: 'your_session_id' });
});

socket.on('disconnect', () => {
  console.log('Disconnected from BESSE server');
  // Handle reconnection logic
});

socket.on('connect_error', (error) => {
  console.error('Connection failed:', error);
  // Handle connection errors
});
```

### Best Practices

- **Connection Management**: Implement automatic reconnection
- **Room Isolation**: Each game session has its own WebSocket room
- **Error Handling**: Listen for `error` events and handle gracefully
- **State Sync**: Use REST API for initial state, WebSocket for updates
- **Performance**: WebSocket events are lightweight and frequent

---

## Getting Started

**Base URL**
```
http://localhost:5000/api
```

**Authentication**
All endpoints except `/api/auth/register` and `/api/auth/login` require JWT authentication via the `Authorization` header:
```
Authorization: Bearer <your_jwt_token>
```

**Rate Limiting**
- Authentication routes: 5 requests per 15 minutes
- General API routes: 100 requests per 15 minutes

---

## Game Mechanics

### Core Objectives
BESSE is a cooperative game where three players balance three competing metrics:

| Metric | Starting Value | Target | Critical Threshold |
|--------|----------------|--------|-------------------|
| **Budget** | $10,000 | Maximize | $0 (game over) |
| **City Health** | 100% | ≥60% to win | ≤30% (game over) |
| **CO₂ Emissions** | 0 tons | Minimize | >200 tons penalty |

### Game Timeline
- **Real Duration**: 30 minutes
- **Game Duration**: 7 days (4.28 minutes per game day)
- **Waste Generation**: Every 2 minutes (creates new collection tasks)
- **System Updates**: Every 30 seconds (automatic background process)
- **Health Recalculation**: After every player action (real-time updates)

### Role Responsibilities

#### 🏛️ Municipality
- **Primary Function**: Waste collection and transportation
- **Key Actions**: Collect waste batches, manage transport logistics
- **Costs**: $2.50/ton/km transport + $50/ton disposal fees
- **Environmental Impact**: 1.6 tons CO₂ per transport trip

#### 🏭 MRF (Material Recovery Facility)
- **Primary Function**: Waste processing and material quality assessment
- **Key Actions**: Process waste into materials, assign quality grades (A/B/C/F)
- **Costs**: $50/ton disposal fees for unusable waste
- **Environmental Impact**: 15 kg CO₂ per ton processed + landfill emissions

#### 💼 Broker
- **Primary Function**: Material trading and resource allocation
- **Key Actions**: Buy/sell materials, allocate resources to city projects
- **Revenue Streams**: External market sales, project completions
- **Market Dynamics**: Quality-based pricing (A: 1.25x, B: 1.0x, C: 0.5x base price)

### Material Economics

| Material | Base Price | Process Rate | Waste Rate | CO₂ Profile |
|----------|------------|--------------|------------|-------------|
| Paper | $180/ton | 85% | 15% | Low |
| Plastic | $350/ton | 80% | 20% | High |
| Metal | $600/ton | 90% | 10% | Medium |
| Glass | $120/ton | 75% | 25% | Low |
| Wood | $100/ton | 90% | 10% | Medium |

### Win/Loss Conditions
- **Victory**: City Health ≥60% after 7 game days
- **Defeat**: City Health ≤30% OR Budget ≤$0
- **Countdown**: 3-minute recovery period when thresholds breached

### Real-Time Systems
- **Waste Generation**: Automatic every 2 minutes
- **Health Recalculation**: Dynamic calculation after every action
- **System Checks**: Automatic background process every 30 seconds
- **Lock Management**: Active locks prevent concurrent processing conflicts
- **CO2 Tracking**: Real-time emissions from all actions (transport, processing, landfill)
- **Activity Logging**: Detailed breakdowns of all game state changes

---

## Authentication

### 1.1 Register User

Register a new user account.

**Request:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
 -H "Content-Type: application/json" \
 -d '{
"name": "Player One",
"email": "player1@example.com",
"password": "password123"
}'
```

**Response (201):**
```bash
{
"success": true,
"message": "User registered successfully",
"data": {
"user": {
"\_id": "user_id",
"name": "Player One",
"email": "player1@example.com",
"role": "player",
"createdAt": "2024-01-01T00:00:00.000Z",
"updatedAt": "2024-01-01T00:00:00.000Z"
}
}
}
```

---

### 1.2 Login User

Authenticate user and receive JWT token.

**Request:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
 -H "Content-Type: application/json" \
 -d '{
"email": "player1@example.com",
"password": "password123"
}'
```

**Response (200):**
```bash
{
"success": true,
"message": "Login successful",
"data": {
"user": {
"\_id": "user_id",
"name": "Player One",
"email": "player1@example.com",
"role": "player"
},
"token": "jwt_token_here"
}
}
```

---

### 1.3 Get User Profile

Get current user's profile information.

**Request:**
```bash
curl -X GET http://localhost:5000/api/auth/profile \
 -H "Authorization: Bearer <jwt_token>" \
 -H "Content-Type: application/json"
```

**Response (200):**
```bash
{
"success": true,
"message": "Profile retrieved successfully",
"data": {
"user": {
"\_id": "user_id",
"name": "Player One",
"email": "player1@example.com",
"role": "player",
"currentSession": "session_id_or_null"
}
}
}
```

---

## Endpoints

### 1. Lobby Routes (`/api/lobby`)

#### 1.1 Get Available Lobbies

Get list of available lobbies that players can join.

#### 1.2 Create or Join Lobby

**🎯 New Feature**: Create a new lobby (automatically become leader) or join an existing lobby using a unique 6-character alphanumeric code.

#### 1.3 Select Role

Select a role in the lobby (first-come, first-served).

#### 1.4 Deselect Role

Deselect your currently chosen role.

#### 1.5 Get Lobby State

Get current state of a specific lobby.

#### 1.6 Leave Lobby

Leave the current lobby.

#### 1.7 Start Game

Start the game when all 3 roles are assigned.

#### 1.8 Join Pairing Queue

Join the pairing queue after role selection is complete.

#### 1.9 Get Pairing Queue Status

Get current pairing queue status for a team.

#### 1.10 Leave Pairing Queue

Leave the pairing queue if not yet paired.

#### 1.11 Force Pairing Check (Admin)

Manually trigger the pairing algorithm to create pairs.

#### 1.12 Get Partner Team Metrics

Get current game state metrics of the paired partner team.

#### 1.13 Get Pairing Result

Get pairing result and status for a team.

### 2. Game Routes (`/api/games`)

#### 2.1 Get User Games

Get all game sessions for the current user.

**Request:**
```bash
curl -X GET http://localhost:5000/api/games/user-games \
 -H "Authorization: Bearer <jwt_token>"
```

**Response (200):**
```bash
{
"success": true,
"message": "User games retrieved successfully",
"data": {
"gameSessions": [
{
"_id": "session_id",
"sessionId": "session_uuid",
"players": {
"municipality": "user_id",
"mrf": "user_id",
"broker": "user_id"
},
"playerNames": {
"municipality": "Player One",
"mrf": "Player Two",
"broker": "Player Three"
},
"createdAt": "2024-01-01T00:00:00.000Z"
}
]
}
}
```

---

#### 2.2 Get Game State

Get the current state of a game session.

**Request:**
```bash
curl -X GET http://localhost:5000/api/games/session_uuid \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Game state retrieved successfully",
"data": {
"gameState": {
"sessionId": "session_uuid",
"currentTurn": 1,
"budget": 8750.50,
"cityHealth": 95.5,
"totalCO2": 142.8,
"totalTransportTrips": 12,
"totalLandfillTons": 25.3,
"gameStatus": "active",
"players": {
"municipality": "user_id_1",
"mrf": "user_id_2",
"broker": "user_id_3"
},
"playerNames": {
"municipality": "Player One",
"mrf": "Player Two",
"broker": "Player Three"
},
"currentGameDay": 1,
"currentGameHour": 6,
"minutesElapsed": 8.5,
"gameOverCountdown": {
"active": false,
"startTime": null,
"reason": null
},
"activityLog": [
"[Day 1 - Hour 6] New waste batch generated: 15.5 tons Residential",
"[Municipality] Collected 15.5 tons Residential waste. Cost: $387.50, CO2: +1.6t"
]
},
"userRole": "municipality",
"userRoles": ["municipality"],
"countdownTimeRemaining": null
}
}
```

---

#### 2.3 Get Player Role

Get the current user's role in a specific game session.

**Request:**
```bash
curl -X GET http://localhost:5000/api/games/session_uuid/player-role \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Player role retrieved successfully",
"data": {
"role": "municipality"
}
}
```

---

#### 2.4 End Turn

End the current turn and progress to the next turn.

**Request:**
```bash
curl -X POST http://localhost:5000/api/games/session_uuid/end-turn \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Turn ended successfully",
"data": {
"gameState": {},
"userRole": "municipality"
}
}
```

---

### 3. Municipality Routes (`/api/municipality`)

#### 3.1 Collect Waste

Collect waste batch and send to MRF. **Municipality role only.**

**Request:**
```bash
curl -X POST http://localhost:5000/api/games/session_uuid/collect-waste \
  -H "Authorization: Bearer <municipality_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
"batchId": "waste_batch_id"
}'
```

**🔄 Real-Time Update**: Triggers `waste-collected` WebSocket event to all players

**Response (200):**
```bash
{
"success": true,
"message": "Waste collected successfully",
"data": {
"gameState": {}
}
}
```

---

#### 3.2 Reject Waste

Reject waste batch (direct landfill disposal with CO2 emissions and health recalculation). **Municipality role only.**

**Environmental Impact:**
- **CO2 Emissions**: `mass × 2.5 tons` (landfill factor)
- **Health Recalculation**: Automatic penalty calculation based on current waste levels
- **Status Change**: `PENDING → FAILED`

**Request:**
```bash
curl -X POST http://localhost:5000/api/municipality/reject-waste \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
"batchId": "waste_batch_id",
"sessionId": "session_uuid"
}'
```

**🔄 Real-Time Update**: Triggers `waste-rejected` WebSocket event with full health recalculation

**Response (200):**
```bash
{
"success": true,
"message": "Waste rejected",
"data": {
"gameState": {
"budget": 10000,
"cityHealth": 97.5,
"totalCO2": 38.75,
"totalLandfillTons": 15.5,
"activityLog": [
"[Municipality] Rejected 15.5 tons Residential waste. CO2: +38.75 tons (landfill)",
"[System] Health recalculated: -2.5% (now 97.5%) | Waste: -1.2% (12.3t uncollected) | CO2: -1.3% (38.75t total)"
]
}
}
}
```

---

#### 3.3 Get Waste Batches

Get all pending waste batches. **Municipality role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/municipality/waste-batches/session_uuid \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Waste batches retrieved successfully",
"data": {
"batches": [
{
"id": "waste_batch_id",
"turnGenerated": 1,
"origin": "Residential",
"mass": 15.5,
"composition": {
"paper": 0.4,
"plastic": 0.3,
"metal": 0.2,
"glass": 0.1
},
"status": "PENDING",
"deadline": 4
}
],
"wasteInventory": 25.5,
"maxCapacity": 150,
"budget": 8500
}
}
```

---

#### 3.4 View Broker Materials

View materials available from broker for ordering. **Municipality role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/municipality/broker-materials/session_uuid \
  -H "Authorization: Bearer <municipality_jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
  "success": true,
  "message": "Broker materials retrieved successfully",
  "data": {
    "materials": [
      {
        "id": "m-xyz789",
        "type": "paper",
        "quality": "A",
        "mass": 15.5,
        "contamination": 0.02,
        "owner": "broker"
      }
    ],
    "municipalityBudget": 8500.00
  }
}
```

---

#### 3.5 Place Material Order

Order materials from broker for city projects. **Municipality role only.**

**Request:**
```bash
curl -X POST http://localhost:5000/api/municipality/place-order/session_uuid \
  -H "Authorization: Bearer <municipality_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "materialId": "m-xyz789",
    "quantity": 10.0
  }'
```

**Path Parameters:** `sessionId` - The game session ID

**Request Body:**
- `materialId` (string, required): Material identifier
- `quantity` (number, required): Quantity to order in tons

**Response (200):**
```bash
{
  "success": true,
  "message": "Material order placed successfully",
  "data": {
    "gameState": {}
  }
}
```

---

#### 3.6 Get City Projects

View city projects and material requirements. **Municipality role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/municipality/city-projects/session_uuid \
  -H "Authorization: Bearer <municipality_jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
  "success": true,
  "message": "City projects retrieved successfully",
  "data": {
    "projects": [
      {
        "id": "park1",
        "name": "City Park",
        "requiredMaterials": {
          "paper": 10,
          "plastic": 5
        },
        "progress": 3,
        "completed": false,
        "healthBonus": 5,
        "deadline": 10
      }
    ],
    "municipalityInventory": [
      {
        "id": "m-abc123",
        "type": "paper",
        "quality": "A",
        "mass": 8.5,
        "owner": "municipality"
      }
    ]
  }
}
```

---

### 4. MRF Routes (`/api/mrf`)

#### 4.1 Process Waste

Process waste from queue into materials. **MRF role only.**

**Request:**
```bash
curl -X POST http://localhost:5000/api/mrf/process-waste \
 -H "Authorization: Bearer <jwt_token>" \
 -H "Content-Type: application/json" \
 -d '{
"queueId": "queue_item_id",
"sessionId": "session_uuid"
}'
```

**Response (200):**
```bash
{
"success": true,
"message": "Waste processed successfully",
"data": {
"gameState": {}
}
}
```

---

#### 4.2 Assign Grade

Assign quality grade to material and list in marketplace. **MRF role only.**

**Request:**
```bash
curl -X POST http://localhost:5000/api/mrf/assign-grade \
 -H "Authorization: Bearer <jwt_token>" \
 -H "Content-Type: application/json" \
 -d '{
"materialId": "material_id",
"grade": "A",
"sessionId": "session_uuid"
}'
```

**Valid Grades:** `A` | `B` | `C` | `F`

**Response (200):**
```bash
{
"success": true,
"message": "Grade assigned successfully",
"data": {
"gameState": {}
}
}
```

---

#### 4.3 Get MRF Queue

Get MRF processing queue. **MRF role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/mrf/queue/session_uuid \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "MRF queue retrieved successfully",
"data": {
"queue": [
{
"id": "queue_item_id",
"batchId": "waste_batch_id",
"arrivalTime": 1,
"processed": false
}
]
}
}
```

---

#### 4.4 Get MRF Inventory

Get MRF's material inventory. **MRF role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/mrf/inventory/session_uuid \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "MRF inventory retrieved successfully",
"data": {
"inventory": [
{
"id": "material_id",
"type": "paper",
"quality": "B",
"mass": 8.5,
"contamination": 0.05,
"owner": "mrf",
"listed": false
}
]
}
}
```

---

### 5. Broker Routes (`/api/broker`)

#### 5.1 Buy Material

Buy material from marketplace.

**Request:**
```bash
curl -X POST http://localhost:5000/api/broker/buy-material \
 -H "Authorization: Bearer <jwt_token>" \
 -H "Content-Type: application/json" \
 -d '{
"materialId": "material_id",
"buyer": "municipality",
"sessionId": "session_uuid"
}'
```

**Valid Buyers:** `municipality` | `broker`

**Response (200):**
```bash
{
"success": true,
"message": "Material purchased successfully",
"data": {
"gameState": {}
}
}
```

---

#### 5.2 Use Material for Project

Use material for city project. **Broker role only.**

**Request:**
```bash
curl -X POST http://localhost:5000/api/broker/use-material \
 -H "Authorization: Bearer <jwt_token>" \
 -H "Content-Type: application/json" \
 -d '{
"materialId": "material_id",
"projectId": "project_id",
"sessionId": "session_uuid"
}'
```

**Response (200):**
```bash
{
"success": true,
"message": "Material used for project",
"data": {
"gameState": {}
}
}
```

---

#### 5.3 Get Marketplace

Get all listed materials in marketplace.

**Request:**
```bash
curl -X GET http://localhost:5000/api/broker/marketplace/session_uuid \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Marketplace retrieved successfully",
"data": {
"marketplace": [
{
"id": "material_id",
"type": "plastic",
"quality": "A",
"mass": 12.3,
"contamination": 0.02,
"owner": "mrf",
"listed": true
}
]
}
}
```

---

#### 5.4 Get Projects

Get all city projects.

**Request:**
```bash
curl -X GET http://localhost:5000/api/broker/projects/session_uuid \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Projects retrieved successfully",
"data": {
"projects": [
{
"id": "park1",
"name": "City Park",
"requiredMaterials": {
"paper": 10,
"plastic": 5
},
"progress": 3,
"completed": false,
"healthBonus": 5,
"deadline": 10
}
]
}
}
```

---

#### 5.5 Get Broker Inventory

Get broker's material inventory. **Broker role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/broker/inventory/session_uuid \
 -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Broker inventory retrieved successfully",
"data": {
"inventory": [
{
"id": "material_id",
"type": "metal",
"quality": "A",
"mass": 15.0,
"contamination": 0.01,
"owner": "broker",
"listed": false
}
]
}
}
```

---

#### 5.6 Get Municipality Inventory

Get municipality's material inventory. **Municipality role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/broker/municipality-inventory/session_uuid \
  -H "Authorization: Bearer <jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Municipality inventory retrieved successfully",
"data": {
"inventory": [
{
"id": "material_id",
"type": "glass",
"quality": "B",
"mass": 8.2,
"contamination": 0.08,
"owner": "municipality",
"listed": false
}
]
}
}
```

---

#### 5.7 Sell to External Market

Sell graded material to external market for team revenue. **Broker role only.**

**Request:**
```bash
curl -X POST http://localhost:5000/api/broker/sell-external \
  -H "Authorization: Bearer <broker_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
"materialId": "material_id",
"sessionId": "session_uuid"
}'
```

**Response (200):**
```bash
{
"success": true,
"message": "Material sold to external market successfully",
"data": {
"gameState": {}
}
}
```

---

#### 5.8 Transfer to Municipality

Transfer material to municipality for city project completion. **Broker role only.**

**Request:**
```bash
curl -X POST http://localhost:5000/api/broker/transfer-municipality \
  -H "Authorization: Bearer <broker_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
"materialId": "material_id",
"projectId": "project_id",
"sessionId": "session_uuid"
}'
```

**Response (200):**
```bash
{
"success": true,
"message": "Material transferred to municipality successfully",
"data": {
"gameState": {}
}
}
```

---

#### 5.9 Get Transaction History

Get complete transaction history for the current game session. **Broker role only.**

**Request:**
```bash
curl -X GET http://localhost:5000/api/broker/transactions/session_uuid \
  -H "Authorization: Bearer <broker_jwt_token>"
```

**Path Parameters:** `sessionId` - The game session ID

**Response (200):**
```bash
{
"success": true,
"message": "Transaction history retrieved successfully",
"data": {
"transactions": [
{
"id": "transaction_id",
"turn": 3,
"buyer": "broker",
"seller": "mrf",
"itemType": "paper",
"itemId": "material_id",
"mass": 10.5,
"price": 2100.00,
"transactionType": "external_sale",
"revenue": 2100.00
}
]
}
}
```

---

## Data Models

### Core Game Entities

#### Waste Batch
```typescript
interface WasteBatch {
  id: string;                    // Unique batch identifier (w-xxxxx)
  playerId: string;              // Player who initiated collection
  turnGenerated: number;         // Game turn when created
  generationTime: number;        // Timestamp when spawned
  origin: 'Residential' | 'Commercial' | 'Industrial';
  mass: number;                  // Tons of waste
  composition: {                 // Material breakdown percentages
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood?: number;
  };
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  collectionDeadline: number;    // Timestamp deadline
  lockToken: string | null;      // Concurrency control
}
```

#### Material
```typescript
interface Material {
  id: string;                    // Unique material identifier (m-xxxxx)
  type: 'paper' | 'plastic' | 'metal' | 'glass' | 'wood';
  materialOrWaste: boolean;      // true = material, false = waste
  quality: 'A' | 'B' | 'C' | 'F'; // Quality grade
  mass: number;                  // Tons available
  contamination: number;         // Quality factor (0-1)
  owner: 'mrf' | 'broker' | 'municipality';
  listed: boolean;               // Available in marketplace
}
```

#### City Project
```typescript
interface CityProject {
  id: string;                    // Unique project identifier
  name: string;                  // Project display name
  requiredMaterials: {           // Material requirements
    paper?: number;
    plastic?: number;
    metal?: number;
    glass?: number;
    wood?: number;
  };
  progress: number;              // Current progress (tons)
  completed: boolean;            // Completion status
  healthBonus: number;           // Health points awarded
  deadline: number;              // Game day deadline
}
```

#### Transaction
```typescript
interface Transaction {
  id: string;                    // Unique transaction identifier
  turn: number;                  // Game turn when executed
  buyer: string;                 // Buyer role or "External Market"
  seller: string;                // Seller role
  itemType: string;              // Material type
  itemId: string;                // Material identifier
  mass: number;                  // Transaction quantity
  price: number;                 // Total transaction value
  transactionType: 'external_sale' | 'internal_transfer';
  revenue: number;               // Revenue added to budget
}
```

#### MRF Queue Item
```typescript
interface MRFQueue {
  id: string;                    // Unique queue identifier (q-xxxxx)
  batchId: string;               // Linked waste batch
  playerId: string;              // MRF player processing
  arrivalTime: number;           // Timestamp when queued
  delivered: boolean;            // Processing completion status
  lockToken: string | null;      // Concurrency control
}
```

### Game State Structure
```typescript
interface GameState {
  sessionId: string;
  currentTurn: number;
  budget: number;
  cityHealth: number;
  totalCO2: number;
  totalTransportTrips: number;
  totalLandfillTons: number;
  gameStatus: 'active' | 'won' | 'lost';
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
  // Real-time tracking
  currentGameDay: number;
  currentGameHour: number;
  minutesElapsed: number;
  lastWasteSpawnTime: number;
  lastAutoSaveTime: number;
  gameStartTime: number;
  // Game entities
  wasteBatches: WasteBatch[];
  mrfQueue: MRFQueue[];
  materialInventory: Material[];
  transactions: Transaction[];
  cityProjects: CityProject[];
  activityLog: string[];
  // Concurrency control
  activeLocks: Record<string, {
    playerId: string;
    timestamp: number;
    type: 'batch' | 'queue' | 'material';
  }>;
  // Win/lose mechanics
  gameOverCountdown: {
    active: boolean;
    startTime: number | null;
    reason: 'health' | 'budget' | null;
  };
}
```

---

## Error Handling

All endpoints return consistent error responses with the following format:

**Error Response:**
```bash
{
"success": false,
"message": "Error description",
"errors": [
{
"field": "field_name",
"message": "Validation error message"
}
]
}
```

---

## Response Codes

| Status | Meaning               | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| 200    | OK                    | Request successful                       |
| 201    | Created               | Resource created successfully            |
| 400    | Bad Request           | Validation errors or invalid parameters  |
| 401    | Unauthorized          | Missing or invalid JWT token             |
| 403    | Forbidden             | Insufficient permissions for this action |
| 404    | Not Found             | Resource not found                       |
| 500    | Internal Server Error | Server-side error occurred               |

---

## Game Flow

### Phase 1: Authentication & Lobby Setup

```bash
# 1. Register Players (run for each player)
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Player One","email":"player1@example.com","password":"password123"}'

# 2. Login (save JWT tokens for each player)
TOKEN1=$(curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"player1@example.com","password":"password123"}' \
  | jq -r '.data.token')

# 3. Player 1 creates lobby (automatically becomes leader, gets unique 6-char code)
LOBBY_RESPONSE=$(curl -X POST http://localhost:5000/api/lobby/join \
  -H "Authorization: Bearer $TOKEN1")
LOBBY_CODE=$(echo $LOBBY_RESPONSE | jq -r '.data.lobby.lobbyCode')  # 🎯 Unique 6-char code
SESSION_ID=$(echo $LOBBY_RESPONSE | jq -r '.data.lobby.sessionId')

# 4. Other players join using lobby code (share this code verbally)
curl -X POST http://localhost:5000/api/lobby/join \
  -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"lobbyCode\":\"$LOBBY_CODE\"}"

curl -X POST http://localhost:5000/api/lobby/join \
  -H "Authorization: Bearer $TOKEN3" \
  -H "Content-Type: application/json" \
  -d "{\"lobbyCode\":\"$LOBBY_CODE\"}"

# 5. Select Roles (first-come, first-served)
curl -X POST http://localhost:5000/api/lobby/select-role \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"role\":\"municipality\"}"

curl -X POST http://localhost:5000/api/lobby/select-role \
  -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"role\":\"mrf\"}"

curl -X POST http://localhost:5000/api/lobby/select-role \
  -H "Authorization: Bearer $TOKEN3" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"role\":\"broker\"}"

# 6. Start Game (when all roles selected)
curl -X POST http://localhost:5000/api/lobby/start-game \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\"}"
```

### Phase 2: Cooperative Gameplay Loop

The game runs in real-time with automatic waste generation every 2 minutes and system checks every 30 seconds.

```bash
# === CONTINUOUS MONITORING ===
# Get current game state (call periodically or after actions)
curl -X GET http://localhost:5000/api/games/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN1"

# === MUNICIPALITY WORKFLOW ===
# 1. View available waste batches
curl -X GET http://localhost:5000/api/municipality/waste-batches/$SESSION_ID \
  -H "Authorization: Bearer $MUNICIPALITY_TOKEN"

# 2. Collect waste (transport costs: $2.50/ton/km, CO2: 1.6 tons/trip)
curl -X POST http://localhost:5000/api/games/$SESSION_ID/collect-waste \
  -H "Authorization: Bearer $MUNICIPALITY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"batchId\":\"w-abc123\"}"

# === MRF WORKFLOW ===
# 3. View MRF processing queue
curl -X GET http://localhost:5000/api/mrf/queue/$SESSION_ID \
  -H "Authorization: Bearer $MRF_TOKEN"

# 4. Process waste batch (creates materials, disposal costs: $50/ton)
curl -X POST http://localhost:5000/api/mrf/process-waste \
  -H "Authorization: Bearer $MRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"queueId\":\"q-def456\",\"sessionId\":\"$SESSION_ID\"}"

# 5. Assign quality grade (A/B/C/F multipliers)
curl -X POST http://localhost:5000/api/mrf/assign-grade \
  -H "Authorization: Bearer $MRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"materialId\":\"m-ghi789\",\"grade\":\"A\",\"sessionId\":\"$SESSION_ID\"}"

# === BROKER WORKFLOW ===
# 6. View marketplace (materials listed by MRF)
curl -X GET http://localhost:5000/api/broker/marketplace/$SESSION_ID \
  -H "Authorization: Bearer $BROKER_TOKEN"

# 7. Purchase material for resale or project use
curl -X POST http://localhost:5000/api/broker/buy-material \
  -H "Authorization: Bearer $BROKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"materialId\":\"m-ghi789\",\"buyer\":\"broker\",\"sessionId\":\"$SESSION_ID\"}"

# 8. Sell to external market (revenue added to team budget)
curl -X POST http://localhost:5000/api/broker/sell-external \
  -H "Authorization: Bearer $BROKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"materialId\":\"m-jkl012\",\"sessionId\":\"$SESSION_ID\"}"

# 9. Allocate materials to city projects (free internal transfer)
curl -X POST http://localhost:5000/api/broker/transfer-municipality \
  -H "Authorization: Bearer $BROKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"materialId\":\"m-jkl012\",\"projectId\":\"park1\",\"sessionId\":\"$SESSION_ID\"}"

# === SYSTEM MANAGEMENT ===
# View transaction history
curl -X GET http://localhost:5000/api/broker/transactions/$SESSION_ID \
  -H "Authorization: Bearer $BROKER_TOKEN"

# Manual system check (normally automatic every 30 seconds)
curl -X POST http://localhost:5000/api/games/$SESSION_ID/system-check \
  -H "Authorization: Bearer $TOKEN1"

# End turn (calculate health penalties, spawn new waste)
curl -X POST http://localhost:5000/api/games/$SESSION_ID/end-turn \
  -H "Authorization: Bearer $TOKEN1"
```

### Real-Time Game Flow Summary

1. **Waste Generation**: Every 2 minutes, new waste batches spawn
2. **Municipality**: Collects waste → transports to MRF (costs + CO2)
3. **MRF**: Processes waste → creates graded materials (disposal costs)
4. **Broker**: Trades materials → external sales (revenue) or project allocation
5. **System**: Monitors health penalties, win/lose conditions
6. **Repeat**: Until 30 minutes elapsed or win/lose conditions met

---

## Best Practices

### 🔐 Authentication & Security
- **Secure JWT tokens**: Store tokens securely and implement automatic refresh
- **Role validation**: Always verify user roles before role-specific operations
- **Rate limiting**: Respect API rate limits (5 auth requests, 100 general requests per 15min)
- **Error handling**: Implement proper error handling for 401/403/404 responses

### 🎮 Game Development
- **WebSocket Integration**: Use WebSocket events for real-time updates instead of polling
- **Fallback Polling**: Poll game state every 30 seconds as backup for WebSocket failures
- **System checks**: Call system-check endpoint periodically or rely on automatic updates
- **Lock handling**: Implement proper error handling for locked resources
- **State synchronization**: Use the activity log to track game events
- **Real-time Events**: Listen for `game-state-update`, `waste-collected`, `material-ordered` events

### 📊 Data Management
- **Type safety**: Use the provided TypeScript interfaces for all data structures
- **Validation**: Validate all input data using Zod schemas before API calls
- **Error responses**: Check `success` field and handle error arrays properly
- **Pagination**: Implement pagination for large datasets (transactions, inventory)

### 🔄 Game Flow Integration
- **Lobby management**: Handle lobby codes for joining, implement role selection UI
- **Role assignment**: First-come, first-served role selection with conflict resolution
- **Game state**: Monitor budget, health, CO2, and game status continuously
- **Win/lose conditions**: Implement countdown timers and recovery mechanics

### 🚀 Performance Optimization
- **Batch operations**: Group related API calls to reduce network overhead
- **Caching**: Cache static data (material properties, game constants)
- **WebSocket consideration**: For real-time features, consider WebSocket implementation
- **Background processing**: Handle automatic system checks appropriately

### 🧪 Testing Strategy
- **Unit tests**: Test individual service methods and calculations
- **Integration tests**: Test complete game flows and API interactions
- **Concurrency tests**: Test lock mechanisms and race condition handling
- **Load tests**: Test system performance under multiple concurrent games

### 📱 Frontend Integration
- **WebSocket Connection**: Establish WebSocket connection with JWT authentication
- **Room Management**: Join/leave game rooms for session-based multiplayer
- **Real-time Events**: Listen for `game-state-update`, `waste-collected`, `material-ordered`
- **State management**: Implement robust game state management with WebSocket sync
- **Real-time updates**: Handle automatic game state changes via WebSocket events
- **Error boundaries**: Implement error boundaries for API and WebSocket failures
- **Offline handling**: Handle network interruptions with reconnection logic
- **Event-driven UI**: Update UI immediately on WebSocket events instead of polling

### 🔧 Development Workflow
- **Environment setup**: Use `.env.example` for configuration
- **Code quality**: Follow ESLint rules and TypeScript strict mode
- **Documentation**: Keep API documentation synchronized with code changes
- **Version control**: Use semantic versioning for API changes

---

## Support

For issues, questions, or feature requests, please contact the development team or open an issue in the project repository.
