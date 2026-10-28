import { OfficeCapabilitiesResponseSchema } from '@calaba/protocol';
import { call } from '../../../lib/api/client';
import { setOfficeCaps } from './caps';

let inflight: Promise<void> | null = null;

/** GET /api/office/capabilities (ADR-0143) at every READY: the server may have turned the editor on or off. A failure keeps what was known. */
export function loadOfficeCaps(): Promise<void> {
  inflight ??= call('GET', '/api/office/capabilities', OfficeCapabilitiesResponseSchema)
    .then(setOfficeCaps)
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
