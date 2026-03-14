const jwt = require('jsonwebtoken');
import { DecodedToken } from '../types';

interface JwtConfig {
  secret: string;
  expiresIn: string | number;
}

const getJwtConfig = (): JwtConfig => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRE;

  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not defined');
  }

  return {
    secret,
    expiresIn: expiresIn || '2h',
  };
};

export const generateToken = (userId: string): string => {
  const config = getJwtConfig();
  return jwt.sign({ id: userId }, config.secret, {
    expiresIn: config.expiresIn,
  });
};

export const verifyToken = (token: string): DecodedToken => {
  const config = getJwtConfig();
  return jwt.verify(token, config.secret) as DecodedToken;
};
