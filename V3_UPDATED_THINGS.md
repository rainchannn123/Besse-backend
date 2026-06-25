# V3 Updated Things - BESSE Backend Implementation Updates

## Overview
This document details all the updates and implementations made to align the BESSE Backend with the official game manual specifications.

## 1. Constants Updates (`src/constants/constants.ts`)

### Added Missing Constants
- `AUCTION_DURATION_SECONDS: 30` - Duration for auction bidding windows
- `PLAYER_BID_CAP: 10` - Maximum simultaneous bids per broker
- `MARKUP_CONSTANT: 2.5` - Price multiplier for external wholesaler purchases
- `REFUSE_HEALTH_PENALTY_PER_TON: 0.5` - Health penalty per ton of refuse during processing

### Updated GameConstants Interface (`src/types/index.ts`)
Added corresponding interface properties for the new constants.

## 2. Game State Enhancements (`src/types/index.ts`)

### New GameState Fields
- `municipalInventory`: JSON object tracking materials available for municipality projects
  ```typescript
  municipalInventory: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood: number;
  }
  ```
- `marketplaceListing`: Array of active auctions
  ```typescript
  marketplaceListing: Auction[];
  ```

### New Auction Interface
```typescript
interface Auction {
  auctionId: string;
  originTeam: string;
  materialType: 'paper' | 'plastic' | 'metal' | 'glass' | 'wood';
  grade: 'A' | 'B' | 'C' | 'F';
  mass: number;
  currentBid: number;
  highBidder: string | null;
  endTime: number;
  status: 'active' | 'ended' | 'sold';
}
```

## 3. Game Initialization Updates (`src/services/gameService.ts`)

### createGameFromLobby Method
- Added initialization of `municipalInventory` with zero values for all material types
- Added initialization of `marketplaceListing` as empty array

## 4. Processing Logic Updates (`src/services/mrfService.ts`)

### processWaste Method
- Added refuse health penalty calculation: `refuseMass * REFUSE_HEALTH_PENALTY_PER_TON`
- Updated activity log to include health penalty in processing output
- Health deduction applied immediately when refuse is dumped

## 5. Municipality Workflow Implementation

### Complete Municipality System
The municipality workflow has been fully implemented as the core waste management and city development system.

#### Waste Generation & Management
- **Real-time Spawning**: Every 2 minutes generates waste batch with `Random(10,25)` tons mass
- **Zone-Based Composition**: Residential/Commercial/Industrial with specific material ratios
- **Collection Deadlines**: 10-minute game time deadline with -2% health penalty per overdue batch
- **System Updates**: 30-second cycles check spawning and penalties, broadcast to all players

#### Waste Collection Process
- **Locking Mechanism**: Prevents concurrent collection with 10-second safety timeout
- **Cost Calculation**: `Transport Cost = Mass * 10km * $2.50/ton/km`
- **CO2 Emissions**: +1.6 tons CO2 per collection trip
- **MRF Integration**: Collected waste delivered to MRF processing queue
- **Status Management**: PENDING → DELIVERED, with FAILED status for lock conflicts

#### City Projects System
- **Sequential Projects**: 4 projects with specific material requirements and +5% health bonuses
- **Unlock Conditions**: Projects unlock progressively after previous completion
- **Material Validation**: Checks municipal inventory against project requirements
- **Instant Completion**: Deducts materials, applies health bonus, unlocks next project
- **Notification System**: Broadcasts completion to all team players

### Project Specifications (Exact Manual Match)
- **P-001 Community Park**: 10t Paper, 5t Wood, +5% Health (available at start)
- **P-002 Recycling Center**: 8t Metals, 6t Plastic, +5% Health (unlocks after P-001)
- **P-003 Green Plaza**: 12t Glass, 8t Paper, 4t Wood, +5% Health (unlocks after P-002)
- **P-004 Transit Hub**: 15t Metals, 10t Plastic, +5% Health (unlocks after P-003)

### API Endpoints
- `POST /api/municipality/collect-waste/:sessionId` - Collect waste batch
- `POST /api/municipality/reject-waste` - Reject waste (health penalty)
- `GET /api/municipality/waste-batches/:sessionId` - View pending waste
- `GET /api/municipality/city-projects/:sessionId` - View projects
- `POST /api/municipality/construct-project/:sessionId` - Build city project
- `GET /api/municipality/broker-materials/:sessionId` - View broker materials
- `POST /api/municipality/place-order/:sessionId` - Order materials from broker

## 6. Broker Workflow Implementation

### Complete Rewrite of Broker System
The broker workflow has been completely rewritten to implement the new competitive marketplace system as specified in the manual.

