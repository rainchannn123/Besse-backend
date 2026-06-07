const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BESSE Backend API',
      version: '1.0.0',
      description:
        'A comprehensive REST API backend for BESSE (Circular Economy Simulation Game) - A real-time multiplayer cooperative game where three specialized roles work together to manage urban waste systems and balance competing objectives: Budget ($), City Health (%), and CO₂ Emissions.',
      contact: {
        name: 'BESSE Development Team',
        email: 'team@besse-game.com',
        url: 'https://besse-game.vercel.app',
      },
      license: {
        name: 'ISC',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server',
      },
      {
        url: 'https://besse-game.vercel.app',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: 'Error message',
            },
            error: {
              type: 'object',
              description: 'Additional error details',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              example: '507f1f77bcf86cd799439011',
            },
            username: {
              type: 'string',
              example: 'johndoe',
            },
            email: {
              type: 'string',
              example: 'john@example.com',
            },
            role: {
              type: 'string',
              enum: ['municipality', 'mrf', 'broker'],
              example: 'municipality',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        GameSession: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              example: '507f1f77bcf86cd799439011',
            },
            sessionId: {
              type: 'string',
              example: 'ABC123',
            },
            status: {
              type: 'string',
              enum: ['waiting', 'active', 'completed'],
              example: 'active',
            },
            currentTurn: {
              type: 'number',
              example: 5,
            },
            budget: {
              type: 'number',
              example: 100000,
            },
            cityHealth: {
              type: 'number',
              example: 85,
            },
            co2Emissions: {
              type: 'number',
              example: 1200,
            },
            players: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/User',
              },
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad Request - Invalid input data',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        Unauthorized: {
          description: 'Unauthorized - Invalid or missing authentication token',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        Forbidden: {
          description: 'Forbidden - Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        NotFound: {
          description: 'Not Found - Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        Conflict: {
          description: 'Conflict - Resource already exists',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

const specs = swaggerJSDoc(options);

export { specs, swaggerUi };
