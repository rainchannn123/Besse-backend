# BESSE Backend Logic Manual

This backend drives a multi-player simulation where three roles (Municipality, MRF, Broker) cooperate to manage a city's waste. The game is a cooperative resource management simulation where three roles interact with a shared dataset to balance three competing metrics: **Budget ($)**, **City Health (%)**, and **Carbon Emissions (CO2)**.

Think of the backend as a giant calculator that runs in a loop:
- **State**: It holds the current "score" (Money, CO2, Health)
- **Input**: Players click buttons (like "Collect Waste" or "Buy Upgrade")
- **Logic**: The calculator applies rules to change the score based on the input
- **Output**: The screen updates with the new numbers

## The Game Loop
- **System**: Generates Waste (Problem)
- **Municipality**: Moves Waste to MRF (Logistics)
- **MRF**: Converts Waste to Material (Processing)
- **Broker**: Converts Material to Money or Project Resources (Market)
- **System**: Evaluates Game State (Win/Loss)

## Game Entry & Lobby System

### Entering the Game
Players are assigned to a section, but wait in this screen until at least three players have logged in. This screen works as a 'waiting lobby' for the game.

### Joining the Team
To enter a specific team, players put a specific code in an input box to join in a specific team. When three players enter the code, they join the specific team. Else, the players are randomly assigned.

### Team Pairing Logic
Once a team of 3 players completes role selection, they enter a "Pairing Lobby"

The system maintains a global "Unpaired Teams Queue"

**Pairing Algorithm** (runs every 30 seconds):
- If 2+ teams are waiting → Randomly select 2 teams and create a Pair
- Assign Pair ID (UUID format: pair-XXXX)
- Both teams proceed to game start simultaneously
- If only 1 team waiting → Show "Waiting for another team..." message
- Teams cannot proceed to gameplay until paired

### Choosing Roles
To pick roles, we apply a 1:1 exclusion list without administrator powers.
- 3 Players are logged in for the same session
- The roles are assigned on a 'first-click, first-serve' basis: Whomever clicks first on the role, gets the role
- Admin powers as team lead cannot overrule this
- 3 players → Each player can only pick one box → All the three boxes should be chosen before the option to continue to the next page opens
- A player only changes the role if the role is available. The other player who selects that role must deselect the role first in this page. Once they click 'continue', the roles are set.

## Step 1: Game Initialization (Lobby & Setup)

**UI Reference**: Screens 1_01 to 2_01 (Login, Lobby, Role Selection)

Before the game loop begins, the system must instantiate the "Default State." This establishes the baseline rules (Constants) and the starting values (Variables) for the players.

### 1.1. Global Configuration Table - CONSTANTS

These are Constants: fixed numbers that do not change during the game unless a specific "Upgrade" event modifies them. They define the physics of the world.

| Parameter | Value | Description |
|-----------|-------|-------------|
| Time Unit (Shift) | 30 mins (Game Time) | Real-Time Game Clock: 30 minutes (Real World Time) = 1 Game Day |
| Waste Spawn Interval | Every 2 minutes (Real World Time) | |
| Auto-Save Interval | Every 30 seconds | |
| Game Duration | 30 minutes (Real World) = 7 Game Days | |
| Session Duration | 7 Days (Game Time) | Win condition evaluation period |
| Starting Budget | $10,000 | Shared team budget |
| Starting Health | 100% | City Health Score |
| Winning Health Score | 60% | Winning Score at last section |
| Losing Health Score | 0% | If health drops below this, start losing countdown for the team |
| Losing Budget Score | 0 | If budget drops below this, start losing countdown for the team |
| CO2 Transport Factor | 120 kg CO2 / ton / km | Emission rate for logistics |
| CO2 Processing Factor | 15 kg CO2 / ton/ min | Emission rate for MRF machinery |
| CO2 Dumping Factor | 250 kg CO2 / ton/ min | Emission rate for landfilling |
| CO2 Factor (Transport) | 1.6 tons | The pollution cost of moving one truck |
| CO2 Factor (Landfill) | 2.5 tons | The pollution cost of dumping trash |
| Transport Cost | $2.50 / ton / km | Logistics expense |
| Dumping Fee | $50 / ton | Cost to dispose of unusable waste |
| Operating Cost | $500 / shift | Fixed overhead per turn |

