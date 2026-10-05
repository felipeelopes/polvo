// Tauri wraps Minisign public keys and signatures in base64.
// Format: https://jedisct1.github.io/minisign/#signature-format
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

const [configPath, ...artifacts] = process.argv.slice(2);

try {
  if (!configPath || artifacts.length === 0) {
    throw new Error("Uso: node scripts/verify-updater-signature.mjs <tauri.conf.json> <arquivo> [...]");
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const keyLines = Buffer.from(config.plugins.updater.pubkey, "base64").toString("utf8").trim().split(/\r?\n/);
  const publicKey = Buffer.from(keyLines[1] ?? "", "base64");
  if (publicKey.length !== 42 || publicKey.subarray(0, 2).toString() !== "Ed") {
    throw new Error("Chave publica Minisign invalida na configuracao do atualizador.");
  }
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey.subarray(10)]),
    format: "der",
    type: "spki",
  });

  for (const artifact of artifacts) {
    const lines = Buffer.from(readFileSync(`${artifact}.sig`, "utf8").trim(), "base64")
      .toString("utf8").trim().split(/\r?\n/);
    const signature = Buffer.from(lines[1] ?? "", "base64");
    const globalSignature = Buffer.from(lines[3] ?? "", "base64");
    if (lines.length !== 4 || signature.length !== 74 || globalSignature.length !== 64
        || !lines[0].startsWith("untrusted comment: ") || !lines[2].startsWith("trusted comment: ")) {
      throw new Error(`Assinatura Minisign invalida: ${artifact}`);
    }
    if (!signature.subarray(2, 10).equals(publicKey.subarray(2, 10))) {
      throw new Error(`A assinatura usa outra chave, incompatível com o atualizador: ${artifact}`);
    }
    const algorithm = signature.subarray(0, 2).toString();
    const data = readFileSync(artifact);
    // Tauri also uses the original Ed format; accept both formats like its updater.
    const message = algorithm === "ED" ? createHash("blake2b512").update(data).digest() : data;
    if ((algorithm !== "Ed" && algorithm !== "ED") || !verify(null, message, key, signature.subarray(10))) {
      throw new Error(`O arquivo nao corresponde a assinatura: ${artifact}`);
    }
    const comment = lines[2].slice("trusted comment: ".length);
    const globalMessage = Buffer.concat([signature.subarray(10), Buffer.from(comment, "utf8")]);
    if (!verify(null, globalMessage, key, globalSignature)) {
      throw new Error(`O comentario assinado foi alterado: ${artifact}`);
    }
    // New Tauri versions bind the app version to the trusted comment.
    const signedVersion = /(?:^|\s)version:([^\s]+)/.exec(comment)?.[1];
    if (signedVersion && signedVersion !== config.version) {
      throw new Error(`Versao assinada ${signedVersion} diferente de ${config.version}: ${artifact}`);
    }
    console.log(`Assinatura do atualizador verificada: ${artifact}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
