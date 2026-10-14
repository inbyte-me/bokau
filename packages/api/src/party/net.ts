import os from 'node:os';

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** This machine's IPv4 addresses on local networks, the Wi-Fi/Ethernet ones first. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out.sort((a, b) => Number(PRIVATE.test(b)) - Number(PRIVATE.test(a)));
}