### System Update Cycles

**Cycle 1: Continuous Action Updates (Real-Time)**
- **Trigger**: Whenever ANY player takes an action
- **Effect**: Immediately calculate changes, update database, broadcast to all players
- **Examples**: Collect waste, process batch, sell material

**Cycle 2: Scheduled System Checks (Every 30 seconds)**
- **Trigger**: Automatic timer, runs regardless of player activity
- **Tasks**:
  - Check if 2 minutes elapsed → Spawn new waste if yes
  - Check all batches → Apply penalties for overdue batches
  - Check win/lose conditions → Update countdown if needed
  - Auto-save current game state to database (backup)
- **Broadcast**: Send updated metrics to all players

**Why Both Are Needed**:
- Action Updates: Keep players synchronized in real-time
- Scheduled Checks: Handle time-based game mechanics (spawning, deadlines, penalties)

We have a clock on the UI showing "Day X - Hour Y"
```
Current Day = (Count(Minutes Elapsed)/30)*7
```

### 1.2. Material Reference Table

This table outlines the physics and economics of the game's items.

| Material ID | Base Price ($/ton) | Process Rate (%) | Waste Rate (%) | CO2 Profile |
|-------------|-------------------|------------------|----------------|-------------|
| Paper | $180 | 85% | 15% | Low |
| Plastic | $350 | 80% | 20% | High |
| Metals | $600 | 90% | 10% | Med |
| Glass | $120 | 75% | 25% | Low |
| Wood | $100 | 90% | 10% | Med |

### Global Configuration Table - SESSION VARIABLES

These are Variables (specifically Floats or Integers): numbers that change frequently. When a player logs in (Screen 1_01), a session is created.

| Field Name | Data Type | Description |
|------------|-----------|-------------|
| Session ID | String (UUID) | Unique ID for this specific game match |
| Pair ID | String (UUID) | Unique identifier for the team pair. Format: pair-XXXX |
| Partner Team ID | String (UUID) | Used to fetch partner's metrics for display |
| Active Locks | JSON Object | Tracks which items are currently being processed to prevent conflicts<br>Example: {"batch_w-8823": "player_123", "item_m-551": "player_456"} |
| Team Role in Pair | Enum | "Team A" and "Team B" |
| Pair Status | Enum | Active, Team A Eliminated, Team B Eliminated, Pair Completed |
| Current Budget | 10,000 | Shared Bank Account for the turn |
| Total CO_2 | Float | Accumulator. Starts at 0.0 and grows with every truck movement |
| City Health | Float | Status Bar. Starts at 100.0% and fluctuates based on penalties/bonuses |
| Game Over Countdown | Boolean | If the Global Variables underperforms, the game over warning will be turned on with a 3-minute countdown. (Details in Step 6) |

### Active Locks for Waste Processing

Imagine a checkout system at a library:
- Player clicks "Process Waste Batch #123"
- System checks: "Is someone already processing Batch #123?"
- If YES → Show message: "Another player is working on this. Try a different batch."
- If NO → Add entry: "batch_123": "your_player_id" and proceed
- When processing completes: Remove the lock entry
- Safety Timer: If lock exists for more than 30 seconds, assume the player crashed and remove the lock

## Step 2: The Dashboard Loop (Real-Time Status)

**UI Reference**: Top Header Bar (Visible on all Role Screens)

**Visual Elements**: Budget ($), Waste Inventory (tons), City Health (%), CO2e (tons/min)

Every time a player performs an action, the backend must recalculate these four critical metrics.

### 2.1. Health Calculation Logic

**Intuition**: The city starts perfect (100%). Bad things – penalties (pollution, trash pile-ups) subtract points. Good things - bonuses (parks, recycling) add points.

```
Health = (100% - Penalties) + Bonuses
Where:
Penalties = Waste Penalty + CO2 Penalty
Bonuses = Project Bonus1 + ... + Project BonusN
```

**Health Conditions**:
- If Total Waste > 100 tons: Subtract 1% health per extra ton
- If Total CO2 > 200 tons: Subtract 1% health per 50 tons over limit
- If Project Completed = True: Add 5% health (per project)

