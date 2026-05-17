# Contributing to FarmPay

Thank you for your interest in contributing to FarmPay! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and professional. We're building technology to help farmers — let's keep that mission at the center of everything we do.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in Issues
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Environment details (OS, Node version, etc.)

### Suggesting Features

1. Check if the feature has been suggested in Issues
2. Create a new issue with:
   - Clear use case
   - Expected behavior
   - Why this benefits farmers or buyers
   - Potential implementation approach

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
   - Write clear, commented code
   - Follow existing code style
   - Add tests for new functionality
   - Update documentation
4. **Test your changes**
   ```bash
   # Test contract
   cd contracts/escrow
   cargo test
   
   # Test backend
   cd backend
   npm test
   
   # Test frontend
   cd frontend
   npm test
   ```
5. **Commit with clear messages**
   ```bash
   git commit -m "feat: add delivery confirmation notification"
   ```
6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Open a Pull Request**
   - Reference any related issues
   - Describe what changed and why
   - Include screenshots for UI changes

## Development Setup

See [GETTING_STARTED.md](docs/GETTING_STARTED.md) for detailed setup instructions.

## Code Style

### TypeScript/JavaScript
- Use TypeScript for type safety
- Follow ESLint configuration
- Use meaningful variable names
- Add JSDoc comments for public functions

### Rust
- Follow Rust standard style (rustfmt)
- Add doc comments for public functions
- Write comprehensive tests

### React
- Use functional components with hooks
- Keep components small and focused
- Use TypeScript for props
- Follow accessibility best practices

## Commit Message Format

Use conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add USDC balance check before order creation
fix: resolve escrow release timing issue
docs: update API documentation for dispute endpoint
```

## Testing

### Contract Tests
```bash
cd contracts/escrow
cargo test
```

### Backend Tests
```bash
cd backend
npm test
```

### Frontend Tests
```bash
cd frontend
npm test
```

### Integration Tests
```bash
npm run test:integration
```

## Documentation

- Update README.md for user-facing changes
- Update API.md for API changes
- Update ARCHITECTURE.md for architectural changes
- Add inline code comments for complex logic

## Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, maintainers will merge

## Areas We Need Help

- **Smart Contract Development**: Soroban contract improvements
- **Frontend Development**: UI/UX enhancements
- **Backend Development**: API endpoints and integrations
- **Testing**: Unit tests, integration tests, E2E tests
- **Documentation**: Guides, tutorials, API docs
- **Design**: UI mockups, user flows
- **Localization**: Translations for different regions

## Questions?

- Open a Discussion on GitHub
- Join our community chat
- Email: [contact email]

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping make FarmPay better for farmers worldwide! 🌾
