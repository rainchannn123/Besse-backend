import User from '../models/User';
import { IUser, RegisterInput } from '../types';

export const createUser = async (userData: RegisterInput): Promise<IUser> => {
  const existingUser = await User.findOne({ email: userData.email });
  if (existingUser) {
    throw new Error('User already exists with this email');
  }

  const user = new User(userData);
  return await user.save();
};

export const findUserByEmail = async (email: string): Promise<IUser | null> => {
  return await User.findOne({ email }).select('+password');
};

export const findUserById = async (id: string): Promise<IUser | null> => {
  return await User.findById(id);
};

export const getAllUsers = async (): Promise<IUser[]> => {
  return await User.find().sort({ createdAt: -1 });
};

export const addGameSessionToUser = async (
  userId: string,
  sessionId: string
): Promise<void> => {
  await User.findByIdAndUpdate(userId, {
    $addToSet: { gameSessions: sessionId },
  });
};
