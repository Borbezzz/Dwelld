import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify, type KeyObject } from "node:crypto";

/**
 * Tamper-evident evidence ledger: the idea behind a blockchain, kept on our own server.
 *
 * Each sealed inspection records the SHA-256 of every evidence file. Its seal hashes those
 * fingerprints together with the server time and the previous seal, so every entry is chained
 * to the one before it. Editing a photo, backdating an inspection or deleting an entry breaks
 * every seal after it. Each seal is also signed with an Ed25519 key, and the public key is
 * published so anyone can check a seal without trusting the app.
 */
export const GENESIS = "0".repeat(64);
export type SealedFile = { ref: string; name: string; kind: string; sha256: string; bytes: number };
export type SealInput = { seq: number; inspectionId: string; roomId: string; sealedAt: string; files: SealedFile[]; prevSeal: string };
export type LedgerEntry = SealInput & { filesRoot: string; seal: string; signature: string; keyId: string };

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** One fingerprint for all files: order-independent, so it only changes when a file does. */
export function filesRoot(files: SealedFile[]) {
  return sha256(files.map(f => `${f.sha256} ${f.bytes} ${f.ref}`).sort().join("\n"));
}
/** The exact text that is hashed into a seal. Documented so anyone can recompute it. */
export function sealText(e: Omit<SealInput, "files"> & { filesRoot: string }) {
  return ["dwelld-seal-v1", e.seq, e.inspectionId, e.roomId, e.sealedAt, e.filesRoot, e.prevSeal].join("\n");
}
export function computeSeal(e: SealInput) {
  const root = filesRoot(e.files);
  return { filesRoot: root, seal: sha256(sealText({ ...e, filesRoot: root })) };
}

/** Ed25519 key derived from a server secret, so no extra key needs storing. */
export function ledgerKeys(secret: string): { privateKey: KeyObject; publicKey: KeyObject; publicKeyBase64: string; keyId: string } {
  if (!secret || secret.length < 32) throw new Error("A ledger secret of at least 32 characters is required");
  const seed = Buffer.from(hkdfSync("sha256", secret, "dwelld", "evidence-ledger-v1", 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey, publicKey, publicKeyBase64: raw.toString("base64"), keyId: sha256(raw).slice(0, 16) };
}
export const signSeal = (seal: string, key: KeyObject) => sign(null, Buffer.from(seal, "hex"), key).toString("base64");
export function verifySignature(seal: string, signature: string, publicKeyBase64: string) {
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyBase64, "base64")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(seal, "hex"), key, Buffer.from(signature, "base64"));
  } catch { return false; }
}

export function buildEntry(input: SealInput, keys: ReturnType<typeof ledgerKeys>): LedgerEntry {
  const { filesRoot: root, seal } = computeSeal(input);
  return { ...input, filesRoot: root, seal, signature: signSeal(seal, keys.privateKey), keyId: keys.keyId };
}

/** Problems with one entry on its own: changed fingerprints, a recomputed seal that differs, a bad signature. */
export function entryProblems(e: LedgerEntry, publicKeyBase64: string) {
  const problems: string[] = [];
  const { filesRoot: root, seal } = computeSeal(e);
  if (root !== e.filesRoot) problems.push("The file fingerprints no longer match the sealed list.");
  if (seal !== e.seal) problems.push("The seal does not match its contents.");
  if (!verifySignature(e.seal, e.signature, publicKeyBase64)) problems.push("The signature does not match the published key.");
  return problems;
}

/** Walk the chain in order: every entry must point at the seal of the entry before it, with no gaps. */
export function chainProblems(entries: Pick<LedgerEntry, "seq" | "seal" | "prevSeal" | "inspectionId" | "roomId" | "sealedAt" | "filesRoot">[]) {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq), problems: { seq: number; problem: string }[] = [];
  sorted.forEach((e, i) => {
    const expectedPrev = i === 0 ? (e.seq === 1 ? GENESIS : null) : sorted[i - 1].seal;
    if (i > 0 && e.seq !== sorted[i - 1].seq + 1) problems.push({ seq: e.seq, problem: `Entry ${sorted[i - 1].seq + 1} is missing.` });
    if (expectedPrev !== null && e.prevSeal !== expectedPrev) problems.push({ seq: e.seq, problem: "Does not link to the previous seal." });
    if (sha256(sealText(e)) !== e.seal) problems.push({ seq: e.seq, problem: "Seal does not match its contents." });
  });
  return problems;
}
