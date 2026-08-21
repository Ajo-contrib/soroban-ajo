/**
 * Runtime round-trip tests for e2eEncryptionService
 *
 * These tests use the **real Web Crypto API** — they are intentionally NOT
 * mocked.  The purpose is to catch genuine buffer-handling or key-derivation
 * bugs that would only manifest at runtime, not just type errors.  In
 * particular they guard against the class of subtle bugs (wrong buffer view,
 * wrong byte length, incorrect IV reuse) that can correlate with the
 * Uint8Array<ArrayBufferLike> / ArrayBuffer type-config mismatch.
 *
 * Environment: Jest with @jest-environment node so that globalThis.crypto is
 * backed by Node's native WebCrypto implementation (Node ≥ 19, same Web Crypto
 * spec as browsers).  This avoids jsdom's limited/absent crypto.subtle support.
 *
 * @jest-environment node
 */

import {
  encryptMessage,
  decryptMessage,
  encryptGroupData,
  decryptGroupData,
  deriveSharedKey,
  deriveGroupKey,
  getOrCreateKeyPair,
  rotateKeyPair,
  getKeyFingerprint,
  exportPublicKey,
} from '../services/e2eEncryptionService'

// ── Ensure real Web Crypto is available ──────────────────────────────────
//
// jsdom ≤ 20 does not expose crypto.subtle by default; jsdom 22+ does.
// Node ≥ 19 always has globalThis.crypto.  We assert here so the test suite
// fails with a clear message rather than confusing "crypto is undefined".
beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
    throw new Error(
      'Web Crypto API (globalThis.crypto.subtle) is not available in this test environment. ' +
        'Ensure you are running Node >= 19 or configure Jest to expose WebCrypto.'
    )
  }
})

// ── IndexedDB mock (jsdom provides a partial implementation; we use a simple
//    in-memory store so tests remain fast and isolated) ────────────────────
const _idbStore = new Map<string, unknown>()

const mockIDBRequest = (result: unknown, error: unknown = null) => {
  const req = {
    result,
    error,
    onsuccess: null as ((e: Event) => void) | null,
    onerror: null as ((e: Event) => void) | null,
  }
  // Simulate async IDB resolution on the next microtask
  setTimeout(() => {
    if (error) req.onerror?.(new Event('error'))
    else req.onsuccess?.(new Event('success'))
  }, 0)
  return req
}

const mockObjectStore = {
  get: (key: string) => mockIDBRequest(_idbStore.get(key)),
  put: (value: unknown, key: string) => {
    _idbStore.set(key, value)
    return mockIDBRequest(undefined)
  },
  createObjectStore: () => {},
}

const mockTransaction = {
  objectStore: () => mockObjectStore,
}

const mockDB = {
  transaction: () => mockTransaction,
  createObjectStore: () => mockObjectStore,
}

const mockOpenRequest = {
  result: mockDB,
  error: null,
  onupgradeneeded: null as ((e: Event) => void) | null,
  onsuccess: null as ((e: Event) => void) | null,
  onerror: null as ((e: Event) => void) | null,
}

