import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  documentFormatSchema,
  MAX_DOCUMENT_CHARACTERS,
} from '../../shared/contracts';

export const recoveryPayloadSchema = z.object({
  documentId: z.string().uuid(),
  sourcePath: z.string().max(32_768).nullable(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  format: documentFormatSchema,
  content: z.string().max(MAX_DOCUMENT_CHARACTERS),
  revision: z.number().int().nonnegative().default(0),
  updatedAt: z.string().datetime(),
});
export type RecoveryPayload = z.infer<typeof recoveryPayloadSchema>;

const recoveryEnvelopeSchema = z.object({
  format: z.literal('markdown-recovery-v1'),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.unknown(),
});

function checksum(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function serializeRecovery(payloadInput: RecoveryPayload): Buffer {
  const payload = recoveryPayloadSchema.parse(payloadInput);
  const canonicalPayload = JSON.stringify(payload);
  return Buffer.from(
    JSON.stringify({
      format: 'markdown-recovery-v1',
      checksum: checksum(canonicalPayload),
      payload,
    }),
    'utf8',
  );
}

export function parseRecovery(bytes: Uint8Array): RecoveryPayload {
  const envelope = recoveryEnvelopeSchema.parse(
    JSON.parse(Buffer.from(bytes).toString('utf8')),
  );
  const actualChecksum = checksum(JSON.stringify(envelope.payload));
  if (actualChecksum !== envelope.checksum) {
    throw new Error('Recovery snapshot checksum does not match.');
  }
  return recoveryPayloadSchema.parse(envelope.payload);
}
