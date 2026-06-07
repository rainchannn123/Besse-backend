# BESSE Backend

A comprehensive REST API backend for **BESSE** (Circular Economy Simulation Game), a real-time multiplayer cooperative game where three specialized roles work together to manage urban waste systems and balance competing objectives.

## 🎯 Game Overview

**BESSE** is a cooperative resource management simulation where players take on specialized roles to manage a city's circular economy:

- **🏛️ Municipality**: Waste collection and transportation logistics
- **🏭 MRF (Material Recovery Facility)**: Waste processing and material quality grading
- **💼 Broker**: Material trading and city project resource allocation

**Core Objectives**: Balance three competing metrics within a 30-minute real-time session:
- 💰 **Budget**: $10,000 starting capital
- ❤️ **City Health**: 100% starting health (target: 60%+ to win)
- 🌱 **CO₂ Emissions**: Minimize environmental impact

## ✨ Key Features

### 🔐 Security & Authentication
- JWT-based authentication with role-based access control
- Secure password hashing with bcrypt
- Rate limiting and request throttling
- Input validation with Zod schemas
- CORS protection and security headers

### 🎮 Game Mechanics
- **Real-time waste generation** (every 2 minutes)
- **Role-based cooperative gameplay** (Municipality, MRF, Broker)
- **Dynamic material processing** with quality grading (A/B/C/F)
- **Marketplace trading system** with external sales
- **City project management** with resource allocation
- **Health penalty system** for overdue waste and rejections
- **Win/lose conditions** with 3-minute countdown recovery
- **Automatic system checks** every 30 seconds
- **Real-time health recalculation** after every action

### 🏗️ Technical Architecture
- **TypeScript** for type safety and developer experience
- **MongoDB** with Mongoose ODM for data persistence
- **Express.js** with modular routing architecture
- **Socket.IO** for real-time WebSocket communication
- **Comprehensive error handling** with custom error classes
- **Request logging** and performance monitoring
- **Docker support** for containerized deployment
- **Automated background processes** for game mechanics

### 📊 Advanced Features
- **Concurrency control** with active locks to prevent race conditions
- **Real-time game state** synchronization across all players
- **Transaction audit trail** for all marketplace activities
- **Material ownership tracking** (MRF → Broker → Municipality)
- **Dynamic pricing** based on quality grades (A: 1.25x, B: 1.0x, C: 0.5x)
- **Environmental impact tracking** (CO₂ emissions: transport 1.6t/trip, landfill 2.5t/ton)
- **Comprehensive activity logging** with detailed health change breakdowns
- **Automatic waste rejection penalties** with proper CO2 and health calculations

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- MongoDB 6.0+

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Concinniy-Limited/besse-backend.git
   cd besse-backend
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Start MongoDB**
   ```bash
   # Using Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest

   # Or using local MongoDB installation
   mongod
   ```

5. **Development Mode**
   ```bash
   npm run dev
   ```

6. **Production Build**
   ```bash
   npm run build
   npm start
   ```

### Docker Deployment

#### Development with Docker Compose
```bash
# Start development environment with MongoDB and Mongo Express
docker-compose -f docker-compose.dev.yml up

# Access points:
# - API: http://localhost:5000
# - Mongo Express (DB GUI): http://localhost:8081 (admin/admin123)
```

#### Production Deployment
```bash
# Build and start production environment
docker-compose up -d

# View logs
docker-compose logs -f besse-backend

# Scale the application
docker-compose up -d --scale besse-backend=3
```

#### Manual Docker Build
```bash
# Build the image
docker build -t besse-backend .

# Run the container
docker run -p 5000:5000 --env-file .env besse-backend
```

## 📚 API Documentation

Complete API documentation is available in [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md), including:

- **Authentication endpoints** (register, login, profile)
- **Lobby management** (create/join, role selection, game start)
- **Role-specific endpoints** for Municipality, MRF, and Broker
- **Game state management** and real-time updates
- **Comprehensive examples** with cURL commands

### 🎯 Frontend Integration Guide

For frontend developers, a dedicated integration guide is available in [`FRONTEND_INTEGRATION_GUIDE.md`](./FRONTEND_INTEGRATION_GUIDE.md), featuring:

- **TypeScript interfaces** for all request/response objects
- **WebSocket integration patterns** with complete examples
- **React hooks** for game state management
- **Error handling strategies** and best practices
- **Complete integration examples** with working code samples

### Core API Endpoints

#### Authentication
```bash
POST /api/auth/register    # User registration
POST /api/auth/login       # User authentication
GET  /api/auth/profile     # Get user profile
```

#### Lobby & Game Setup
```bash
GET    /api/lobby/available           # View available lobbies
POST   /api/lobby/join                # Create or join lobby
POST   /api/lobby/select-role         # Choose role (first-come, first-served)
POST   /api/lobby/start-game          # Start game when ready
```

#### Municipality Role
```bash
GET    /api/municipality/waste-batches/:sessionId  # View pending waste
POST   /api/municipality/collect-waste             # Collect waste (transport costs)
POST   /api/municipality/reject-waste              # Reject waste (health penalty)
```

#### MRF Role
```bash
GET    /api/mrf/queue/:sessionId         # View processing queue
POST   /api/mrf/process-waste            # Process waste into materials
POST   /api/mrf/assign-grade             # Grade materials (A/B/C/F)
GET    /api/mrf/inventory/:sessionId     # View MRF materials
```

#### Broker Role
```bash
GET    /api/broker/marketplace/:sessionId           # View marketplace
POST   /api/broker/buy-material                     # Purchase materials
POST   /api/broker/sell-external                    # Sell to external market
POST   /api/broker/transfer-municipality            # Allocate to projects
GET    /api/broker/projects/:sessionId              # View city projects
GET    /api/broker/transactions/:sessionId          # Transaction history
```

#### Game Management
```bash
GET    /api/games/:sessionId               # Get current game state
POST   /api/games/:sessionId/end-turn      # End current turn
POST   /api/games/:sessionId/system-check  # Trigger system updates
```

## 🛠️ Development

### Available Scripts
```bash
npm run dev              # Start development server with hot reload
npm run build            # Build for production
npm run start            # Start production server
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format code with Prettier
npm run type-check       # TypeScript type checking
npm run clean            # Clean build artifacts
```

### Project Structure
```
besse-backend/
├── src/
│   ├── config/           # Database and environment configuration
│   ├── controllers/      # Route handlers by feature
│   ├── middleware/       # Express middleware (auth, security, logging)
│   ├── models/          # Mongoose schemas
│   ├── routes/          # API route definitions
│   ├── services/        # Business logic layer
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   └── app.ts           # Express application setup
├── tests/               # Test suites
├── .env.example         # Environment variables template
├── docker-compose.yml   # Docker services
├── Dockerfile          # Container configuration
└── package.json        # Dependencies and scripts
```

### Environment Variables
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/besse
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d
LOG_LEVEL=info
ALLOWED_ORIGINS=http://localhost:3000,https://besse-frontend.vercel.app
FRONTEND_URL=http://localhost:3000,https://besse-frontend.vercel.app
```

## 🐳 Docker Deployment

### Using Docker Compose
```bash
# Development
docker-compose -f docker-compose.dev.yml up

# Production
docker-compose up -d
```

### Manual Docker Build
```bash
docker build -t besse-backend .
docker run -p 5000:5000 --env-file .env besse-backend
```

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

## 📊 Monitoring & Logging

- **Colorful Request Logging**: All API requests logged with structured, color-coded logger including timestamps, status codes, and performance metrics
- **Error Tracking**: Structured error responses with stack traces in development
- **Performance Monitoring**: Response time tracking with automatic log level assignment (error/warn/info based on HTTP status)
- **Database Monitoring**: Connection health checks
- **Configurable Log Levels**: Environment-based logging verbosity (error, warn, info, debug)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript strict mode
- Write comprehensive tests for new features
- Update API documentation for endpoint changes
- Use conventional commit messages
- Ensure all linting passes

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

For questions, issues, or contributions:
- 🐛 **Issues**: [GitHub Issues](https://github.com/Concinniy-Limited/besse-backend/issues)
- 📖 **Documentation**: [API Docs](./API_DOCUMENTATION.md)

---

**BESSE** - Building sustainable futures through cooperative gaming! 🌍♻️
