# Contributing to BESSE Backend

Thank you for your interest in contributing to the BESSE Backend! This document provides guidelines and information for contributors.

## 🚀 Quick Start

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
   ```bash
   git clone https://github.com/Concinniy-Limited/besse-backend.git
   cd besse-backend
   ```
3. **Set up development environment**
   ```bash
   npm install
   cp .env.example .env
   # Configure your .env file
   ```
4. **Start development server**
   ```bash
   npm run dev
   ```

## 📋 Development Workflow

### 1. Choose an Issue
- Check [GitHub Issues](https://github.com/your-org/besse-backend/issues) for open tasks
- Comment on the issue to indicate you're working on it
- Create a new branch for your work

### 2. Create a Branch
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-number-description
```

### 3. Make Changes
- Follow the existing code style and patterns
- Write clear, concise commit messages
- Test your changes thoroughly
- Update documentation if needed

### 4. Commit Your Changes
```bash
git add .
git commit -m "feat: add new feature description"
```

Use conventional commit format:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Testing
- `chore:` - Maintenance

### 5. Push and Create Pull Request
```bash
git push origin feature/your-feature-name
```
Then create a Pull Request on GitHub.

## 🛠️ Development Guidelines

### Code Style
- **TypeScript**: Strict mode enabled
- **ESLint**: Follow all linting rules
- **Prettier**: Code is automatically formatted
- **Imports**: Group imports (external, internal, types)

### Project Structure
```
src/
├── config/           # Configuration files
├── controllers/      # Route handlers
├── middleware/       # Express middleware
├── models/          # Mongoose schemas
├── routes/          # API route definitions
├── services/        # Business logic
├── types/           # TypeScript definitions
├── utils/           # Utility functions
└── app.ts           # Application entry point
```

### API Design
- **RESTful** endpoints with consistent naming
- **JSON** responses with consistent structure
- **Error handling** with proper HTTP status codes
- **Validation** using Zod schemas
- **Authentication** via JWT tokens

### Database
- **MongoDB** with Mongoose ODM
- **Indexes** for performance optimization
- **Validation** at schema level
- **Transactions** for data consistency

### Testing
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

### Security
- **Input validation** on all endpoints
- **Rate limiting** to prevent abuse
- **CORS** configuration for frontend access
- **Security headers** with Helmet
- **No sensitive data** in logs

## 🔧 Available Scripts

```bash
# Development
npm run dev              # Start development server
npm run build            # Build for production
npm run start            # Start production server

# Quality Assurance
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format code with Prettier
npm run type-check       # TypeScript type checking

# Testing
npm test                 # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage

# Docker
docker-compose -f docker-compose.dev.yml up  # Development environment
docker-compose up -d                         # Production deployment
```

## 📝 Documentation

### API Documentation
- Update `API_DOCUMENTATION.md` for new endpoints
- Include request/response examples
- Document error responses
- Update data models if changed

### Code Documentation
- Use JSDoc comments for functions
- Document complex business logic
- Explain non-obvious decisions

## 🐛 Reporting Issues

### Bug Reports
- Use the bug report template
- Include steps to reproduce
- Provide environment details
- Attach relevant logs

### Feature Requests
- Use the feature request template
- Describe the problem you're solving
- Explain your proposed solution
- Consider alternative approaches

## 📞 Getting Help

- **Documentation**: Check `API_DOCUMENTATION.md` and `README.md`
- **Issues**: Search existing GitHub issues
- **Discussions**: Use GitHub Discussions for questions
- **Code**: Read the source code and comments

## 🎯 Code of Conduct

This project follows a code of conduct to ensure a welcoming environment for all contributors. By participating, you agree to:

- Be respectful and inclusive
- Focus on constructive feedback
- Accept responsibility for mistakes
- Show empathy towards other contributors
- Help create a positive community

## 📄 License

By contributing to this project, you agree that your contributions will be licensed under the same license as the project (ISC License).

---

Thank you for contributing to BESSE! Your efforts help make the circular economy simulation game better for everyone. 🌍♻️