### 2.2. CO2e Emission Logic

Every action has a "carbon price." We track this to determine if the city is "Green" or "Polluted."

```
Total CO2e = (Truck Trips * 1.6) + (Landfill Tons * 2.5)
```

### 2.3 Partner Team Display Logic

Every 30 seconds, fetch and display partner team metrics:

```sql
Partner Session ID = SELECT 'Partner Team ID' FROM 'session variables'
                      WHERE Session ID = [Current Team Session ID]

Partner Metrics = SELECT Current Budget, City Health, Total CO2
                  FROM 'session variables'
                  WHERE Session ID = Partner Session ID
```

**Display Format** just like for your own team:
```
"Partner Team Status: Health: [XX]% | Budget: $[XXXX] | CO2: [XX] tons"
```

**Update Frequency**:
- Broadcast partner updates every 30 seconds to all players in current team
- If partner team eliminated: Display "Team [XX] Eliminated"

## Step 3: Municipality Workflow

**UI Reference**: Screen "Residential Waste Collection" & "City Project"

The Municipality player is the "Source" of materials. Waste spawns in the city; if it stays there, Health drops. The Municipality pays to move it to the MRF.

### 3.1. Waste Generation (The "Spawn" Logic)

**Intuition**: The game needs to give the player something to do. We "spawn" waste automatically at the start of a turn.

**REAL-TIME WASTE GENERATION LOGIC**:

**Timer-Based Spawning**:
- Every 2 minutes (real-world time), the system generates 1 new waste batch
- Formula: `Batch_Mass = Random(10, 25) tons`

**Composition**: Randomized based on zone type:
- Residential: 50% Paper, 30% Plastic, 20% Glass
- Commercial: 40% Paper, 40% Plastic, 20% Metals
- Industrial: 30% Metals, 40% Plastic, 30% Wood

**Collection Deadline**:
- `Batch Collection Deadline = Generation Time + 10 minutes (game time)`
- If `Current_Time > Collection Deadline AND Status = 'PENDING'`:
  - Apply Health Penalty: -2% per overdue batch
  - Add to penalty counter immediately

**Logic Flow**. Every 30 seconds:
1. Check if 2 minutes passed since last spawn
   - If YES → Create new waste batch in database
2. Check all batches collection deadline: Is any overdue?
   - If YES → Calculate penalty, update Health in database
   - Send update to all player screens

| Field Name | Data Type | Example | Description / Rationale |
|------------|-----------|---------|-------------------------|
| Batch ID | UUID | w-8823 | Unique identifier for this specific pile of waste |
| Player ID | UUID | X-4758w | The player who initiated the MRF role |
| Origin | String | Residential | Where it came from (Residential / Commercial / Industrial) |
| Mass Tons | Float | 15.5 | Cost Driver. Determines the transport fee ($) |
| Composition | JSON | {"paper": 0.4, "plastic": 0.6} | Quality Driver. Defines what creates the "Grade" later in MRF |
| Status | Enum | PENDING / DELIVERED | PENDING (On street), DELIVERED (at MRF), FAILED |
| Timestamp | Integer | 12 | When the request was made for the batch |
| Batch Collection Deadline | Integer | 5 | If Current Turn > deadline, apply Health Penalty via Collection penalty |
| Collection Penalty | Health - 2 | | |
| Lock Token | String | sfhsefhefefh | Avoid double lock tokens |

### Municipality Waste Collection Process

**Step 1: Player Action**
- The player clicks "Collect" on batch_id: w-8823
- Frontend sends request to backend: `{"action": "COLLECT", "batch_id": "w-8823", "player": "muni_1"}`

**Step 2: Backend Validation**
- Backend receives request:
- Step A: Check if Batch ID status is already locked
- Step B: If unlocked → Add lock, set Status = PENDING
- Execute the calculations:
  - Cost Deduction: `Current Team Budget = Team Budget - Transport Cost`
  - Transport Cost = Mass Tons of Waste * 2.5$ (tons/km)

