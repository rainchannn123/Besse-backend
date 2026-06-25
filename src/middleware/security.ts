import helmet from 'helmet';

export const securityHeaders = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
});

// CORS configuration
export const corsOptions = {
  origin:
    process.env.NODE_ENV === 'production'
      ? [
          'https://besse-game.vercel.app',
          'http://localhost:3000',
          'http://192.168.0.162:3000',
        ]
      : [
          'https://besse-game.vercel.app',
          'http://192.168.0.162:3000',
          'http://localhost:3000',
          'http://localhost:3001',
        ],
  credentials: true,
  optionsSuccessStatus: 200,
};
