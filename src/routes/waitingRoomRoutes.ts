import { Router } from 'express';
import { protect } from '../middleware/auth';
import {
  createWaitingRoom,
  joinWaitingRoom,
  toggleReady,
  leaveWaitingRoom,
  getAvailableRooms,
  getWaitingRoom,
  startGameFromRoom,
} from '../controllers/waitingRoomController';

const router = Router();

// All routes require authentication
router.use(protect);

// Create or join rooms
router.post('/create', createWaitingRoom);
router.post('/join', joinWaitingRoom);

// Room actions
router.post('/toggle-ready', toggleReady);
router.post('/leave', leaveWaitingRoom);
router.post('/start-game', startGameFromRoom);

// Get rooms
router.get('/available', getAvailableRooms);
router.get('/:roomCode', getWaitingRoom);

export default router;