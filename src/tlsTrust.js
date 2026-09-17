import tls from 'tls';

/**
 * Node uses Mozilla's bundled CAs, not the Windows store. On this machine Avast
 * HTTPS/Mail Shield intercepts TLS and presents "Avast Web/Mail Shield Root",
 * which Windows trusts but Node does not — hence UNABLE_TO_VERIFY_LEAF_SIGNATURE
 * unless verification is disabled. Merge the OS store so verification can stay on.
 */
export function applySystemCertificateTrust() {
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return { applied: false, reason: 'tls CA APIs unavailable (need Node 22+)' };
  }
  try {
    const bundled = tls.getCACertificates('bundled');
    const system = tls.getCACertificates('system');
    const extra = tls.getCACertificates('extra');
    tls.setDefaultCACertificates([...bundled, ...system, ...extra]);
    return {
      applied: true,
      bundled: bundled.length,
      system: system.length,
      extra: extra.length
    };
  } catch (e) {
    return { applied: false, reason: e.message };
  }
}

const tlsTrust = applySystemCertificateTrust();
if (process.env.NODE_ENV !== 'production') {
  console.log('[tlsTrust]', tlsTrust);
}
