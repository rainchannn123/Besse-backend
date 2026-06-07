const jwt = require('jsonwebtoken');
import { DecodedToken } from '../types';

interface AdminDecodedToken {
  username: string;
  scope: 'admin-monitor';
  iat: number;
  exp: number;
}

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

export const generateAdminToken = (username: string): string => {
  const config = getJwtConfig();
  return jwt.sign(
    { username, scope: 'admin-monitor' },
    config.secret,
    {
      expiresIn: '8h',
    }
  );
};

export const verifyAdminToken = (token: string): AdminDecodedToken => {
  const config = getJwtConfig();
  const decoded = jwt.verify(token, config.secret) as AdminDecodedToken;

  if (!decoded.scope || decoded.scope !== 'admin-monitor') {
    throw new Error('Invalid admin token scope');
  }

  return decoded;
};
