const jwt = require('jsonwebtoken');
import { Socket } from 'socket.io';
import { env } from '../config/env';
import User from '../models/User';

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
  authorizedSessionIds?: Set<string>;
}

/**
 * Socket.IO authentication middleware
 * Verifies JWT token from handshake auth
 */
export const socketAuthMiddleware = async (
  socket: AuthenticatedSocket,
  next: (err?: Error) => void
) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    // Verify JWT token
    const decoded = jwt.verify(token as string, env.JWT_SECRET) as {
      id: string;
      iat: number;
      exp: number;
    };

    // Check if user exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new Error('User not found'));
    }

        // Attach user info to socket
    socket.userId = user._id.toString();
    socket.authorizedSessionIds = new Set<string>();
    socket.user = {
      _id: user._id,

      name: user.name,
      email: user.email,
      role: user.role,
      accountType: user.accountType,
    };

    next();
  } catch (error) {
    console.error('Socket authentication error:', error);
    next(new Error('Authentication failed'));
  }
};

/**
 * Validate that user is part of the specified game session
 */
export const validateGameAccess = async (
  socket: AuthenticatedSocket,
  sessionId: string
): Promise<boolean> => {
  try {
    // Import here to avoid circular dependencies
    const { GameService } = await import('../services/gameService');
    const Lobby = (await import('../models/Lobby')).default;

    // First, check if user has a role in the game (if game exists)
    const userRole = await GameService.getPlayerRole(sessionId, socket.userId!);
    if (userRole !== null) {
      return true; // User is a player in the game
    }

    // If no game role, check if user has access to the lobby (for pairing queue)
    const lobby = await Lobby.findOne({ sessionId });
    if (lobby) {
      // Check if user is one of the players in the lobby or the leader
      const isLeader = lobby.leader?.toString() === socket.userId;
      const isPlayer = lobby.players?.some(
        (player: any) => player.userId?.toString() === socket.userId
      );

      if (isLeader || isPlayer) {
        return true; // User is in the lobby, allow access for pairing
      }
    }

    return false;
  } catch (error) {
    console.error('Game access validation error:', error);
    return false;
  }
};
