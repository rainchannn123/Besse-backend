import { Router } from 'express';
import { getProfile, login, register, updateUserRole } from '../controllers/authController';
import { protect } from '../middleware/auth';
import { validate } from '../utils/validation';
import { z } from 'zod';

const router = Router();

// ✅ Define schemas inline
const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user account
 *     tags: [Authentication]
 */
router.post('/register', validate(registerSchema), register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Authenticate user and receive JWT token
 *     tags: [Authentication]
 */
router.post('/login', validate(loginSchema), login);

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     summary: Get current user's profile information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.get('/profile', protect, getProfile);

/**
 * @swagger
 * /api/auth/update-role:
 *   put:
 *     summary: Update user's game role
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.put('/update-role', protect, updateUserRole);

export default router;