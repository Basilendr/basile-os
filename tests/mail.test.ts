import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/lib/db";
import { setup } from "./helpers";
import { MAIL_PRESETS, MailAccountInput, connectMail, getMailAccount, publicMailAccount, syncMail } from "@/services/mail/mail";

let db: DB;
let userId: string;
beforeAll(async () => {
  ({ db, userId } = await setup());
});

describe("messagerie IMAP / SMTP", () => {
  it("propose des serveurs complets pour chaque fournisseur courant", () => {
    for (const [k, p] of Object.entries(MAIL_PRESETS)) {
      if (k === "other") continue;
      expect(p.imap[0]).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
      expect(p.smtp[0]).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
    }
  });

  it("refuse des réglages invalides et n'enregistre rien si le serveur est injoignable", async () => {
    expect(MailAccountInput.safeParse({ email: "x", username: "u", password: "p", imapHost: "a b", imapPort: 993, imapSecure: true, smtpHost: "s", smtpPort: 465, smtpSecure: true }).success).toBe(false);
    await expect(
      connectMail(db, userId, { email: "test@example.org", username: "test@example.org", password: "secret", imapHost: "imap.basile-os.invalid", imapPort: 993, imapSecure: true, smtpHost: "smtp.basile-os.invalid", smtpPort: 465, smtpSecure: true }),
    ).rejects.toThrow(/IMAP/);
    expect(await getMailAccount(db, userId)).toBeNull();
    expect(publicMailAccount(null)).toEqual({ status: "disconnected" });
    await expect(syncMail(db, userId)).rejects.toThrow(/Aucune adresse/);
  }, 30_000);
});
