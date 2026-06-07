import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

// Environment variable validation schema using Zod
// Validates and transforms environment variables with defaults and constraints

const envSchema = z.object({
  // Application environment mode - affects logging, error handling, and optimizations
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // Port number for the Express server to listen on
  PORT: z.string().default('5000').transform(Number),

  // MongoDB connection string for database operations (game sessions, users, etc.)
  MONGODB_URI: z.string().min(1, 'MongoDB URI is required'),

  // Secret key for JWT token signing and verification (keep secure!)
  JWT_SECRET: z.string().min(1, 'JWT secret is required'),

  // JWT token expiration time (e.g., '30d', '24h', '3600s')
  JWT_EXPIRE: z.string().default('30d'),

  // Primary frontend application URL for redirects and client communication
  FRONTEND_URL: z
    .string()
    .default(
      'http://localhost:3000,https://besse-frontend.vercel.app,http://192.168.0.162:3000'
    )
    .optional(),

  // Comma-separated list of allowed origins for CORS policy
  // Transforms string to array, removing brackets and filtering empty values
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:3000,https://besse-frontend.vercel.app,http://192.168.0.162:3000'
    )
    .transform(
      val =>
        val
          .replace(/[\[\]]/g, '') // Remove brackets if present
          .split(',') // Split by comma
          // .map(origin => origin.trim())
          .filter(Boolean) // Remove empty strings
    ),

  // Logging level for application logs (error, warn, info, debug)
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Admin monitor controls (separate from player/admin DB accounts)
  ADMIN_MONITOR_ENABLED: z
    .string()
    .default('true')
    .transform(value => value === 'true'),
  ADMIN_MONITOR_USERNAME: z.string().default(''),
  ADMIN_MONITOR_PASSWORD: z.string().default(''),
});

// Parse and validate environment variables
// Throws error if required variables are missing or invalid
export const env = envSchema.parse(process.env);