**Example**:
```
Distance km = 10 km (fixed distance to MRF, can be variable if needed)
Transport Cost = Mass Tons * Distance_km * $2.50/ton/km
Batch has 15.5 tons
Distance = 10 km
Transport_Cost = 15.5 * 10 * $2.50 = $387.50
```

**Step 3: Deduct from Budget**
```
Current Team Budget = Team Budget - Transport Cost
Current Team Budget = 10,000 - 387.50 = $9,612.50
```

**CO2 Generation**: `New CO2 = Total CO2 + 1.6` (Fixed cost per trip)

**Update State**: Set Waste Batch Status = 'DELIVERED'

**Update the Status**
- Update Database with the new values and status above
- Remove the lock, set the Status = 'DELIVERED'
- Broadcast updates to all connected players → This creates a new entry in the MRF input queue
- If Step A finds lock → Return error, set Status = FAILED

**Timeout Safety**: If Status = PENDING for more than 10 seconds → Remove lock automatically. This prevents permanent locks if a player disconnects mid-action.

## Step 4: MRF Workflow

**UI Reference**: Screen "Collection Action" & Page 93 (Dropdowns)

The MRF is the "Filter." They receive mixed trash and must "Process" it. Processing separates usable material from junk. The user then manually assigns "Quality Grades" (A/B/C) based on visual cues or reports.

### MRF Queue Table

| Field Name | Data Type | Example | Description / Rationale |
|------------|-----------|---------|-------------------------|
| Queue ID | UUID | q-102 | Unique ID for the job |
| Batch ID | UUID | w-8823 | FK linking back to the Municipality's waste batch |
| Player ID | UUID | z-8q38q34 | |
| Arrival Time | Timestamp | 10:15 AM | Used to sort the UI list (FIFO - First In First Out) |
| Delivered | Boolean | FALSE | If TRUE, hide from "IN TRANSIT" list and move to Inventory |

### MRF Processing Process

**Step 1: Player Action**
- MRF player clicks "Process" on Queue Item q-102
- Frontend sends: `{"action": "PROCESS_BATCH", "Queue ID": "q-102", "Player": "z-478956"}`

**Step 2: Backend Validation**
- a) Check Lock Status: `Select from 'Active_Locks' WHERE Queue ID = 'q-102'`
  - If lock exists → STOP, return error "Already being processed"
  - If lock not exists → Continue to (b)
- b) Add Lock: Insert the queue into 'Active_Locks' VALUES ('q-102', 'z-478956', CURRENT_TIMESTAMP)

Once the MRF processes the queue, the waste will be destroyed and replaced by "Material Items" in this table.

### Material Inventory Table

| Field Name | Data Type | Example | Description / Rationale |
|------------|-----------|---------|-------------------------|
| Item ID | UUID | m-551 | Unique ID for a specific stack of sorted material |
| Material Type | Enum | PAPER | Paper, Plastic, Metal, Glass or Wood |
| Material or Waste | Boolean | TRUE | If TRUE, this item is a material; If FALSE, this item is a waste |
| Quality grade | Enum | A | Value Multiplier: A (1.2x), B (1.0x), C (0.5x), F (0.0x) |
| Mass Tons | Float | 8.0 | The quantity available to sell |
| Owner | String | MRF | Changes to MUNICIPALITY or BROKER after a trade |
| Listed | Boolean | TRUE | If TRUE, this item is visible in the Marketplace |

**c) Retrieve Batch Data from the Queue:**
- First get the Batch ID linked to this queue: `Batch ID = SELECT Batch ID FROM 'mrf_queue' WHERE queue_id = 'q-102'`
- Then get batch details: `SELECT Material Type, Quality grade, Mass Tons from the Batch ID from waste_batches WHERE batch ID = [batch ID]`

**Execute the calculations**:
```
Output Material = Mass Tons * Composition * (1 - Waste Rate)
Refuse = Total Mass - Output Material
```

### Material Reference Table

| Material ID | Base Price ($/ton) | Process Rate (%) | Waste Rate (%) | CO2 Profile |
|-------------|-------------------|------------------|----------------|-------------|
| Paper | $180 | 85% | 15% | Low |
| Plastic | $350 | 80% | 20% | High |
| Metals | $600 | 90% | 10% | Med |
| Glass | $120 | 75% | 25% | Low |
| Wood | $100 | 90% | 10% | Med |

