# API Details and Response Structures

This document outlines the API endpoints, request/response details, and UI integration notes for the Municipality Page, MRF-Collection Page, and Broker-Inventory Page.

## Municipality Page

### Waste Collection Tab

#### GET /api/municipality/:sessionId/waste-batches
- **Method**: GET
- **Description**: Retrieves the list of pending waste batches available for collection, including waste inventory, max capacity, and budget.
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "wasteBatches": [
        {
          "id": "batch123",
          "wasteType": "mixed",
          "amount": 1000,
          "maxCapacity": 1500,
          "budget": 500,
          "transportCost": 50
        }
      ]
    }
    ```

#### POST /api/municipality/:sessionId/collect-waste
- **Method**: POST
- **Description**: Collects a specific waste batch, deducting transport costs and updating game state.
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Request Body** (JSON):
  ```json
  {
    "batchId": "batch123"
  }
  ```
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "message": "Waste batch collected successfully",
      "updatedBudget": 450
    }
    ```

### City Projects Tab

#### GET /api/municipality/:sessionId/city-projects
- **Method**: GET
- **Description**: Retrieves the list of city projects and the municipality's current material inventory.
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "projects": [
        {
          "id": "project1",
          "name": "Park Renovation",
          "requiredMaterials": {
            "wood": 100,
            "plastic": 50
          },
          "healthBonus": 10
        }
      ],
      "inventory": {
        "wood": 200,
        "plastic": 100,
        "metal": 50,
        "glass": 30,
        "paper": 80
      }
    }
    ```

#### POST /api/municipality/:sessionId/construct-project
- **Method**: POST
- **Description**: Constructs a city project if materials are available, deducting from inventory and applying health bonuses.
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Request Body** (JSON):
  ```json
  {
    "projectId": "project1"
  }
  ```
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "message": "Project constructed successfully",
      "updatedInventory": {
        "wood": 100,
        "plastic": 50,
        "metal": 50,
        "glass": 30,
        "paper": 80
      },
      "healthBonusApplied": 10
    }
    ```

## MRF-Collection Page

### Process Waste from Collected Wastes

#### GET /api/mrf/queue/{sessionId}
- **Method**: GET
- **Description**: Retrieves the MRF processing queue (collected wastes waiting to be processed)
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "queue": [
        {
          "id": "waste1",
          "wasteType": "mixed",
          "amount": 1000,
          "collectedAt": "2023-10-01T12:00:00Z"
        }
      ]
    }
    ```

#### POST /api/mrf/process-waste
- **Method**: POST
- **Description**: Processes a specific waste batch from the queue into materials
- **Parameters**:
  - `sessionId` (body): The game session ID
- **Request Body** (JSON):
  ```json
  {
    "batchId": "waste1",
    "sessionId": "session123"
  }
  ```
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "message": "Waste processed successfully",
      "materialsProduced": {
        "paper": 200,
        "plastic": 150,
        "metal": 50,
        "glass": 30,
        "wood": 20
      }
    }
    ```

### Assign Grade and Price from Pending Auction List

#### GET /api/mrf/pending-auctions/{sessionId}
- **Method**: GET
- **Description**: Retrieves pending auctions created from processed waste
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "pendingAuctions": [
        {
          "id": "auction1",
          "materialType": "paper",
          "mass": 200,
          "createdAt": "2023-10-01T13:00:00Z"
        }
      ]
    }
    ```

#### POST /api/mrf/assign-grade
- **Method**: POST
- **Description**: Assigns quality grade (A/B/C/F) and manual entry price to activate auctions
- **Parameters**:
  - `sessionId` (body): The game session ID
- **Request Body** (JSON):
  ```json
  {
    "auctionId": "auction1",
    "grade": "A",
    "price": 100,
    "sessionId": "session123"
  }
  ```
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "message": "Grade and price assigned successfully",
      "auctionActivated": true
    }
    ```

## Broker-Inventory Page

### Tab 1: Global Auctions

#### GET /api/broker/auctions/{sessionId}
- **Method**: GET
- **Description**: Retrieves all active auctions from all teams across the game
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "auctions": [
        {
          "id": "auction1",
          "materialType": "paper",
          "grade": "A",
          "mass": 200,
          "currentBid": 95,
          "timeRemaining": 3600,
          "sellerTeam": "TeamA"
        }
      ]
    }
    ```

### Tab 2: External Wholesaler

#### GET /api/broker/external-stock/{sessionId}
- **Method**: GET
- **Description**: Get current stock levels for all 5 material types
- **Parameters**:
  - `sessionId` (path): The game session ID
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "stock": {
        "paper": 500,
        "plastic": 300,
        "metal": 200,
        "glass": 150,
        "wood": 100
      }
    }
    ```

#### POST /api/broker/buy-external
- **Method**: POST
- **Description**: Purchase materials from external wholesaler
- **Request Body** (JSON):
  ```json
  {
    "materialType": "paper",
    "requestedAmount": 100,
    "sessionId": "session123"
  }
  ```
- **Response**:
  - **Status**: 200 OK
  - **Body** (JSON):
    ```json
    {
      "message": "Purchase successful",
      "purchasedAmount": 100,
      "updatedStock": {
        "paper": 400,
        "plastic": 300,
        "metal": 200,
        "glass": 150,
        "wood": 100
      }
    }
    ```

### UI Implementation Notes
- **Global Auctions Tab**: Display list of auctions with bid buttons. Each auction shows material type, grade, mass, current bid, time remaining.
- **External Wholesaler Tab**: Display fixed list of 5 material types with stock amounts and buy buttons. Stock auto-restocks randomly between 30-80 tons when depleted.