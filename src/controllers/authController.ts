import { Request, Response } from 'express';
import { loginUser } from '../services/authService';
import { createUser } from '../services/userService';
import { LoginInput, RegisterInput } from '../types';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';
import User from '../models/User';

export const register = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password, accountType } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      sendResponse(res, 409, 'User already exists with this email');
      return;
    }

    // Create new user
    // accountType defaults to 'student' if not provided
    // role is set to null initially (no game role selected yet)
    const user = await User.create({
      name,
      email,
      password,
      accountType: accountType || 'student',
      role: null,
      currentSession: null,
    });

    // Return user without password
    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      accountType: user.accountType,
      role: user.role,
      currentSession: user.currentSession,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    sendResponse(res, 201, 'User registered successfully', { user: userResponse });
  }
);

export const login = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const loginData: LoginInput = req.body;

    const { user, token } = await loginUser(loginData);

    // Return user with both accountType and role
    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      accountType: user.accountType,
      role: user.role,
      currentSession: user.currentSession,
    };

    sendResponse(res, 200, 'Login successful', { user: userResponse, token });
  }
);

export const getProfile = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      accountType: user.accountType,
      role: user.role,
      currentSession: user.currentSession,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    sendResponse(res, 200, 'Profile retrieved successfully', { user: userResponse });
  }
);

// NEW: Update user's game role (called when player selects Municipality/MRF/Broker)
export const updateUserRole = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user._id;
    const { role } = req.body;

    if (!role || !['municipality', 'mrf', 'broker'].includes(role)) {
      sendResponse(res, 400, 'Invalid role. Must be municipality, mrf, or broker');
      return;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    );

    if (!user) {
      sendResponse(res, 404, 'User not found');
      return;
    }

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      accountType: user.accountType,
      role: user.role,
      currentSession: user.currentSession,
    };

    sendResponse(res, 200, 'User role updated successfully', { user: userResponse });
  }
);