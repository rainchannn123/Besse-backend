import { Router } from 'express';
import {
  getRooms,
  getRoom,
  createRoom,
  joinRoom,
  leaveRoom,
  startGame,
  adminCreateRoom,
  getRoomRankings,
  adminGetAllRooms,
} from '../controllers/matchmakingController';
import { protectAdmin } from '../middleware/adminAuth';
import { protect } from '../middleware/auth';

const router = Router();

// ✅ Public routes - no authentication required
router.get('/rooms', getRooms);
router.get('/rooms/:roomCode', getRoom);

// ✅ Team routes - require user authentication
router.post('/rooms/join', protect, joinRoom);
router.post('/rooms/leave', protect, leaveRoom);

// ✅ Admin only routes
router.post('/rooms/admin-create', protectAdmin, adminCreateRoom);
router.post('/rooms/create', protectAdmin, createRoom);
router.post('/rooms/start', protectAdmin, startGame);  // ✅ This is the key one
router.get('/rooms/all', protectAdmin, adminGetAllRooms);
router.get('/rooms/:roomCode/rankings', protect, getRoomRankings);

export default router;