### Calculate Output Material (Dynamic based on Material Type)

**Step 1: Determine Material Type from Batch Composition**
Example Batch: `{"paper": 0.4, "plastic": 0.6}`
- 40% is Paper
- 60% is Plastic

**Step 2: Calculate Output for Each Material Type**
- Paper Output = Mass Tons * 0.4 * 0.85 (Paper process rate)
- Plastic Output = Mass Tons * 0.6 * 0.80 (Plastic process rate)
- Total Output Material = Paper Output + Plastic Output

**Example with 15.5 tons**:
- Paper: 15.5 * 0.4 * 0.85 = 5.27 tons
- Plastic: 15.5 * 0.6 * 0.80 = 7.44 tons
- Total Output: 5.27 + 7.44 = 12.71 tons

**Step 3: Calculate Refuse**
```
Refuse = Total Mass - Total Output
Refuse = 15.5 - 12.71 = 2.79 tons
```

**Apply the Waste Penalty to Budget based on input from Refuse**:
```
Dumping Fee = (Refuse (tons) * $50/ton)
Current Team Budget = Team Budget - Dumping Fee

Landfill Emissions CO2 = (Refuse * 2.5/ton)
Current Emissions CO2 = Total CO2 + Landfill Emissions
```

**Update the Status**
- Update the Session Variables displays: Team Budget, Current Emissions
- Insert into 'Material Inventory' the new material items
- Update the 'MRF Queue' Set 'Listed = TRUE' where Queue ID = 'q-102'
- Delete from 'Active Locks' where the Queue ID = 'q-102'
- Send updated values to ALL connected players (* global update, not team update): `{"budget": 8500, "co2": 45.2, "new_materials": [...]}`
- This is then what the Broker will sell

**Observation**:
- We lock the QUEUE ENTRY (what MRF is working on)
- We read data from the BATCH (the actual waste composition)

## Step 5: Broker Workflow

**UI Reference**: Screen "Marketplace", "Trader. Match the MRF's 'Material Inventory' with the Municipality's 'Project Requirement'.

### Action 1: Sell Material to External Market
- Broker views MRF's Material Inventory (where Listed = TRUE)
- Broker clicks "Sell to Market" on an item
- System calculates: `Sale Price = Base Price * Quality Multiplier * Mass Tons`
- Revenue flows to: Team Budget (shared team budget)
- Item is removed from inventory

**Example Flow**:
- MRF processes 8 tons of Grade A Paper
- Item appears in Broker's marketplace view
- Broker clicks "Sell to External Market"
- Calculation: $180 * 1.25 * 8 = $1,800
- Team budget increases by $1,800
- Item removed from inventory

### Action 2: Transfer Material to Municipality (For Projects)
- Broker views MRF's Material Inventory
- Broker views Municipality's Project Requirements (e.g., "Need 10 tons Paper, 5 tons Metal")
- Broker clicks "Allocate to Project"
- Material is transferred to Municipality
- NO money changes hands (internal transfer)
- Project progress updates

**Example Flow**:
1. Municipality has project needing 10 tons paper
2. MRF has 8 tons Grade A Paper ready
3. Broker allocates the 8 tons to the project
4. Project shows: "Paper: 8/10 tons (80% complete)"
5. Budget unchanged (no transaction cost)

### Transaction Table

The "Final Price" depends on the Quality Grade assigned by the MRF.

| Field Name | Data Type | Example | Description / Rationale |
|------------|-----------|---------|-------------------------|
| Transaction ID | UUID | tx-999 | Unique receipt ID |
| Buyer Role | String | MUNI | Who paid the money |
| Seller Role | String | MRF | Who received the money |
| Item ID | UUID | m-551 | The specific material stack sold |
| Price | Float | $5,000 | Base_Price * Grade_Multiplier * Market_Demand |
| Turn Completed | Integer | 4 | When the sale happened |

The Broker connects Supply (MRF) to Demand (Municipality Projects).

### Transaction Logic
The transaction should ensure that a trade only happens if both money and items are available

