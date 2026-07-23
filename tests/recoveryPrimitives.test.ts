import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  parseRecovery,
  serializeRecovery,
  type RecoveryPayload,
} from '../src/main/recovery/recoveryPrimitives';

function payload(): RecoveryPayload {
  return {
    documentId: randomUUID(),
    sourcePath: 'C:\\notes\\測試.md',
    sourceHash: 'a'.repeat(64),
    format: {
      encoding: 'utf8',
      bom: true,
      eol: '\r\n',
      mixedEol: false,
    },
    content: '# Recovery\r\n\r\n狀態：未儲存 🧪\r\n第二行 e\u0301',
    revision: 7,
    updatedAt: '2026-07-14T12:00:00.000Z',
  };
}

describe('recovery snapshot integrity', () => {
  it('round-trips Unicode content with an integrity checksum', () => {
    const original = payload();
    expect(parseRecovery(serializeRecovery(original))).toEqual(original);
  });

  it('rejects a truncated snapshot', () => {
    const bytes = serializeRecovery(payload());
    expect(() => parseRecovery(bytes.subarray(0, bytes.length - 12))).toThrow();
  });

  it('rejects content tampering even when JSON remains valid', () => {
    const bytes = serializeRecovery(payload());
    const changed = Buffer.from(
      bytes.toString('utf8').replace('未儲存', '已竄改'),
      'utf8',
    );
    expect(() => parseRecovery(changed)).toThrow('checksum');
  });

  it('opens a Phase 0 journal that predates revision tracking', () => {
    const current = payload();
    const { revision: _revision, ...legacyPayload } = current;
    const canonical = JSON.stringify(legacyPayload);
    const bytes = Buffer.from(JSON.stringify({
      format: 'markdown-recovery-v1',
      checksum: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      payload: legacyPayload,
    }), 'utf8');

    expect(parseRecovery(bytes)).toEqual({ ...legacyPayload, revision: 0 });
  });
});