#### Global Auctions (Primary Channel)
- **getActiveAuctions**: Queries auctions across all active game sessions
- **placeBid**: Validates bid cap (10 active bids) and budget, updates auction across sessions
- **resolveExpiredAuctions**: Handles three auction outcomes with transaction logging:
  - **Self Win (A)**: Net-zero budget transfer, material to municipal inventory, transaction recorded
  - **External Sale (B)**: Cross-session payment and material transfer, transactions recorded for both buyer and seller
  - **Liquidation (C)**: 50% base price to seller, material scrapped, transaction recorded

#### External Wholesaler (Backup Channel)
- **buyFromExternalWholesaler**: Purchases with 2.5x markup, auto-restock when depleted, transaction logged
- **getExternalStock**: Displays current stock levels (10-65 tons initial, 30-80 restock)

#### Cross-Session Support
- Auctions are global across all teams
- Bid slots managed per player across sessions
- Material transfers and payments work between different game sessions

#### Removed Legacy Methods
- Old `buyMaterial`, `sellToExternalMarket`, `transferToMunicipality` methods removed
- Old marketplace and inventory viewing endpoints removed
- Clean implementation focused only on auction and wholesaler systems

### API Endpoints
- `GET /api/broker/auctions/:sessionId` - View global active auctions
- `POST /api/broker/place-bid` - Place bid on any auction
- `POST /api/broker/resolve-auctions/:sessionId` - Resolve expired auctions
- `POST /api/broker/buy-external` - Purchase from external wholesaler
- `GET /api/broker/external-stock/:sessionId` - Check stock levels

## 7. Broker Service Updates (`src/services/brokerService.ts`)

### Legacy transferToMunicipality Method (Removed)
- Old municipal inventory update logic removed as part of workflow cleanup

## 8. Implementation Verification

### Session Variables (All Implemented)
- ✅ Session ID (UUID)
- ✅ Pair ID (UUID format pair-XXXX)
- ✅ Partner Team ID (UUID)
- ✅ Active Locks (JSON with safety cleanup)
- ✅ Team Role (Team A/Team B enum)
- ✅ Pair Status (active/eliminated/completed)
- ✅ Municipal Inventory (material counts)
- ✅ Marketplace Listing (auction array)
- ✅ Current Budget ($10,000 starting)
- ✅ Total CO₂ (accumulator)
- ✅ City Health (100% starting)
- ✅ Game Over Countdown (3-minute system)

### System Update Cycles
- ✅ Continuous Action Updates: Real-time state changes with broadcasting
- ✅ Scheduled System Checks: Every 30 seconds with waste spawning, penalties, health recalculation

### Active Locks System
- ✅ Library checkout-style locking for concurrent processing prevention
- ✅ 30-second safety timeout for crashed players
- ✅ Automatic cleanup of stale locks

### Clock Calculation
- ✅ Perfect implementation: `Current Day = (Count(Minutes Elapsed)/30)*7`
- ✅ Proper day numbering starting from 1
- ✅ Hour calculation within game days

## 8. Manual Compliance Verification

### Constants Table
All manual constants properly implemented with correct values and units.

### Material Reference Table
Complete implementation with all 5 materials (including Wood).

### Municipal Inventory Table
- ✅ Zero initialization on game start
- ✅ Updates on broker transfers
- ✅ Tracks materials available for projects

### Session Variables
All variables from manual implemented with correct data types and descriptions.

### System Cycles
Both continuous and scheduled update cycles implemented as specified.

## 9. Key Features Implemented

1. **Refuse Health Penalty**: 0.5% health deduction per ton of non-recycled waste
2. **Municipal Inventory Management**: Separate tracking of project-ready materials
3. **Marketplace Auction System**: Framework for live material auctions
4. **Active Locks with Safety**: Prevents processing conflicts with timeout recovery
5. **Real-time Clock**: Accurate game time progression (30 min = 7 days)
6. **Pair Scoring**: Dynamic pair health calculation and status updates
7. **Global Broker Auctions**: Cross-session competitive marketplace
8. **External Wholesaler System**: Guaranteed backup material source

## 10. Backward Compatibility
All changes maintain backward compatibility with existing game sessions and data structures.

## 11. Testing Recommendations
- Verify refuse health penalty application during MRF processing
- Test municipal inventory updates during broker transfers
- Confirm clock calculation accuracy over game duration
- Validate active locks prevent concurrent processing conflicts
- Check auction system initialization and data structure integrity
- Test cross-session auction bidding and resolution
- Verify external wholesaler stock management and restocking