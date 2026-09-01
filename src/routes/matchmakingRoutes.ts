import { Router } from 'express';
import {
  getRooms,
  getRoom,
  getSessionActiveRoom,
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
import { idempotency } from '../middleware/idempotency';

const router = Router();

// ✅ Public routes - no authentication required
router.get('/rooms', getRooms);

// ✅ Team routes - require user authentication
router.post('/rooms/join', protect, joinRoom);
router.post('/rooms/leave', protect, leaveRoom);
router.get('/rooms/session/:sessionId', protect, getSessionActiveRoom);

// ✅ Admin only routes
router.post('/rooms/admin-create', protectAdmin, adminCreateRoom);
router.post('/rooms/create', protectAdmin, createRoom);
router.post(
  '/rooms/start',
  protectAdmin,
  idempotency({
    scope: 'matchmaking.start-game',
    resolveScope: (req) => String(req.body?.roomCode || ''),
    ttlSeconds: 180,
  }),
  startGame
); // ✅ This is the key one
router.get('/rooms/all', protectAdmin, adminGetAllRooms);

// ⚠️ Keep dynamic routes after static routes to avoid '/rooms/all' being treated as roomCode='all'
router.get('/rooms/:roomCode/rankings', protect, getRoomRankings);
router.get('/rooms/:roomCode', getRoom);


export default router;
