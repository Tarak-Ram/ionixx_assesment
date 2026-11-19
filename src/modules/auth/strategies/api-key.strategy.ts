import { createHash } from 'crypto';
import { AuthRequest, AuthStrategy, Principal } from '../auth-strategy.interface';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * AUTH_MODE=api-key: partner sends `X-API-Key: <key>`.
 * Keys are stored only as SHA-256 digests and looked up by digest, so comparing never
 * touches the raw secret and does not leak key prefixes through timing.
 */
export class ApiKeyStrategy implements AuthStrategy {
  readonly name = 'api-key';
  private readonly partnersByDigest = new Map<string, string>();

  constructor(keysToPartner: Record<string, string>) {
    for (const [key, partnerId] of Object.entries(keysToPartner)) {
      this.partnersByDigest.set(sha256(key), partnerId);
    }
  }

  authenticate(request: AuthRequest): Principal | null {
    const header = request.headers['x-api-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key) return null;
    const partnerId = this.partnersByDigest.get(sha256(key));
    return partnerId ? { partnerId } : null;
  }
}
