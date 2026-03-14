import { Request, Response } from 'express';
import { loginUser } from '../services/authService';
import { createUser } from '../services/userService';
import { LoginInput, RegisterInput } from '../types';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

export const register = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userData: RegisterInput = req.body;

    const user = await createUser(userData);

    sendResponse(res, 201, 'User registered successfully', { user });
  }
);

export const login = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const loginData: LoginInput = req.body;

    const { user, token } = await loginUser(loginData);

    sendResponse(res, 200, 'Login successful', { user, token });
  }
);

export const getProfile = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).user;

    sendResponse(res, 200, 'Profile retrieved successfully', { user });
  }
);
