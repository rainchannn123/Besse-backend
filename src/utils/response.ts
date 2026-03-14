import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export const sendResponse = <T>(
  res: Response,
  statusCode: number,
  message: string,
  data?: T,
  meta?: ApiResponse['meta']
): void => {
  const response: ApiResponse<T> = {
    success: statusCode < 400,
    message,
    data,
    meta,
  };

  res.status(statusCode).json(response);
};
