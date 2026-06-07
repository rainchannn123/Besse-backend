import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';

// Load environment variables from .env file
dotenv.config();

// Database connection function
// Establishes connection to MongoDB using MONGODB_URI from environment variables
const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI as string);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    // Exit process with failure code if database connection fails
    process.exit(1);
  }
};

export default connectDB;