**Transaction Type 1: Sell to External Market**
- Team Budget (shared) += Sale Price
- Item removed from inventory
- No deduction (external buyer pays)

**Transaction Type 2: Internal Transfer (Material to Project)**
- No budget change (free internal transfer)
- Item ownership changes: MRF → Municipality
- Material allocated to project requirements

**Example Transaction Flow**:

**External Sale**:
- Before: Team Budget = $8,500
- Action: Broker sells 8 tons Grade A Paper at $1,800
- After: Team Budget = $10,300

**Internal Transfer**:
- Before: Team Budget = $10,300
- Action: Broker allocates 5 tons Metal to City Park Project
- After: Team Budget = $10,300 (unchanged)
- Effect: Project progress increases, health bonus when complete

Then We Execute the conditions:
- Team Budget -= Final Price
- Team Budget += Final Price
- Item.owner_role = Buyer
- Item.is_listed = FALSE

| Field | Type | Description |
|-------|------|-------------|
| trade_id | UUID | Unique Record |
| buyer | String | "External Market" or "Municipality" (if buying for project) |
| revenue | Float | Added to Total_Budget |
| turn | Int | Turn number when trade occurred |

### Base Prices (Per Ton)
- Paper: $180
- Plastic: $350
- Metals: $600
- Glass: $120

### Quality Multipliers (Constant Values)
Dropdowns showing "Grade A, B, C". Intuition: Better quality material sells for more money.

| Grade | Price Multiplier | Logic |
|-------|------------------|-------|
| A | 1.25x | Bonus profit for high quality |
| B | 1.0x | Standard market price |
| C | 0.5x | Penalty for poor quality |

**Material**:
- Grade A: 1.25 times
- Grade B: 1.0 times
- Grade C: 0.5 times

**Waste**:
- Grade B: 0.3 times
- Grade C: 0.2 times
- Grade F: 0.1 times (Or disposal fee)

## Step 6: Global Looping for Win or Losing the Game

All players maintain an open connection to the server. When ANY value changes, server immediately sends update to ALL players.

**Update Frequency**:
- Core Metrics (Budget, Health, CO2): Update every 30 seconds OR on any action
- Waste Inventory: Update immediately when batch collected/processed
- Material Listings: Update immediately when item listed/sold

**In Summary, what gets sent to players every update**:

| Data Type | Display Content |
|-----------|-----------------|
| Session ID | abc-123 |
| Current Budget | 8750.50 |
| Total CO_2 | 142.8 |
| Waste Pending | `{"batch_id": "w-8823", "mass": 15.5, "deadline": "10:25:00", "status": "overdue"}` |
| Material Available | `{"item_id": "m-551", "type": "paper", "grade": "A", "mass": 8.0}` |

After players finish actions, the turn ends. The system calculates penalties for what they didn't do.

### 6.1. City Health Update Formula

We rescue what we did in Stage 2:
```
New Health = (Health - Penalties) + Bonuses
```

**Waste Penalty**:
- Count all Waste Batches where Status='Pending'
- If Total Waste > 100t: Penalty = Uncollected Tons * 1 (1% drop per extra ton left)

**CO2 Penalty**:
- If Total CO2 > 200t: Penalty = 50 Tons * 1 (1% drop per 50 tons over limit)

**Project Bonus**:
- If Project Completed == TRUE, health + 5 (adds 5% per project)

Evaluated via the autosave checks.

### Losing Countdown

- If CityHealth <= 0 → Game Over Countdown = TRUE; >0 → Game Over Countdown = FALSE
- If Total Budget <= 0 → Game Over Countdown = TRUE; >0 → Game Over Countdown = FALSE

**Countdown Behavior**: When triggered:
- Set Countdown Active = TRUE
- Set Countdown Start Time = Current Timestamp
- Set Countdown Duration = 180 seconds (3 minutes)

