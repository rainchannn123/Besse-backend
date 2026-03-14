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
| Auction Duration | 30 seconds | Time window for each auction before highest bidder wins |
| Player Bid Cap | 10 active bids | Maximum number of simultaneous bids a Broker can have across all auctions |
| Markup Constant | 2.5 x | Price multiplier when buying from External Wholesaler vs. base price |
| Refuse health Penalty | 0.5% / ton | Immediate city health deduction for non-recycled waste |

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

### New Team table – Municipal Inventory Table

This table stores the materials purchased by the Broker and available for Municipality projects. Materials cannot be used for projects until they are in this inventory.

When game session starts, initialize with all materials at zero:
Municipal Inventory = {"paper": 0, "plastic": 0, "metals": 0, "glass": 0, "wood": 0}

Update Triggers
- Broker wins auction → Add material to municipal inventory
- Broker purchases from External Wholesaler → Add material to municipal inventory
- Municipality completes project → Subtract required materials from municipal inventory
- Municipality screen shows "Available Materials for Projects" panel with real-time counts.

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
| Municipal Inventory | JSON | Storage of the materials brought by the broker and transferred to municipality (ex. "paper': "10.5" / 'glass":"5.0") |
| Marketplace Listing | Array | Live list of items currently being auctioned. Each auction has: auction_id, origin_team, material_type, grade, mass, current_bid, high_bidder, end_time, status |
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

**Visual Elements**: Budget ($), Waste Inventory (tons), City Health (%), CO2e (tons)

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
Partner Session ID = SELECT 'Partner Team ID' FROM 'session variables '
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
- If partner team eliminated: Display "Team [XX] Eliminated "

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

### City Project

Projects provide +5% Health when completed but require specific materials from Municipality Inventory. The table here provides the constant for the projects.

| Project ID | Project Name | Material Requirements (CONSTANT) | Health Bonus | Unlock Condition |
|------------|--------------|----------------------------------|--------------|------------------|
| P-001 | Community Park | 10 tons Paper<br>5 tons Wood | +5% | Available at game start |
| P-002 | Recycling Center | 8 tons Metals<br>6 tons Plastic | +5% | Unlocked after P-001 complete |
| P-003 | Green Plaza | 12 tons Glass<br>8 tons Paper<br>4 tons Wood | +5% | Unlocked after P-002 complete |
| P-004 | Transit Hub | 15 tons Metals<br>10 tons Plastic | +5% | Unlocked after P-003 complete |

**Project States**
- LOCKED: Previous project not complete (shown grayed out)
- AVAILABLE: Can be started (green button visible)
- IN_PROGRESS: Partially funded (progress bars show X/Y tons)
- COMPLETED: All materials delivered (+5% health applied)

Required = Project Requirements (e.g., P-001 needs 10t Paper + 5t Wood)
Available = Query Municipal Inventory
For each material in Required: 
If Municipal Inventory[material] < Required[material]: Return Error: "Insufficient [material]. Need [X] more tons. Ask Broker to purchase." Stop execution
If all materials available: For each material in Required: Municipal Inventory[material] -= Required[material]
Project Status = 'COMPLETED'
City_Health += 5%
Unlock next project (change status from LOCKED to AVAILABLE)
Notify all team players:
  "✅ [Project Name] completed! +5% Health. [Next Project] now available."
  Updated Health: [new value]
  Updated Inventory: [remaining materials]

### Transfer the Project Tab from the Broker to the Municipality

Municipality clicks "Construct Project P-001" (Community Park)

1. Project Requirements and validation
Project_Requirements = { 'P-001': {'paper': 10, 'wood': 5},
  'P-002': {'metals': 8, 'plastic': 6},
  'P-003': {'glass': 12, 'paper': 8, 'wood': 4},
  'P-004': {'metals': 15, 'plastic': 10}}

Required = Project_Requirements['P-001']  // {paper: 10, wood: 5}
Available = Session_Variables.Muni_Inventory  // {paper: 15.5, wood: 8.0, ...}

2. Fetch the Materials from the Inventory
Missing_Materials = []
For each material in Required:
  If Available[material] < Required[material]:
    Deficit = Required[material] - Available[material]
    Missing_Materials.append({
      material: material,
      needed: Required[material],
      available: Available[material],
      deficit: Deficit })

3. Material Count Check
If Missing_Materials is not empty:
Error_Message = "Cannot construct project. Missing materials:\n"
For each item in Missing_Materials:
Error_Message += "- Need {item.deficit} more tons of {item.material}\n"
Error_Message += "Ask Broker to purchase materials via auctions or External Wholesaler."
  
  Return Error: Error_Message
  Stop execution

4. Deduct Materials
If all materials available:
For each material in 'Required' for the project:
Municipal Inventory[material] -= Required[material]

5. Complete Project
Project_Status['P-001'].status = 'COMPLETED'
Project_Status['P-001'].completion_timestamp = CURRENT_TIMESTAMP
City_Health += 5%  // Apply health bonus

6. Unlock Next Project
// Find next project in sequence
Next Project = Get Next Project ID('P-001')  // Returns 'P-002'
If Next Project exists:
 Project Status[Next Project].status = 'AVAILABLE'  // Change from LOCKED

