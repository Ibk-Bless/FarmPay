# Contributing to FarmPay

Thank you for your interest in contributing to FarmPay! This document provides guidelines and instructions for contributing.

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Picking an issue

1. Browse issues labelled [`good first issue`](https://github.com/Ibk-Bless/FarmPay/labels/good%20first%20issue) (small, well-defined) or [`help wanted`](https://github.com/Ibk-Bless/FarmPay/labels/help%20wanted) (larger pieces of the roadmap). The `area:` labels show which part of the code an issue touches.
2. Comment on the issue to say you're taking it, and wait to be assigned before starting, so two people don't build the same thing.
3. If you can't continue, say so in the issue so it can be reassigned. Issues with no update for 7 days may be unassigned.

Every issue lists acceptance criteria. A pull request is ready to merge when it meets them and CI passes.

### Reporting bugs and suggesting features

Use the [issue templates](https://github.com/Ibk-Bless/FarmPay/issues/new/choose). For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

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
4. **Check your changes.** CI runs the same checks on every pull request.
   ```bash
   cd contracts/escrow && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   cd backend && npm run build          # backend type-check
   cd frontend && npm run lint && npm run build
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
feat: add Freighter wallet connection
fix: reject claim before review deadline in UI
docs: document resolve endpoint body
```

## Testing

- **Contract:** every change to `contracts/escrow/src/lib.rs` needs a test in `src/test.rs`. Run them with `cargo test`.
- **Backend and frontend:** there is no test runner yet, and adding one is a welcome contribution. Until then, check API changes against testnet. [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md#try-the-flow-from-the-command-line) shows how.

## Documentation

- Update `contracts/escrow/README.md` for any contract behaviour change, since it is the specification
- Update `docs/API.md` for API changes
- Update `docs/ARCHITECTURE.md` for architectural changes

## Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, maintainers will merge

## Areas We Need Help

See the unchecked items in the [README roadmap](README.md#roadmap). The biggest open areas are:

- **Frontend:** buyer and farmer dashboards, mobile layout, and support for more wallets
- **Backend:** an event indexer for order listing and delivery history, and a test runner
- **CI:** GitHub Actions for the contract, backend and frontend
- **Design:** a mobile-first farmer experience

## Questions?

Ask in the related issue, or open a new one.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping make FarmPay better for farmers worldwide! 🌾
