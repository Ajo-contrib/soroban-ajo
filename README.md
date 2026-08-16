# Ajo

Ajo is a decentralized savings-group platform built on Stellar's Soroban smart contracts. It brings the traditional "Ajo" / "susu" / Rotating Savings and Credit Association (ROSCA) model on-chain, letting communities pool and cycle contributions with full transparency, auditable transaction history, and no central custodian.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

The project is a monorepo with four independently deployable parts:

| Component       | Path                             | Stack                                             |
| --------------- | -------------------------------- | ------------------------------------------------- |
| Smart contracts | [`contracts/ajo`](contracts/ajo) | Rust / Soroban                                    |
| API server      | [`backend`](backend)             | Node.js, Express, TypeScript, Prisma              |
| Web app         | [`frontend`](frontend)           | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Mobile app      | [`mobile`](mobile)               | React Native / Expo                               |

## Features

- Create and manage savings groups with configurable contribution rules
- Member onboarding, invitations, and role management
- Scheduled contributions and automated payout tracking
- Fully auditable on-chain transaction history
- Dispute filing, voting, and admin arbitration
- Group analytics and gamification (achievements, leaderboards)
- Stellar wallet integration (Freighter and others)
- Multi-language support (English, Spanish, French, Portuguese, Arabic, Swahili, Chinese)

## Getting Started

### Prerequisites

- Node.js 20+
- Rust 1.70+ and the [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools#cli)
- Git

### Installation

```bash
git clone https://github.com/Ajo-contrib/soroban-ajo.git
cd soroban-ajo

# Install root, frontend, and backend dependencies
npm run install:all

# Mobile has its own dependency tree
cd mobile && npm install
```

### Configure environment variables

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp mobile/.env.example mobile/.env
```

Fill in your Stellar RPC URL and deployed contract ID in each file (see [Environment Variables](#environment-variables) below).

### Run the smart contracts

```bash
cd contracts/ajo
stellar contract build
cargo test
```

To deploy to testnet, use the helper script from the repo root:

```bash
scripts/deploy_testnet.sh
```

This provisions a deployer identity, builds and optimizes the contract, deploys to Stellar testnet, and writes the resulting contract ID to `contract-id.txt`.

### Run the backend and frontend

```bash
# From the repo root — runs both concurrently
npm run dev
```

- Backend API: http://localhost:3001 (interactive API docs at `/api-docs`)
- Frontend: http://localhost:3000

Or run each independently:

```bash
npm run dev:backend    # Express on :3001
npm run dev:frontend   # Next.js on :3000
```

### Run the mobile app

```bash
cd mobile
npm start
```

## Environment Variables

**`backend/.env`**

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/ajo
JWT_SECRET=<your_jwt_secret>
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
SOROBAN_CONTRACT_ID=<your_contract_id>
```

**`frontend/.env.local`**

```env
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_SOROBAN_CONTRACT_ID=<your_contract_id>
NEXT_PUBLIC_API_URL=http://localhost:3001
```

See `backend/.env.example` and `frontend/.env.example` for the complete list of optional integrations (Stripe, PayPal, email, SMS, etc.).

## Testing

```bash
npm run type-check      # TypeScript, frontend + backend
npm run lint             # ESLint, frontend + backend
npm run test:contracts   # Rust contract tests
```

## Automated Health Checks

The repository includes an automated health-check workflow that runs daily at ~06:17 UTC (and can be triggered manually from the Actions tab). It performs the same checks a maintainer would run manually:

- **Smart Contracts**: native build (`cargo build`), `cargo test`, and WASM release build (`cargo build --target wasm32-unknown-unknown --release`)
- **Frontend**: TypeScript type check (`npx tsc --noEmit`)
- **Backend**: TypeScript type check (`npx tsc --noEmit`)

Results are posted to a single tracking issue titled **"🩺 Automated Health Check Report"**. The workflow:

1. Creates the tracking issue on first run
2. Updates the same issue on subsequent runs (no issue spam)
3. Reports pass/fail status and error counts for each check
4. Pings the repository owner with an alert comment when a regression is detected

To run the health checks locally:

```bash
# Run the checks and generate result files
# (see .github/workflows/health-check.yml for the exact commands)

# Preview the tracking issue report without posting it
node scripts/health-check-report.js --dry-run --results /path/to/results

# Post/update the tracking issue
node scripts/health-check-report.js --results /path/to/results --token <GITHUB_TOKEN> --repo owner/repo
```

## Deployment

- **Contracts**: `stellar contract deploy` against testnet or mainnet (see [Smart Contract Documentation](docs/SMART_CONTRACT_DOCUMENTATION.md))
- **Backend**: any Node.js host (Railway, Render, Fly.io, AWS/GCP/Azure) — `npm run build && npm start`
- **Frontend**: [Vercel](https://vercel.com) — set the project's Root Directory to `frontend`

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for full deployment instructions.

## Documentation

- [Developer Onboarding](docs/DEVELOPER_ONBOARDING.md)
- [Architecture Decision Records](docs/ARCHITECTURE_DECISION_RECORDS.md)
- [Smart Contract Documentation](docs/SMART_CONTRACT_DOCUMENTATION.md) / [Integration Guide](docs/SMART_CONTRACT_INTEGRATION.md)
- [i18n Architecture](docs/I18N_ARCHITECTURE.md)
- [User Guide](docs/USER_GUIDE.md) / [Tutorials](docs/USER_GUIDE_TUTORIALS.md)
- [Frontend README](frontend/README.md) · [Backend README](backend/README.md) · [Mobile README](mobile/README.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Distributed under the terms of the [MIT License](LICENSE).

## Resources

- [Stellar Developer Docs](https://developers.stellar.org/)
- [Soroban Docs](https://soroban.stellar.org/docs)
- [Next.js Documentation](https://nextjs.org/docs)

## Support

For questions, bug reports, or feature requests, please [open an issue](https://github.com/Ajo-contrib/soroban-ajo/issues).