Notify all team players:
Message: "🎉 Community Park completed! +5% Health"
Updated_Values: { City_Health: [new value], Municipal Inventory: [updated inventory],
Project Status: "P-002 Recycling Center now available" }

## Step 4: MRF Workflow

**UI Reference**: Screen "Collection Action" & Page 93 (Dropdowns)

The MRF is the "Filter." They receive mixed trash and must "Process" it. Processing separates usable material from junk. Processed materials are automatically listed on the auction marketplace - the MRF no longer maintains a local inventory. The user then manually assigns "Quality Grades" (A/B/C) based on visual cues or reports.

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

Once the MRF processes the queue, the waste will be destroyed and replaced by "Material Items" for the Broker in this table.

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

c) Retrieve Batch Data from the Queue:
First get the Batch ID linked to this queue: `Batch ID = SELECT Batch ID FROM 'mrf_queue' WHERE queue_id = 'q-102'`
Then get batch details: `SELECT Material Type, Quality grade, Mass Tons from the Batch ID from waste_batches WHERE batch ID = [batch ID]`

Execute the calculations:
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

Now we may have a case of waste batches that they choose to now process:
IF the waste (q-102) is not processed into batches after 5 minutes in the MRF screen, then:
Health Deduction = Refuse tons * 0.5% (i.e., 0.005)
City Health = City Health - Health Deduction
Example: 2.79 × 0.5% = 1.4% health lost immediately

### Processing to Pending Auctions

After processing, create **pending** auctions for each material type:
Auction_ID = Generate UUID
Origin_Team = Current Team ID
Material_Type = [Paper/Plastic/etc.]
Quality Grade = 'B' (default, will be updated by MRF)
Mass = Output_Material[type]
Current_Bid = 0 (will be set by MRF as entry price)
High_Bidder = null
End_Time = 0 (will be set when activated)
Status = 'PENDING'

Update Status
- Update the Session Variables displays: Team Budget, Current Emissions, City Health
- Delete from 'Active Locks' where the Queue ID = 'q-102'
- Send updated values to MRF player: {" Batch processed: [weight]t [Material type] ready for grading and pricing"}

### MRF Grade Assignment and Listing

**Step 1: Get Pending Auctions**
- MRF calls `GET /api/mrf/pending-auctions/{sessionId}` to retrieve pending auctions created from processed waste
- Response includes auction details: auctionId, materialType, grade (default 'B'), mass, currentBid (0)

**Step 2: Player Action**
- MRF player selects a pending auction and clicks "Assign Grade & Price"
- Frontend sends: `POST /api/mrf/assign-grade` with `{"auctionId": "a-123", "grade": "A", "customPrice": 500, "sessionId": "session-123"}`

**Step 3: Backend Processing**
- Find pending auction by auctionId
- Update grade to selected value (A/B/C) or dispose (F)
- Set currentBid to customPrice (manual entry price)
- If grade is A/B/C:
  - Set status = 'ACTIVE'
  - Set endTime = Current_Timestamp + 30 seconds
  - Broadcast to all brokers: "New auction listed: [material] [grade] [mass]t starting at $[price]"
- If grade is F: Dispose material (same as before)

**Step 4: Auction Activation**
Once grade and price are assigned, the auction becomes visible to Broker players. The auction runs for 30 seconds regardless of bidding activity (fixed time window, not extended by bids)

## Step 5: Broker Workflow

**UI Reference**: Screen "Marketplace", "Trader. Match the MRF's 'Material Inventory' with the Municipality's 'Project Requirement'.

The Broker is now a purchasing agent who acquires material types for the Municipality's projects through a competitive marketplace. The Broker has two acquisition channels.

The material screen now has two tabs:
Tab 1: "Global Auctions" (Primary - cheaper but competitive)
Tab 2: "External Wholesaler" (Backup - expensive but guaranteed)

The "Final Price" depends on the Quality Grade assigned by the MRF.

### Transaction Table

| Field Name | Data Type | Example | Description / Rationale |
|------------|-----------|---------|-------------------------|
| Transaction ID | UUID | tx-999 | Unique receipt ID |
| Buyer Role | String | MUNI | Who paid the money |
| Seller Role | String | MRF | Who received the money |
| Item ID | UUID | m-551 | The specific material stack sold |
| Price | Float | $5,000 | Base_Price * Grade_Multiplier * Market_Demand |
| Turn Completed | Integer | 4 | When the sale happened |

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

### Transaction Logic

**Part 1. Bid Validation:**
Broker sees auctions from ALL teams across all teams in section
Query: SELECT * FROM marketplace WHERE status = 'ACTIVE' ORDER BY Auction End Time ASC
When Broker clicks "Bid" on an auction:
Check 1 - Bid Cap for the team:
Player Active Bids = COUNT(bids) WHERE bidder_id = [Current Player] AND status = 'ACTIVE'
If Player Active Bids >= 10:
Return Error: "Team bid limit reached (10/10). Wait for auctions to resolve."
Check 2- Budget Availability:
New Bid Amount = Current Bid + Bid Increment
If Team Budget < New Bid Amount:
Return Error: "Insufficient budget. Need $[bid amount] but have $[team budget]."

