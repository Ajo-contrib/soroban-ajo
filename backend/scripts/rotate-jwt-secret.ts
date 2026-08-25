/**
 * Helper script to generate secure cryptographic secrets and provide zero-downtime rotation instructions.
 * Usage: npx tsx scripts/rotate-jwt-secret.ts
 */

import crypto from 'crypto'

function generateSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64')
}

function generateHexSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex')
}

console.log('==============================================================================')
console.log('🔑 Soroban Ajo - Cryptographic Secret Generator & Rotation Helper')
console.log('==============================================================================\n')

const newJwtSecret = generateSecret(32)
const newAdminSecret = generateSecret(32)
const newDbPassword = generateHexSecret(16)
const newWebhookSecret = generateHexSecret(32)

console.log('Newly Generated High-Entropy Secrets (256-bit CSPRNG):')
console.log('------------------------------------------------------------------------------')
console.log(`JWT_SECRET            : ${newJwtSecret}`)
console.log(`ADMIN_JWT_SECRET      : ${newAdminSecret}`)
console.log(`DATABASE_PASSWORD     : ${newDbPassword}`)
console.log(`WEBHOOK_SIGNING_SECRET: ${newWebhookSecret}\n`)

console.log('Zero-Downtime JWT Secret Rotation Instructions:')
console.log('------------------------------------------------------------------------------')
console.log('1. Copy your CURRENT `JWT_SECRET` value.')
console.log('2. Set `JWT_SECRET_PREVIOUS=<YOUR_CURRENT_JWT_SECRET>` in your environment / secrets manager.')
console.log(`3. Set \`JWT_SECRET=${newJwtSecret}\` in your environment / secrets manager.`)
console.log('4. Redeploy backend instances. Active user sessions will continue to verify seamlessly.')
console.log('5. After 7 days (JWT_EXPIRES_IN), remove `JWT_SECRET_PREVIOUS` and redeploy.')
console.log('==============================================================================')
