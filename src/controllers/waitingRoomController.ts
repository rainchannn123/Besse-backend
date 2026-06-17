import { Request, Response } from 'express';
import { WaitingRoomService } from '../services/waitingRoomService';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

// Create a new waiting room
export const createWaitingRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId, teamName } = req.body;

    const waitingRoom = await WaitingRoomService.createWaitingRoom(sessionId, teamName);

    sendResponse(res, 201, 'Waiting room created successfully', { waitingRoom });
  }
);

// Join an existing waiting room
export const joinWaitingRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode, sessionId, teamName } = req.body;

    const waitingRoom = await WaitingRoomService.joinWaitingRoom(roomCode, sessionId, teamName);

    sendResponse(res, 200, 'Joined waiting room successfully', { waitingRoom });
  }
);

// Toggle ready status
export const toggleReady = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode, sessionId, isReady } = req.body;

    const waitingRoom = await WaitingRoomService.toggleReady(roomCode, sessionId, isReady);

    sendResponse(res, 200, 'Ready status updated', { waitingRoom });
  }
);

// Leave waiting room
export const leaveWaitingRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode, sessionId } = req.body;

    const result = await WaitingRoomService.leaveWaitingRoom(roomCode, sessionId);

    sendResponse(res, 200, 'Left waiting room successfully', result);
  }
);

// Get all available waiting rooms
export const getAvailableRooms = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const rooms = await WaitingRoomService.getAvailableRooms();

    sendResponse(res, 200, 'Available rooms retrieved', { rooms });
  }
);

// Get waiting room by code
export const getWaitingRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode } = req.params;

    const waitingRoom = await WaitingRoomService.getWaitingRoom(roomCode);

    if (!waitingRoom) {
      sendResponse(res, 404, 'Waiting room not found');
      return;
    }

    sendResponse(res, 200, 'Waiting room retrieved', { waitingRoom });
  }
);

// Start game from waiting room - UPDATED
export const startGameFromRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode } = req.body;

    const result = await WaitingRoomService.startGame(roomCode);

    sendResponse(res, 200, 'Game starting', result);
  }
);