**Part 2. Bid Placement:**
The MRF who sent the material can put the price.
Update Marketplace:
Current Bid = New Bid Amount
High Bidder ID = Current Player ID
Increment player's active bid counter
Broadcast to ALL Brokers viewing this auction: "New high bid: $[amount] by Team [X]" Time_Remaining: [seconds]
Bid Price Increase
Bid_Increment Increase = MAX( Starting_Price * 0.05 per team click,  // 5% of starting price  $50                      // Minimum $50 raise)

**Part 3. Auction Resolution**
Expired Auctions = SELECT * FROM < Marketplace 
                   WHERE Auction End Time <= CURRENT_TIMESTAMP 
                   AND status = 'ACTIVE'

**Global Auctions**
For each expired auction, resolve based on three possible outcomes:

**Outcome A : Your team wins the material**
Condition: High Bidder Team ID == Origin Team ID
Action:
1. Record transaction: Transaction_Log.add({ type: "SELF WIN", amount: Final_Bid,  item: Item_ID})
   
2. Budget accounting (net-zero): Team Budget -= Final Bid  // Broker "pays"
Team Budget += Final Bid  // MRF who sent the material "receives the budget"
Result: Budget unchanged
   
3. Transfer material:
 Municipal Inventory [Material_Type] += Mass
   
4. Remove from marketplace:
Marketplace.status = 'SOLD'
   
  5. Notify team:
"Successfully secured [weight]t [Material Type] internally at $[amount]"
"Your materials are now in Municipality Inventory"

**Outcome B – Other team wins the material, but you sell for them sucessfully**
Condition: High Bidder Team ID != Origin Team ID
Action:
Financial settlement: Seller Team Budget += Final Bid // My team receives payment Buyer Team via the MRF sale
 Budget -= Final Bid // Other team pays
2. Material transfer: Buyer Municipal Inventory [Material_Type] += Mass
3. Transaction record: Transaction_Log.add({ type: "EXTERNAL_SALE", seller: Origin Team ID, buyer: High Bidder Team ID, amount: Final Bid, item: Item ID }) 
4. Notify both teams: To Seller: "✅ Sold [weight]t [Material type] to Team [Y] for $[amount]" 
To Buyer: "✅ Acquired [weight]t [Material type] for $[amount]. Materials in inventory."

**Outcome C – Liquidation, nobody buys anything**
Condition: High Bidder ID == NULL (no bids placed)
Action:
  1. Liquidate at 50% base price:
  Liquidation Price = Starting Price * 0.5 * Mass Seller Team Budget += Liquidation_Price
   
  2. Material scrapped (removed from game):
     // Material does NOT go to any inventory
   
  3. Notify selling team:
    "⚠️ No bids received for [weight]t [Material type]"
    "Sold to system scrappers for $[liquidation_price] (50% value)"

Regardless of the three outcomes, free the bid slot if the team is on the bid:
Player Active Bids -= 1  // Now player can bid on new auctions

**External Auctions**
UI Display: List of all 5 material types with "Buy" button. 

Randomize a fixed batch to last for the whole match at the start 
Initial Stock[Material Type] = Random(10, 65) tons

Example initialization:
  - Paper: 25 tons
  - Plastic: 43 tons
  - Metals: 18 tons
  - Glass: 52 tons
  - Wood: 31 tons

Requested Amount = Input from Broker
Available Stock = Current stock for that material type
If Requested Amount > Available Stock:
Return Error: "Only [Available Stock] tons available. Reduce quantity or wait for restock."
Stop execution

Example -when Broker clicks "Buy 10 tons Paper":
Markup Constant = 2.5
Cost = Base Material Price * External Markup * Mass
Example - Cost = $180 * 2.5 * 10 = $5,400
   
  2. Validation:
If Team Budget < Cost:
Return Error: "Insufficient budget. Need $5,400 but have $[budget]."
   
  3. Execute purchase:
Team Budget -= Total Cost
Municipal Inventory[Material] += Requested_Amount
External Stock[Material] -= Requested Amount
  
  4. Notify team:
"Purchased 10t Paper from External Wholesaler for $5,400"
"Material added to Municipality Inventory"

5. Restock the material type
If External Stock[Material] = 0:
  New Stock = Random(30, 80) tons
  External Stock[Material] = New_Stock
   
  Notify to Broker:
    "📦 External Wholesaler restocked: [Material] now has [New Stock] tons available"

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

**For the Admin View Only**
Display table with the global values of all the pairs ranked by Average Pair health in descending order. The table should look like:

| Rank | Pair ID | Average Pair Health | Team A Health | Team B Health | Status (Endgame) |
|------|---------|---------------------|---------------|---------------|------------------|
| 1 | pair-001 | 87.5% | 85% | 90% | Active |
| 2 | pair-002 | 72.0% | 72% | NULL | Team B Eliminated |
| 3 | pair-003 | 65.5% | 68% | 63% | Active |
