import { IUser, LoginInput } from '../types';
import { generateToken } from '../utils/jwt';
import { findUserByEmail } from './userService';

export const loginUser = async (
  loginData: LoginInput
): Promise<{ user: IUser; token: string }> => {
  const { email, password } = loginData;

  // Find user and include password
  const user = await findUserByEmail(email);
  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
  }

  // Generate token
  const token = generateToken(user._id.toString());

  return { user, token };
};
