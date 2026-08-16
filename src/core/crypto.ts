// Шифрование секретов, которые владелец вводит через сайт.
//
// AES-256-GCM: помимо шифрования даёт проверку целостности — подменённое
// значение не расшифруется молча, а бросит ошибку.
//
// Ключ берётся из INTEGRATION_ENCRYPTION_KEY и остаётся единственным
// секретом в панели хостинга. Потерять его = потерять все сохранённые
// токены (их придётся ввести заново), поэтому менять переменную нельзя,
// пока в базе есть зашифрованные значения.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const IV_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim()
  if (!raw) throw new Error('INTEGRATION_ENCRYPTION_KEY не задана — секреты негде шифровать')
  // Принимаем строку любой длины: 32 байта получаем через sha256, чтобы
  // владельцу не приходилось подбирать длину ключа вручную.
  return createHash('sha256').update(raw).digest()
}

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.INTEGRATION_ENCRYPTION_KEY?.trim())
}

/** Возвращает base64(iv || tag || ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

export function decryptSecret(packed: string): string {
  const raw = Buffer.from(packed, 'base64')
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error('повреждённое зашифрованное значение')
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, IV_BYTES))
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
}

/** Хвост значения для UI: владелец узнаёт свой ключ, не расшифровывая его. */
export function secretHint(plain: string): string {
  return plain.length <= 4 ? '••••' : `••••${plain.slice(-4)}`
}
