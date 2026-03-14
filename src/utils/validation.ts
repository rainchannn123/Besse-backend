import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';

interface ValidationData {
  body?: any;
  query?: any;
  params?: any;
}

export const validate =
  (schema: ZodSchema<ValidationData>) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      next(error);
    }
  };
