import { NextFunction, Request, Response } from 'express';
import { verifyAdminToken } from '../utils/jwt';

export interface AdminAuthRequest extends Request {
  admin?: {
    username: string;
    scope: 'admin-monitor';
  };
}

export const protectAdmin = (
  req: AdminAuthRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    let token: string | undefined;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Admin authorization required',
      });
      return;
    }

    const decoded = verifyAdminToken(token);

    req.admin = {
      username: decoded.username,
      scope: decoded.scope,
    };

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid admin token',
    });
  }
};