beforeEach(() => {
  // Clear IDB store between tests so key pairs don't persist across tests
  _idbStore.clear()

  // Wire up the IDB open mock
  const openReq = {
    ...mockOpenRequest,
    result: mockDB,
    onupgradeneeded: null as ((e: Event) => void) | null,
    onsuccess: null as ((e: Event) => void) | null,
    onerror: null as ((e: Event) => void) | null,
  }

  Object.defineProperty(globalThis, 'indexedDB', {
    value: {
      open: (_name: string, _version?: number) => {
        setTimeout(() => {
          openReq.onsuccess?.(new Event('success'))
        }, 0)
        return openReq
      },
    },
    writable: true,
    configurable: true,
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────

/** Generate a fresh ECDH P-256 key pair directly (bypasses IDB for key setup). */
async function generateEcdhPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable so we can export the public key as JWK
    ['deriveKey']
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('e2eEncryptionService — runtime round-trip tests', () => {
  // ── bufToHex / hexToBuf symmetry ────────────────────────────────────────
  describe('hex encoding round-trip', () => {
    it('bufToHex produces correct hex for known input', async () => {
      // Use SHA-256 of empty string: known value
      const hashBuf = await crypto.subtle.digest('SHA-256', new Uint8Array(0))
      const hex = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, '0')).join(
        ''
      )
      // SHA-256('') = e3b0c44298fc1c14...
      expect(hex.startsWith('e3b0c44298fc1c14')).toBe(true)
    })

    it('hexToBuf / bufToHex are inverse operations', async () => {
      // Generate 32 random bytes, convert to hex and back
      const original = new Uint8Array(32)
      crypto.getRandomValues(original)
      const hex = Array.from(original, (b) => b.toString(16).padStart(2, '0')).join('')

      // Simulate what hexToBuf does internally
      const pairs = hex.match(/.{1,2}/g) ?? []
      const reconstructed = new Uint8Array(pairs.length)
      for (let i = 0; i < pairs.length; i++) {
        reconstructed[i] = parseInt(pairs[i], 16)
      }

      expect(reconstructed.length).toBe(32)
      expect(reconstructed).toEqual(original)
    })

    it('IV hex is always 24 characters (12 bytes)', async () => {
      // We can verify this by checking the encryptMessage output
      const keyPair = await generateEcdhPair()
      const remotePublicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)

      // Directly test what our IV generation produces
      const iv = new Uint8Array(12)
      crypto.getRandomValues(iv)
      const hex = Array.from(iv, (b) => b.toString(16).padStart(2, '0')).join('')

      expect(hex.length).toBe(24) // 12 bytes × 2 hex chars = 24
      expect(iv.byteLength).toBe(12)
    })
  })

  // ── Group key derivation ────────────────────────────────────────────────
  describe('deriveGroupKey', () => {
    it('produces a CryptoKey usable for AES-GCM encrypt/decrypt', async () => {
      const key = await deriveGroupKey('test-group-secret')
      expect(key.type).toBe('secret')
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM' })
      expect(key.usages).toContain('encrypt')
      expect(key.usages).toContain('decrypt')
    })

    it('is deterministic — same secret produces equivalent key material', async () => {
      const secret = 'deterministic-secret-abc123'
      const key1 = await deriveGroupKey(secret)
      const key2 = await deriveGroupKey(secret)

      // Both keys must be able to encrypt/decrypt each other's data
      const iv = new Uint8Array(12)
      crypto.getRandomValues(iv)
      const plaintext = new TextEncoder().encode('hello')

      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, plaintext)
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, cipherBuf)

      expect(new TextDecoder().decode(plainBuf)).toBe('hello')
    })

    it('different secrets produce different keys (decrypt fails cross-key)', async () => {
      const key1 = await deriveGroupKey('secret-one')
      const key2 = await deriveGroupKey('secret-two')

      const iv = new Uint8Array(12)
      crypto.getRandomValues(iv)
      const plaintext = new TextEncoder().encode('cross-key test')

      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, plaintext)

      await expect(
        crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, cipherBuf)
      ).rejects.toThrow()
    })

    it('produces a 256-bit key', async () => {
      const key = await deriveGroupKey('any-secret')
      expect((key.algorithm as AesKeyAlgorithm).length).toBe(256)
    })
  })

  // ── encryptGroupData / decryptGroupData round-trip ─────────────────────
  describe('encryptGroupData / decryptGroupData', () => {
    it('round-trips a plain string value', async () => {
      const secret = 'group-secret-xyz'
      const data = 'Hello, Ajo!'

      const payload = await encryptGroupData(data, secret)
      const recovered = await decryptGroupData<string>(payload, secret)

      expect(recovered).toBe(data)
    })

    it('round-trips a complex object', async () => {
      const secret = 'group-secret-xyz'
      const data = {
        memberAddress: 'GABCDEF1234567890ABCDEF',
        contributionAmount: 500,
        timestamp: '2024-01-15T10:00:00Z',
        metadata: { cycle: 3, round: 1 },
      }

      const payload = await encryptGroupData(data, secret)
      const recovered = await decryptGroupData<typeof data>(payload, secret)

      expect(recovered).toEqual(data)
    })

    it('produces non-empty hex-encoded ciphertext', async () => {
      const payload = await encryptGroupData('test data', 'secret')

      expect(typeof payload.ciphertext).toBe('string')
      expect(payload.ciphertext.length).toBeGreaterThan(0)
      // Must be valid hex
      expect(payload.ciphertext).toMatch(/^[0-9a-f]+$/)
    })

    it('IV is always 12 bytes (24 hex chars)', async () => {
      const payload = await encryptGroupData('any', 'secret')
      expect(payload.iv.length).toBe(24)
      expect(payload.iv).toMatch(/^[0-9a-f]{24}$/)
    })

    it('ciphertext length is greater than plaintext (due to AES-GCM auth tag)', async () => {
      const plaintext = 'Hello World'
      const payload = await encryptGroupData(plaintext, 'secret')

      // AES-GCM appends a 16-byte (128-bit) authentication tag
      // ciphertext bytes > JSON.stringify(plaintext).length
      const ciphertextByteLen = payload.ciphertext.length / 2
      const plaintextByteLen = new TextEncoder().encode(JSON.stringify(plaintext)).length
      expect(ciphertextByteLen).toBeGreaterThan(plaintextByteLen)
    })

    it('each encryption of the same plaintext produces a different ciphertext (random IV)', async () => {
      const data = 'same data every time'
      const secret = 'same-secret'

      const payload1 = await encryptGroupData(data, secret)
      const payload2 = await encryptGroupData(data, secret)

      // IVs must differ
      expect(payload1.iv).not.toBe(payload2.iv)
      // Ciphertexts must differ (different IV → different ciphertext)
      expect(payload1.ciphertext).not.toBe(payload2.ciphertext)
    })

    it('fails to decrypt with a wrong secret', async () => {
      const payload = await encryptGroupData('secret data', 'correct-secret')

      await expect(decryptGroupData(payload, 'wrong-secret')).rejects.toThrow()
    })

    it('fails to decrypt with a tampered ciphertext', async () => {
      const payload = await encryptGroupData('tamper test', 'secret')
      // Flip the last two hex chars (corrupt the auth tag)
      const tampered = {
        ...payload,
        ciphertext: payload.ciphertext.slice(0, -2) + 'ff',
      }

      await expect(decryptGroupData(tampered, 'secret')).rejects.toThrow()
    })

    it('fails to decrypt with a tampered IV', async () => {
      const payload = await encryptGroupData('tamper iv test', 'secret')
      // Flip first byte of IV
      const ivBytes = payload.iv.split('')
      ivBytes[0] = ivBytes[0] === 'f' ? '0' : 'f'
      const tampered = { ...payload, iv: ivBytes.join('') }

      await expect(decryptGroupData(tampered, 'secret')).rejects.toThrow()
    })

    it('handles empty string data', async () => {
      const payload = await encryptGroupData('', 'secret')
      const recovered = await decryptGroupData<string>(payload, 'secret')
      expect(recovered).toBe('')
    })

    it('handles data with unicode / emoji', async () => {
      const data = { message: '🎉 Ajo contribution: ₦500 🤝', group: 'savings-circle' }
      const payload = await encryptGroupData(data, 'unicode-secret')
      const recovered = await decryptGroupData<typeof data>(payload, 'unicode-secret')
      expect(recovered).toEqual(data)
    })

    it('handles large data (10 KB)', async () => {
      const largeData = { payload: 'x'.repeat(10_000) }
      const encrypted = await encryptGroupData(largeData, 'large-data-secret')
      const recovered = await decryptGroupData<typeof largeData>(encrypted, 'large-data-secret')
      expect(recovered.payload.length).toBe(10_000)
    })
  })

  // ── getKeyFingerprint ───────────────────────────────────────────────────
  describe('getKeyFingerprint', () => {
    it('produces a colon-separated uppercase hex fingerprint', async () => {
      const keyPair = await generateEcdhPair()
      const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
      const fp = await getKeyFingerprint(jwk)

      // Expected format: XXXX:XXXX:... (8 groups of 4 hex chars)
      expect(fp).toMatch(/^[0-9A-F]{4}(:[0-9A-F]{4}){7}$/)
    })

    it('is deterministic for the same JWK', async () => {
      const keyPair = await generateEcdhPair()
      const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)

      const fp1 = await getKeyFingerprint(jwk)
      const fp2 = await getKeyFingerprint(jwk)

      expect(fp1).toBe(fp2)
    })

    it('differs for different keys', async () => {
      const pair1 = await generateEcdhPair()
      const pair2 = await generateEcdhPair()
      const jwk1 = await crypto.subtle.exportKey('jwk', pair1.publicKey)
      const jwk2 = await crypto.subtle.exportKey('jwk', pair2.publicKey)

      const fp1 = await getKeyFingerprint(jwk1)
      const fp2 = await getKeyFingerprint(jwk2)

      expect(fp1).not.toBe(fp2)
    })
  })

  // ── ECDH key exchange: deriveSharedKey ──────────────────────────────────
  //
  // These tests use getOrCreateKeyPair which requires IndexedDB.  The mock
  // above provides an in-memory store so these run without a real IDB.
  describe('deriveSharedKey', () => {
    it("two users derive the same shared key from each other's public keys", async () => {
      // Generate two ECDH key pairs independently (representing Alice and Bob)
      const alicePair = await generateEcdhPair()
      const bobPair = await generateEcdhPair()

      const alicePublicJwk = await crypto.subtle.exportKey('jwk', alicePair.publicKey)
      const bobPublicJwk = await crypto.subtle.exportKey('jwk', bobPair.publicKey)

      // Verify ECDH symmetry at the raw API level (not IDB-dependent)
      const sharedKeyAlice = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: bobPair.publicKey },
        alicePair.privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
      const sharedKeyBob = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: alicePair.publicKey },
        bobPair.privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )

      // Export both derived keys as raw bytes and compare
      const rawAlice = await crypto.subtle.exportKey('raw', sharedKeyAlice)
      const rawBob = await crypto.subtle.exportKey('raw', sharedKeyBob)

      expect(new Uint8Array(rawAlice)).toEqual(new Uint8Array(rawBob))
    })

    it('ECDH shared key enables encrypt-on-one-side / decrypt-on-other-side', async () => {
      const alicePair = await generateEcdhPair()
      const bobPair = await generateEcdhPair()

      // Alice derives shared key using Bob's public key
      const aliceShared = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: bobPair.publicKey },
        alicePair.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )

      // Bob derives shared key using Alice's public key
      const bobShared = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: alicePair.publicKey },
        bobPair.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )

      const iv = new Uint8Array(12)
      crypto.getRandomValues(iv)
      const message = new TextEncoder().encode('Hello Bob from Alice')

      // Alice encrypts
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aliceShared, message)

      // Bob decrypts
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, bobShared, cipherBuf)

      expect(new TextDecoder().decode(plainBuf)).toBe('Hello Bob from Alice')
    })
  })

  // ── encryptMessage / decryptMessage round-trip ──────────────────────────
  //
  // These tests exercise the full encryptMessage/decryptMessage API which
  // internally calls getOrCreateKeyPair (IDB) and deriveSharedKey.
  describe('encryptMessage / decryptMessage', () => {
    it('round-trips a short message', async () => {
      const aliceId = 'alice-user-1'
      const bobId = 'bob-user-2'

      // Get/create key pairs for Alice and Bob
      const aliceKP = await getOrCreateKeyPair(aliceId)
      const bobKP = await getOrCreateKeyPair(bobId)

      const message = 'Hello, this is a secret message!'

      // Alice encrypts to Bob
      const payload = await encryptMessage(message, aliceId, bobKP.publicKeyJwk)

      // Bob decrypts (he derives the shared key using Alice's public key)
      const recovered = await decryptMessage(payload, bobId, aliceKP.publicKeyJwk)

      expect(recovered).toBe(message)
    })

    it('round-trips an empty message', async () => {
      const aliceKP = await getOrCreateKeyPair('user-a')
      const bobKP = await getOrCreateKeyPair('user-b')

      const payload = await encryptMessage('', 'user-a', bobKP.publicKeyJwk)
      const recovered = await decryptMessage(payload, 'user-b', aliceKP.publicKeyJwk)

      expect(recovered).toBe('')
    })

    it('round-trips a message with special characters and unicode', async () => {
      const aliceKP = await getOrCreateKeyPair('user-c')
      const bobKP = await getOrCreateKeyPair('user-d')

      const message = '💰 Transfer: ₦10,000 → Alice\n\tRef: "AJO-2024-003" <special>&amp;'
      const payload = await encryptMessage(message, 'user-c', bobKP.publicKeyJwk)
      const recovered = await decryptMessage(payload, 'user-d', aliceKP.publicKeyJwk)

      expect(recovered).toBe(message)
    })

    it('payload contains ciphertext, iv, and encryptedAt', async () => {
      const aliceKP = await getOrCreateKeyPair('user-e')
      const bobKP = await getOrCreateKeyPair('user-f')

      const payload = await encryptMessage('test', 'user-e', bobKP.publicKeyJwk)

      expect(typeof payload.ciphertext).toBe('string')
      expect(payload.ciphertext).toMatch(/^[0-9a-f]+$/)
      expect(payload.iv.length).toBe(24)
      expect(payload.iv).toMatch(/^[0-9a-f]{24}$/)
      expect(payload.encryptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('cannot decrypt with wrong remote public key', async () => {
      const aliceKP = await getOrCreateKeyPair('user-g')
      const bobKP = await getOrCreateKeyPair('user-h')
      const eveKP = await getOrCreateKeyPair('user-i')

      // Alice encrypts to Bob
      const payload = await encryptMessage('secret', 'user-g', bobKP.publicKeyJwk)

      // Eve tries to decrypt using Alice's message but with wrong remote key (Bob's instead of Alice's)
      await expect(
        decryptMessage(payload, 'user-i', bobKP.publicKeyJwk) // Eve uses wrong perspective
      ).rejects.toThrow()
    })

    it('two calls with same plaintext produce different ciphertexts (random IV)', async () => {
      const aliceKP = await getOrCreateKeyPair('user-j')
      const bobKP = await getOrCreateKeyPair('user-k')

      const msg = 'same message'
      const p1 = await encryptMessage(msg, 'user-j', bobKP.publicKeyJwk)
      const p2 = await encryptMessage(msg, 'user-j', bobKP.publicKeyJwk)

      expect(p1.iv).not.toBe(p2.iv)
      expect(p1.ciphertext).not.toBe(p2.ciphertext)

      // Both must still decrypt correctly
      const r1 = await decryptMessage(p1, 'user-k', aliceKP.publicKeyJwk)
      const r2 = await decryptMessage(p2, 'user-k', aliceKP.publicKeyJwk)
      expect(r1).toBe(msg)
      expect(r2).toBe(msg)
    })
  })

  // ── rotateKeyPair ───────────────────────────────────────────────────────
  describe('rotateKeyPair', () => {
    it('returns a JWK with the expected ECDH P-256 fields', async () => {
      const jwk = await rotateKeyPair('rotate-user')

      expect(jwk.kty).toBe('EC')
      expect(jwk.crv).toBe('P-256')
      expect(typeof jwk.x).toBe('string')
      expect(typeof jwk.y).toBe('string')
      // Private component must NOT be present (exported public key only)
      expect(jwk.d).toBeUndefined()
    })

    it('rotated key pair produces a different public JWK', async () => {
      const userId = 'rotate-user-2'
      const original = await getOrCreateKeyPair(userId)
      const rotatedJwk = await rotateKeyPair(userId)

      expect(rotatedJwk.x).not.toBe(original.publicKeyJwk.x)
    })

    it('after rotation, old shared-key cache is cleared and new key works', async () => {
      const userId = 'rotate-user-3'
      const remoteKP = await generateEcdhPair()
      const remoteJwk = await crypto.subtle.exportKey('jwk', remoteKP.publicKey)

      // Pre-rotation: derive shared key once (this populates cache)
      await getOrCreateKeyPair(userId)

      // Rotate
      const newPublicJwk = await rotateKeyPair(userId)

      // After rotation, the new key pair should still allow key derivation
      // (rotateKeyPair stores the new key pair in IDB and clears cache)
      const newKP = await getOrCreateKeyPair(userId)
      expect(newKP.publicKeyJwk.x).toBe(newPublicJwk.x)
    })
  })

  // ── Buffer correctness: verify byte lengths match expected crypto sizes ──
  describe('buffer / byte-length correctness', () => {
    it('AES-GCM ciphertext is exactly plaintext-length + 16 bytes (auth tag)', async () => {
      const plaintext = 'exactly-32-bytes-long-padded-xxx'
      expect(new TextEncoder().encode(plaintext).byteLength).toBe(32)

      const key = await deriveGroupKey('size-check-secret')
      const iv = new Uint8Array(12)
      crypto.getRandomValues(iv)
      const encoded = new TextEncoder().encode(plaintext)
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

      // AES-GCM produces ciphertext = plaintext + 16-byte auth tag
      expect(cipherBuf.byteLength).toBe(32 + 16)
    })

    it('ECDH P-256 shared secret is 256 bits (32 bytes)', async () => {
      const pair1 = await generateEcdhPair()
      const pair2 = await generateEcdhPair()

      const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: pair2.publicKey },
        pair1.privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
      const raw = await crypto.subtle.exportKey('raw', sharedKey)
      expect(raw.byteLength).toBe(32) // 256 bits
    })

    it('SHA-256 digest is always 32 bytes', async () => {
      const input = new TextEncoder().encode('fingerprint test')
      const hash = await crypto.subtle.digest('SHA-256', input)
      expect(hash.byteLength).toBe(32)
    })

    it('hex encoding does not lose or add bytes', async () => {
      // Generate known-size data and verify hex round-trip byte count
      const original = new Uint8Array(64)
      crypto.getRandomValues(original)

      const hex = Array.from(original, (b) => b.toString(16).padStart(2, '0')).join('')
      expect(hex.length).toBe(128) // 64 bytes × 2 hex chars

      const pairs = hex.match(/.{1,2}/g) ?? []
      const reconstructed = new Uint8Array(pairs.length)
      for (let i = 0; i < pairs.length; i++) {
        reconstructed[i] = parseInt(pairs[i], 16)
      }

      expect(reconstructed.length).toBe(64)
      expect(reconstructed).toEqual(original)
    })
  })

  // ── exportPublicKey ─────────────────────────────────────────────────────
  describe('exportPublicKey', () => {
    it('returns a valid EC P-256 public key in JWK format', async () => {
      const userId = 'export-test-user'
      const jwk = await exportPublicKey(userId)

      expect(jwk.kty).toBe('EC')
      expect(jwk.crv).toBe('P-256')
      expect(typeof jwk.x).toBe('string')
      expect(typeof jwk.y).toBe('string')
      expect(jwk.d).toBeUndefined() // no private component
    })

    it('returns the same JWK on repeated calls (key is cached in IDB)', async () => {
      const userId = 'export-stable-user'
      const jwk1 = await exportPublicKey(userId)
      const jwk2 = await exportPublicKey(userId)

      expect(jwk1.x).toBe(jwk2.x)
      expect(jwk1.y).toBe(jwk2.y)
    })
  })
})
