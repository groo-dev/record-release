import * as crypto from 'crypto';

interface EncryptedData {
  iv: string; // base64
  encryptedKey: string; // base64 (AES key encrypted with RSA)
  encryptedValue: string; // base64 (value encrypted with AES-GCM)
}

/**
 * Decrypt a secret value using hybrid decryption (RSA + AES-GCM)
 * This is the Node.js equivalent of the browser decryption
 */
export function decryptSecret(
  encryptedJson: string,
  privateKeyBase64: string
): string {
  const { iv, encryptedKey, encryptedValue } = JSON.parse(
    encryptedJson
  ) as EncryptedData;

  // Convert private key from base64 to PEM format
  const privateKeyDer = Buffer.from(privateKeyBase64, 'base64');
  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  // Decrypt AES key with RSA-OAEP
  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedKey, 'base64')
  );

  // Decrypt value with AES-GCM
  const ivBuffer = Buffer.from(iv, 'base64');
  const encryptedBuffer = Buffer.from(encryptedValue, 'base64');

  // AES-GCM: last 16 bytes are the auth tag
  const authTag = encryptedBuffer.subarray(-16);
  const ciphertext = encryptedBuffer.subarray(0, -16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, ivBuffer);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
