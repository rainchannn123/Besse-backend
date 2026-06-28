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

// ✅ Team routes - require user authentication
router.post('/rooms/join', protect, joinRoom);
router.post('/rooms/leave', protect, leaveRoom);

// ✅ Admin only routes
router.post('/rooms/admin-create', protectAdmin, adminCreateRoom);
router.post('/rooms/create', protectAdmin, createRoom);
router.post('/rooms/start', protectAdmin, startGame); // ✅ This is the key one
router.get('/rooms/all', protectAdmin, adminGetAllRooms);

// ⚠️ Keep dynamic routes after static routes to avoid '/rooms/all' being treated as roomCode='all'
router.get('/rooms/:roomCode/rankings', protect, getRoomRankings);
router.get('/rooms/:roomCode', getRoom);


export default router;