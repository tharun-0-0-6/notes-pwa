const PBKDF2_ITERATIONS = 210_000
const SALT_LENGTH = 16

export type NoteLockCredential = {
  salt: string
  hash: string
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string) {
  return new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
}

async function derivePasswordHash(password: string, salt: Uint8Array) {
  const saltBuffer = new ArrayBuffer(salt.byteLength)
  new Uint8Array(saltBuffer).set(salt)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256,
  )
  return new Uint8Array(derivedBits)
}

export async function createNoteLockCredential(password: string): Promise<NoteLockCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const hash = await derivePasswordHash(password, salt)
  return {
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
  }
}

export async function verifyNoteLockPassword(
  password: string,
  credential: NoteLockCredential,
) {
  const salt = hexToBytes(credential.salt)
  const expectedHash = hexToBytes(credential.hash)
  const actualHash = await derivePasswordHash(password, salt)

  if (actualHash.length !== expectedHash.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index]
  }
  return difference === 0
}