Every 1 Second:
- Calculate: Time Remaining = 180 - (CURRENT TIME - Countdown Start Time)
- Broadcast to current team players: `{"warning": "GAME OVER of TEAM [x] IN {time_remaining} SECONDS"}`
- If Time Remaining = 0:
  - Set Game Status = "LOST"
  - Display loss screen with final statistics
  - Update Pair Status in 'session variables':
    - If Team A eliminated: Pair Status = "TEAM A ELIMINATED"
    - If Team B eliminated: Pair Status = "TEAM B ELIMINATED"
  - Lock all player actions (disable buttons)
  - Broadcast to partner team: `{"message": "Your partner team has been eliminated. Your score will represent the pair."}`
  - Display elimination screen with final statistics for eliminated team

### Countdown Recovery System
The countdown can be Cancelled if the team fix the problem in time.

**Recovery Triggers** (checked every 30 seconds during countdown):

1. **Health Recovery**:
   - If Countdown Active = TRUE AND City Health > 5%:
     - Set Countdown Active = FALSE
     - Broadcast: `{"message": "Crisis averted! Health restored."}`
     - Continue game normally

2. **Budget Recovery**:
   - If Countdown Active = TRUE AND Current Budget > $1,000:
     - Set Countdown Active = FALSE
     - Broadcast: `{"message": "Financial crisis resolved!"}`
     - Continue game normally

**Observation - Strategic Implications for a course game**. Players can:
- Quickly sell high-value materials to boost budget
- Complete a project to gain +5% health
- Stop collecting waste temporarily to reduce CO2

### Winning Conditions

**Winning Conditions** (checked every 30 seconds):
- If (Minutes Elapsed >= 30)
  - Proceed to Step 2: Calculate Pair Mean
- Else:
  - Continue game, display: "Time Remaining: [30 - Minutes Elapsed] minutes"

**Step 2: Calculate Pair Mean Health Score**
- Query Pair Status: `Pair Status = SELECT 'Pair Status' FROM 'session variables' WHERE 'Session ID' = [current_session]`

**Calculate Mean Health of Each pair**:
- When paired Team Status is "Active":
  - Team A Health = SELECT 'City Health' FROM 'session variables' WHERE 'Pair ID' = [current_pair] AND 'Team Role' = "Team A"
  - Team B Health = SELECT 'City Health' FROM 'session variables' WHERE 'Pair ID' = [current_pair] AND 'Team Role' = "Team B"
  - Average Pair Health = (Team A Health + Team B Health)/2

- When paired Team Status one of them is 'Team [N] Eliminated':
  - Assuming that Team A got eliminated and only Team B remains:
  - Team B Health = SELECT 'City Health' FROM 'session variables' WHERE 'Pair ID' = [current_pair] AND 'Team Role' = "Team B"
  - Average Pair Health = Team B Health (The mean becomes the surviving team's score only)

- When both Teams are eliminated before time expires:
  - Average Pair Health = 0

**Step 3: Determine Winners (Game Admin View Only)**
- Global Ranking Query:
  ```sql
  SELECT 'Pair ID', 'Average Pair Health', 'Team A Session ID', 'Team B Session ID'
  FROM 'Pair Scores' (*or from whatever we are storing the list of final pair scores)
  WHERE 'Game End Timestamp' = [current_game_session]
  ORDER BY 'Average Pair Health' in descending order
  ```
- Winning Pair = TOP 1 result (top of the 'order by' list)

### Display Results

**For Players (Each Pair Sees Their OWN pair results only)**:
- Set 'Game Status' = "COMPLETE"
- Lock all player actions
- Display Results Screen:
  - "Game Complete!"
  - "Your Pair's Final Score: [Pair Average Health]"
  - "Team A Final Health: [XX]%"
  - "Team B Final Health: [XX]%"
  - "Team A Final Budget: $[XXXX]"
  - "Team B Final Budget: $[XXXX]"
  - "Team A Total CO2 Emissions: [XX] tons"
  - "Team B Total CO2 Emissions: [XX] tons"

**For the Admin View Only**:
Display table with the global values of all the pairs ranked by Average Pair health in descending order. The table should look like:

| Rank | Pair ID | Average Pair Health | Team A Health | Team B Health | Status (Endgame) |
|------|---------|---------------------|---------------|---------------|------------------|
| 1 | pair-001 | 87.5% | 85% | 90% | Active |
| 2 | pair-002 | 72.0% | 72% | NULL | Team B Eliminated |
| 3 | pair-003 | 65.5% | 68% | 63% | Active |