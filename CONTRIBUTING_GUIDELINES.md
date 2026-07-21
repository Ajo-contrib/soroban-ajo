# Contributing Guide

Thank you for your interest in contributing to the Ajo decentralized savings platform. This guide outlines the standards and processes to follow when contributing to the project.

---

## Overview

This project is a monorepo consisting of:

* Smart contracts written in Rust (Soroban)
* Backend API built with Node.js and Express
* Frontend application built with Next.js and TypeScript

Contributions should maintain consistency, security, and code quality across all parts of the system.

---

## Getting Started

### Prerequisites

* Node.js 20+
* Rust 1.70+
* Stellar CLI
* Git

### Setup

```bash
# Fork the repository and clone your fork
git clone https://github.com/<your-username>/soroban-ajo.git
cd soroban-ajo

# Install dependencies
npm run install:all

# Set up environment variables
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

---

## Development Workflow

1. Create a new branch from `master`:

```bash
git checkout -b feat/<short-description>
```

2. Make your changes following the project standards

3. Run all checks locally:

```bash
npm run lint
npm run type-check
npm run test:contracts
```

4. Commit your changes using clear commit messages

5. Push your branch and open a Pull Request

---

## Code Style Guidelines

### General

* Use clear and descriptive variable and function names
* Keep functions small and focused
* Avoid unnecessary complexity
* Write self-documenting code where possible

---

### Frontend (Next.js / TypeScript)

* Use TypeScript for all components and logic
* Follow React best practices:

  * Functional components only
  * Use hooks appropriately
* Keep components modular and reusable
* Use consistent file and folder naming

#### Linting

```bash
cd frontend
npm run lint
```

---

### Backend (Node.js / Express)

* Use TypeScript for all backend code
* Validate inputs using Zod
* Use async/await instead of callbacks
* Keep controllers thin and move logic into services
* Handle errors consistently

#### Service Pattern

Services live in `backend/src/services/` and are instantiated directly —
there is no DI/IoC container in this codebase (see
[ADR-012](docs/ARCHITECTURE_DECISION_RECORDS.md#adr-012-service-instantiation-pattern--retire-the-di-container)
for why one was removed). Pick the pattern that matches the service's
shape:

* **Stateful service used app-wide (default choice)**: export a singleton
  instance created at module load.
  ```ts
  class NotificationService { /* ... */ }
  export const notificationService = new NotificationService()
  ```
  Import the singleton directly (`import { notificationService } from
  '../services/notificationService'`) wherever it's needed. To substitute a
  mock in tests, use `jest.mock('../services/notificationService')`.
* **Service that needs per-request or per-call state**: export the class
  and let the caller instantiate it where needed, e.g. a controller
  constructing it with request-scoped config.
* **Stateless logic with no instance data**: export plain functions instead
  of a class (a "function module"), e.g. `searchService.ts`.

Do not introduce a new DI container, service locator, or registry —
consolidate on one of the patterns above.

#### Linting and Type Checking

```bash
cd backend
npm run lint
npm run type-check
```

---

### Smart Contracts (Rust / Soroban)

* Follow Rust best practices
* Avoid panics in production logic
* Use explicit error handling
* Validate all inputs

#### Formatting and Testing

```bash
cd contracts/ajo

# Format code
cargo fmt

# Run tests
cargo test
```

---

## Testing Requirements

All contributions must include appropriate tests.

### Smart Contracts

* Unit tests are required for all contract logic
* Cover edge cases and invalid inputs
* Ensure no unexpected panics

```bash
npm run test:contracts
```

---

### Backend

* Ensure type safety
* Validate all inputs
* Add tests where applicable

```bash
cd backend
npm run type-check
npm run lint
```

---

### Frontend

* Ensure components render correctly
* Avoid breaking UI or state flows
* Maintain type safety

```bash
cd frontend
npm run type-check
npm run lint
```

---

## Pull Request Process

### Before Submitting

Ensure that:

* Code passes all lint checks
* Type checks pass
* Contract tests pass
* No sensitive data is included
* Code follows project structure and conventions

---

### PR Guidelines

* Use clear and descriptive titles:

  * `feat: add dispute voting UI`
  * `fix: handle invalid contribution input`
  * `docs: add security best practices guide`

* Provide a detailed description:

  * What was changed
  * Why it was changed
  * Any relevant context or screenshots

* Keep PRs focused and small where possible

---

### Review Process

* Maintainers will review your PR
* You may be asked to make changes
* Once approved, your PR will be merged

---

## Branch Naming Convention

Use the following formats:

* `feat/<feature-name>`
* `fix/<bug-description>`
* `docs/<documentation-update>`
* `chore/<maintenance-task>`

---

## Commit Message Guidelines

Follow a simple conventional format:

```
type: short description
```

Examples:

* `feat: implement arbitration voting system`
* `fix: prevent double withdrawal`
* `docs: update contributing guide`

---

## Security Considerations

* Do not expose secrets or private keys
* Validate all user inputs
* Follow the security best practices guide
* Report vulnerabilities responsibly

---

## Documentation

* Update documentation when introducing new features
* Keep README and relevant docs in sync with changes
* Write clear and concise explanations

---

## Need Help?

If you have questions:

* Open an issue for discussion
* Ask for clarification in your Pull Request

---

## Summary

To contribute successfully:

* Follow coding standards
* Write tests
* Keep changes focused
* Document your work clearly

Consistent, high-quality contributions help keep the project reliable and maintainable.
