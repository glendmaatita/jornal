import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pocketBaseBin = process.env.POCKETBASE_BIN;
const integrationTest = pocketBaseBin ? test : test.skip;
let server: ReturnType<typeof Bun.spawn> | null = null;
let dataDirectory = "";

afterAll(async () => {
  server?.kill();
  if (server) await server.exited.catch(() => undefined);
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

integrationTest(
  "invoice commands are scoped, idempotent, and create cash exactly once",
  async () => {
    dataDirectory = await mkdtemp(
      join(tmpdir(), "jornal-invoice-integration-"),
    );
    const migrations = resolve(import.meta.dir, "../pb_migrations");
    const hooks = resolve(import.meta.dir, "../pb_hooks");
    const run = (args: string[]) => {
      const result = Bun.spawnSync([pocketBaseBin!, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    };
    run([
      "migrate",
      "up",
      "--dir",
      dataDirectory,
      "--migrationsDir",
      migrations,
      "--hooksDir",
      hooks,
    ]);
    run([
      "superuser",
      "upsert",
      "admin@example.com",
      "StrongPass123!",
      "--dir",
      dataDirectory,
    ]);
    const port = 34_000 + Math.floor(Math.random() * 1_000);
    const origin = `http://127.0.0.1:${port}`;
    server = Bun.spawn(
      [
        pocketBaseBin!,
        "serve",
        "--dir",
        dataDirectory,
        "--migrationsDir",
        migrations,
        "--hooksDir",
        hooks,
        `--http=127.0.0.1:${port}`,
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...process.env,
          JORNAL_AI_CAPTURE_ENABLED: "true",
          JORNAL_PUSH_ENABLED: "true",
          JORNAL_PUSH_VAPID_PUBLIC_KEY: "test-public",
          JORNAL_PUSH_WORKER_SECRET: "test-push-secret",
        },
      },
    );
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if ((await fetch(`${origin}/api/health`).catch(() => null))?.ok) break;
      await Bun.sleep(50);
    }
    const send = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${origin}${path}`, init);
      return {
        response,
        data: (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >,
      };
    };
    const admin = await send(
      "/api/collections/_superusers/auth-with-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: "admin@example.com",
          password: "StrongPass123!",
        }),
      },
    );
    const headers = (token: string) => ({
      Authorization: token,
      "Content-Type": "application/json",
    });
    const createUser = async (email: string) => {
      const user = await send("/api/collections/users/records", {
        method: "POST",
        headers: headers(String(admin.data.token)),
        body: JSON.stringify({
          email,
          verified: true,
          password: "UserPass123!",
          passwordConfirm: "UserPass123!",
        }),
      });
      const auth = await send(
        `/api/collections/users/impersonate/${user.data.id}`,
        {
          method: "POST",
          headers: { Authorization: String(admin.data.token) },
        },
      );
      return { id: String(user.data.id), token: String(auth.data.token) };
    };
    const owner = await createUser("invoice-owner@example.com");
    const setup = await send("/api/jornal/companies/setup", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        name: "Toko Invoice",
        creationKey: "invoice-company",
        requestId: "setup",
        initialSetup: true,
        profile: {
          businessName: "Toko Invoice",
          businessType: "INDIVIDUAL",
          taxScheme: "UMKM_FINAL",
        },
        accounts: [
          {
            id: "bank-a",
            name: "Bank A",
            type: "BANK",
            openingBalance: 0,
            includedInCash: true,
          },
        ],
      }),
    });
    expect(setup.response.status).toBe(201);
    const companyId = String(setup.data.id);
    const base = { companyId, dataEpoch: 1 };
    const customer = await send("/api/jornal/invoicing/customers", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        ...base,
        commandKey: "customer-1",
        name: "Pelanggan A",
        email: "A@EXAMPLE.COM",
        postalCode: "00123",
      }),
    });
    if (customer.response.status !== 201)
      throw new Error(
        `customer failed ${customer.response.status}: ${JSON.stringify(customer.data)}`,
      );
    expect(customer.response.status).toBe(201);
    const customerId = String(
      (customer.data.customer as Record<string, unknown>).id,
    );
    const draftBody = {
      ...base,
      commandKey: "draft-1",
      customerId,
      issueDate: "2026-09-17",
      dueDate: "2026-09-24",
      timezone: "Asia/Jakarta",
      items: [
        {
          description: "Barang",
          quantityScaled: 2_000,
          unitLabel: "Lusin",
          unitPrice: 100_000,
          sortOrder: 0,
        },
      ],
      discountAmount: 0,
      shippingAmount: 0,
      taxRateBps: 0,
    };
    const draft = await send("/api/jornal/invoicing/invoices", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify(draftBody),
    });
    if (draft.response.status !== 201)
      throw new Error(
        `draft failed ${draft.response.status}: ${JSON.stringify(draft.data)}`,
      );
    expect(draft.response.status).toBe(201);
    expect((draft.data.invoice as Record<string, unknown>).grandTotal).toBe(
      200_000,
    );
    const invoice = draft.data.invoice as Record<string, unknown>;
    const issued = await send(
      `/api/jornal/invoicing/invoices/${invoice.id}/issue`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "issue-1",
          expectedRevision: invoice.revision,
        }),
      },
    );
    if (issued.response.status !== 200)
      throw new Error(
        `issue failed ${issued.response.status}: ${JSON.stringify(issued.data)}`,
      );
    expect(issued.response.status).toBe(200);
    const unpaid = issued.data.invoice as Record<string, unknown>;
    expect(unpaid.invoiceNumber).toBe("001");
    const paymentBody = {
      ...base,
      commandKey: "pay-1",
      expectedRevision: unpaid.revision,
      paidOn: "2026-09-17",
      transactionId: "invoice-cash-1",
      accountId: "bank-a",
      mode: "CREATE",
    };
    const paid = await send(
      `/api/jornal/invoicing/invoices/${invoice.id}/mark-paid`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify(paymentBody),
      },
    );
    expect(paid.response.status).toBe(200);
    expect(
      (paid.data.ledgerTransaction as Record<string, unknown>).amount,
    ).toBe(200_000);
    const replay = await send(
      `/api/jornal/invoicing/invoices/${invoice.id}/mark-paid`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify(paymentBody),
      },
    );
    expect(replay.response.status).toBe(200);
    const ledger = await send(
      "/api/collections/jornal_records/records?filter=app_id%3D%27invoice-cash-1%27",
      {
        headers: {
          Authorization: owner.token,
          "X-Jornal-Protocol": "2",
          "X-Jornal-Company": companyId,
        },
      },
    );
    expect(ledger.data.items as unknown[]).toHaveLength(1);
    const payment = paid.data.payment as Record<string, unknown>;
    const correction = await send(
      `/api/jornal/invoicing/payments/${payment.id}/correct`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "correct-1",
          expectedRevision: payment.revision,
          reason: "Salah pilih pembayaran",
        }),
      },
    );
    if (correction.response.status !== 200)
      throw new Error(
        `correction failed ${correction.response.status}: ${JSON.stringify(correction.data)}`,
      );
    expect(correction.response.status).toBe(200);
    expect((correction.data.invoice as Record<string, unknown>).status).toBe(
      "UNPAID",
    );
    const voided = await send(
      `/api/jornal/invoicing/invoices/${invoice.id}/void`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "void-1",
          expectedRevision: (correction.data.invoice as Record<string, unknown>)
            .revision,
          reason: "Invoice diganti",
        }),
      },
    );
    expect(voided.response.status).toBe(200);
    const duplicate = await send(
      `/api/jornal/invoicing/invoices/${invoice.id}/duplicate`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({ ...base, commandKey: "duplicate-1" }),
      },
    );
    expect(duplicate.response.status).toBe(201);
    expect((duplicate.data.invoice as Record<string, unknown>).status).toBe(
      "DRAFT",
    );
    const duplicateDraft = duplicate.data.invoice as Record<string, unknown>;
    const issuedDuplicate = await send(
      `/api/jornal/invoicing/invoices/${duplicateDraft.id}/issue`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "issue-2",
          expectedRevision: duplicateDraft.revision,
        }),
      },
    );
    expect(issuedDuplicate.response.status).toBe(200);
    const existingTransaction = {
      id: "existing-cash-1",
      businessId: owner.id,
      companyId,
      direction: "MONEY_IN",
      amount: 200_000,
      currency: "IDR",
      transactionDate: "2026-09-17",
      description: "Transfer pelanggan",
      classification: "REVENUE",
      businessRelevance: "BUSINESS",
      reviewStatus: "ACCEPTED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const createdExisting = await send(
      "/api/collections/jornal_records/records",
      {
        method: "POST",
        headers: {
          ...headers(owner.token),
          "X-Jornal-Protocol": "2",
          "X-Jornal-Company": companyId,
        },
        body: JSON.stringify({
          business_id: owner.id,
          company_id: companyId,
          data_epoch: 1,
          entity: "transactions",
          app_id: existingTransaction.id,
          payload: existingTransaction,
          revision: 1,
        }),
      },
    );
    expect(createdExisting.response.status).toBe(200);
    const unpaidDuplicate = issuedDuplicate.data.invoice as Record<
      string,
      unknown
    >;
    const linked = await send(
      `/api/jornal/invoicing/invoices/${duplicateDraft.id}/mark-paid`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "pay-link-1",
          expectedRevision: unpaidDuplicate.revision,
          transactionId: existingTransaction.id,
          expectedTransactionRevision: 1,
          mode: "LINK_EXISTING",
        }),
      },
    );
    expect(linked.response.status).toBe(200);
    expect((linked.data.payment as Record<string, unknown>).origin).toBe(
      "LINKED",
    );
    const linkedPayment = linked.data.payment as Record<string, unknown>;
    const unlink = await send(
      `/api/jornal/invoicing/payments/${linkedPayment.id}/correct`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "correct-link-1",
          expectedRevision: linkedPayment.revision,
          reason: "Transfer bukan untuk invoice ini",
        }),
      },
    );
    expect(unlink.response.status).toBe(200);
    const voidDuplicate = await send(
      `/api/jornal/invoicing/invoices/${duplicateDraft.id}/void`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "void-2",
          expectedRevision: (unlink.data.invoice as Record<string, unknown>)
            .revision,
          reason: "Dibatalkan setelah koreksi",
        }),
      },
    );
    expect(voidDuplicate.response.status).toBe(200);
    const list = await send(
      `/api/jornal/invoicing/invoices?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: owner.token } },
    );
    expect((list.data.items as unknown[]).length).toBe(2);
    const summary = await send(
      `/api/jornal/invoicing/summary?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: owner.token } },
    );
    expect(summary.data).toMatchObject({ unpaidTotal: 0, unpaidCount: 0 });
    const archivedCustomer = await send(
      `/api/jornal/invoicing/customers/${customerId}/archive`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "archive-customer-1",
          expectedRevision: 1,
        }),
      },
    );
    if (archivedCustomer.response.status !== 200)
      throw new Error(
        `archive failed ${archivedCustomer.response.status}: ${JSON.stringify(archivedCustomer.data)}`,
      );
    expect(archivedCustomer.response.status).toBe(200);
    expect(
      (archivedCustomer.data.customer as Record<string, unknown>).status,
    ).toBe("ARCHIVED");

    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const pngBytes = Uint8Array.from(atob(tinyPng), (value) =>
      value.charCodeAt(0),
    );
    const logoForm = new FormData();
    logoForm.set("revision", String(setup.data.revision));
    logoForm.set("requestId", "logo-1");
    logoForm.set("filename", "logo.png");
    logoForm.set("contentBase64", tinyPng);
    logoForm.set(
      "file",
      new File([pngBytes], "logo.png", { type: "image/png" }),
    );
    const logo = await send(`/api/jornal/companies/${companyId}/logo`, {
      method: "PUT",
      headers: { Authorization: owner.token },
      body: logoForm,
    });
    if (logo.response.status !== 200)
      throw new Error(
        `logo failed ${logo.response.status}: ${JSON.stringify(logo.data)}`,
      );
    expect(logo.response.status).toBe(200);
    const logoAssetId = String(
      (logo.data.company as Record<string, unknown>).logoAssetId,
    );
    expect(logoAssetId).toBeTruthy();
    const logoAsset = await send(
      `/api/jornal/companies/${companyId}/assets/${logoAssetId}`,
      { headers: { Authorization: owner.token } },
    );
    expect(logoAsset.response.status).toBe(200);
    expect(logoAsset.data.contentBase64).toBe(tinyPng);
    const documentForm = new FormData();
    documentForm.set("companyId", companyId);
    documentForm.set("dataEpoch", "1");
    documentForm.set("source", "UPLOAD");
    documentForm.set("filename", "receipt.png");
    documentForm.set("contentBase64", tinyPng);
    documentForm.set(
      "file",
      new File([pngBytes], "receipt.png", { type: "image/png" }),
    );
    const document = await send("/api/jornal/documents", {
      method: "POST",
      headers: { Authorization: owner.token },
      body: documentForm,
    });
    expect(document.response.status).toBe(201);
    const documentId = String(
      (document.data.document as Record<string, unknown>).id,
    );
    const documentDetail = await send(
      `/api/jornal/documents/${documentId}?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: owner.token } },
    );
    expect(documentDetail.response.status).toBe(200);
    expect(documentDetail.data.contentBase64).toBe(tinyPng);
    const queued = await send(`/api/jornal/documents/${documentId}/extract`, {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({ ...base, requestKey: "extract-1" }),
    });
    expect(queued.response.status).toBe(202);
    expect((queued.data.job as Record<string, unknown>).status).toBe("QUEUED");
    const confirmed = await send(
      `/api/jornal/documents/${documentId}/confirm`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "document-confirm-1",
          expectedRevision: 1,
          mode: "CREATE_TRANSACTION",
          transactionId: "document-cash-1",
          direction: "MONEY_OUT",
          amount: 55_000,
          transactionDate: "2026-09-17",
          description: "Belanja dari struk",
        }),
      },
    );
    if (confirmed.response.status !== 200)
      throw new Error(
        `document confirm failed ${confirmed.response.status}: ${JSON.stringify(confirmed.data)}`,
      );
    expect((confirmed.data.document as Record<string, unknown>).status).toBe(
      "LINKED",
    );
    const confirmedReplay = await send(
      `/api/jornal/documents/${documentId}/confirm`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "document-confirm-1",
          expectedRevision: 1,
          mode: "CREATE_TRANSACTION",
          transactionId: "document-cash-1",
          direction: "MONEY_OUT",
          amount: 55_000,
          transactionDate: "2026-09-17",
          description: "Belanja dari struk",
        }),
      },
    );
    expect(confirmedReplay.response.status).toBe(200);
    const documentLedger = await send(
      "/api/collections/jornal_records/records?filter=app_id%3D%27document-cash-1%27",
      {
        headers: {
          Authorization: owner.token,
          "X-Jornal-Protocol": "2",
          "X-Jornal-Company": companyId,
        },
      },
    );
    expect(documentLedger.data.items as unknown[]).toHaveLength(1);
    const unlinked = await send(`/api/jornal/documents/${documentId}/unlink`, {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        ...base,
        commandKey: "document-unlink-1",
        expectedRevision: 2,
        reason: "Dokumen salah",
      }),
    });
    expect(unlinked.response.status).toBe(200);
    expect(unlinked.data.ledgerDeleted).toBe(true);

    const other = await createUser("invoice-other@example.com");
    const forbiddenLogo = await send(
      `/api/jornal/companies/${companyId}/assets/${logoAssetId}`,
      { headers: { Authorization: other.token } },
    );
    expect(forbiddenLogo.response.status).toBe(404);
    const forbiddenDocument = await send(
      `/api/jornal/documents/${documentId}?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: other.token } },
    );
    expect(forbiddenDocument.response.status).toBe(404);

    const reminderCustomer = await send("/api/jornal/invoicing/customers", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        ...base,
        commandKey: "customer-reminder",
        name: "Pelanggan Reminder",
      }),
    });
    if (reminderCustomer.response.status !== 201)
      throw new Error(
        `reminder customer failed ${reminderCustomer.response.status}: ${JSON.stringify(reminderCustomer.data)}`,
      );
    const reminderCustomerId = String(
      (reminderCustomer.data.customer as Record<string, unknown>).id,
    );
    const overdueDraft = await send("/api/jornal/invoicing/invoices", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        ...base,
        commandKey: "draft-overdue",
        customerId: reminderCustomerId,
        issueDate: "2026-09-15",
        dueDate: "2026-09-16",
        timezone: "Asia/Jakarta",
        items: [
          {
            description: "Jasa overdue",
            quantityScaled: 1_000,
            unitLabel: "pcs",
            unitPrice: 75_000,
            sortOrder: 0,
          },
        ],
      }),
    });
    const overdueInvoice = overdueDraft.data.invoice as Record<string, unknown>;
    const overdueIssued = await send(
      `/api/jornal/invoicing/invoices/${overdueInvoice.id}/issue`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "issue-overdue",
          expectedRevision: overdueInvoice.revision,
        }),
      },
    );
    expect(overdueIssued.response.status).toBe(200);
    const subscription = await send("/api/jornal/push/subscriptions", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        endpoint: "https://push.example.test/device-1",
        keys: { p256dh: "key", auth: "auth" },
        companyIds: [companyId],
        preferences: {
          invoice: true,
          tax: true,
          documents: true,
          hideAmounts: true,
        },
        timezone: "Asia/Jakarta",
      }),
    });
    expect(subscription.response.status).toBe(201);
    const jobs = await send("/api/jornal/admin/invoices/run-jobs", {
      method: "POST",
      headers: { Authorization: String(admin.data.token) },
    });
    expect(jobs.response.status).toBe(200);
    expect(Number(jobs.data.created)).toBeGreaterThanOrEqual(1);
    const reminders = await send(
      `/api/jornal/invoicing/reminders?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: owner.token } },
    );
    expect(reminders.data.items as unknown[]).toHaveLength(1);
    const pushJobs = await send("/api/jornal/admin/push/run-jobs", {
      method: "POST",
      headers: { Authorization: String(admin.data.token) },
    });
    expect(pushJobs.response.status).toBe(200);
    expect(Number(pushJobs.data.created)).toBeGreaterThanOrEqual(1);
    const claimed = await send("/api/jornal/internal/push/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Jornal-Push-Secret": "test-push-secret",
      },
      body: JSON.stringify({ limit: 25 }),
    });
    if (claimed.response.status !== 200)
      throw new Error(
        `push claim failed ${claimed.response.status}: ${JSON.stringify(claimed.data)}`,
      );
    const claimedItems = claimed.data.items as Array<Record<string, unknown>>;
    expect(claimedItems.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(claimedItems)).not.toContain("75000");
    const completedPush = await send(
      `/api/jornal/internal/push/${claimedItems[0].id}/complete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Jornal-Push-Secret": "test-push-secret",
        },
        body: JSON.stringify({ outcome: "SENT" }),
      },
    );
    expect(completedPush.response.status).toBe(200);
    const issuedOverdue = overdueIssued.data.invoice as Record<string, unknown>;
    const matchForm = new FormData();
    matchForm.set("companyId", companyId);
    matchForm.set("dataEpoch", "1");
    matchForm.set("source", "UPLOAD");
    matchForm.set("filename", "payment.png");
    matchForm.set("contentBase64", tinyPng);
    matchForm.set(
      "file",
      new File([pngBytes], "payment.png", { type: "image/png" }),
    );
    const matchDocument = await send("/api/jornal/documents", {
      method: "POST",
      headers: { Authorization: owner.token },
      body: matchForm,
    });
    const matchDocumentId = String(
      (matchDocument.data.document as Record<string, unknown>).id,
    );
    const matched = await send(
      `/api/jornal/documents/${matchDocumentId}/confirm`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "document-match-invoice",
          expectedRevision: 1,
          mode: "MATCH_INVOICE",
          invoiceId: issuedOverdue.id,
          expectedInvoiceRevision: issuedOverdue.revision,
          transactionId: "overdue-document-cash",
          amount: 75_000,
          transactionDate: "2026-09-17",
          description: "Bukti pembayaran invoice",
        }),
      },
    );
    if (matched.response.status !== 200)
      throw new Error(
        `invoice document match failed ${matched.response.status}: ${JSON.stringify(matched.data)}`,
      );
    expect((matched.data.invoice as Record<string, unknown>).status).toBe(
      "PAID",
    );
    expect(
      (matched.data.document as Record<string, unknown>).linkedPaymentId,
    ).toBeTruthy();
    const matchedPayment = matched.data.payment as Record<string, unknown>;
    const correctedMatch = await send(
      `/api/jornal/invoicing/payments/${matchedPayment.id}/correct`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "correct-document-match",
          expectedRevision: matchedPayment.revision,
          reason: "Bukti salah",
        }),
      },
    );
    expect(correctedMatch.response.status).toBe(200);
    const documentAfterCorrection = await send(
      `/api/jornal/documents/${matchDocumentId}?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: owner.token } },
    );
    expect(
      (documentAfterCorrection.data.document as Record<string, unknown>).status,
    ).toBe("REVIEW_READY");
    const correctedInvoice = correctedMatch.data.invoice as Record<
      string,
      unknown
    >;
    const paidOverdue = await send(
      `/api/jornal/invoicing/invoices/${issuedOverdue.id}/mark-paid`,
      {
        method: "POST",
        headers: headers(owner.token),
        body: JSON.stringify({
          ...base,
          commandKey: "pay-overdue",
          expectedRevision: correctedInvoice.revision,
          paidOn: "2026-09-17",
          transactionId: "overdue-cash-1",
          mode: "CREATE",
        }),
      },
    );
    expect(paidOverdue.response.status).toBe(200);
    const resolvedReminders = await send(
      `/api/jornal/invoicing/reminders?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: owner.token } },
    );
    expect(resolvedReminders.data.items as unknown[]).toHaveLength(0);

    const backup = await send(
      `/api/jornal/invoicing/backup?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: owner.token } },
    );
    if (backup.response.status !== 200)
      throw new Error(
        `backup export failed ${backup.response.status}: ${JSON.stringify(backup.data)}`,
      );
    expect(backup.data.manifest).toMatchObject({
      format: "jornal-invoice-backup",
      version: 1,
      remindersIncluded: false,
    });
    expect(
      (backup.data.data as Record<string, unknown[]>).invoices.length,
    ).toBe(3);
    const backupPreview = await send("/api/jornal/invoicing/backup/dry-run", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({ ...base, backup: backup.data, replaceLogo: true }),
    });
    if (backupPreview.response.status !== 200)
      throw new Error(
        `backup preview failed ${backupPreview.response.status}: ${JSON.stringify(backupPreview.data)}`,
      );
    expect(backupPreview.data).toMatchObject({
      valid: true,
      willReplaceActiveLogo: true,
      remindersWillNotBeRestored: true,
    });
    expect(backupPreview.data.requiredAccountIds as unknown[]).toHaveLength(0);
    const restored = await send("/api/jornal/invoicing/backup/restore", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        ...base,
        backup: backup.data,
        replaceLogo: true,
        confirm: true,
        commandKey: "invoice-backup-restore-1",
        reason: "Integration restore",
      }),
    });
    if (restored.response.status !== 200)
      throw new Error(
        `backup restore failed ${restored.response.status}: ${JSON.stringify(restored.data)}`,
      );
    expect(restored.data).toMatchObject({
      restored: true,
      remindersRestored: false,
    });
    expect(
      Number((restored.data.counts as Record<string, unknown>).merged),
    ).toBeGreaterThan(0);
    const restoredReplay = await send("/api/jornal/invoicing/backup/restore", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({
        ...base,
        backup: backup.data,
        replaceLogo: true,
        confirm: true,
        commandKey: "invoice-backup-restore-1",
        reason: "Integration restore",
      }),
    });
    expect(restoredReplay.response.status).toBe(200);
    expect(restoredReplay.data).toEqual(restored.data);
    const corruptedBackup = structuredClone(backup.data);
    (corruptedBackup.checksums as Record<string, string>).bundle = "corrupt";
    const rejectedBackup = await send("/api/jornal/invoicing/backup/dry-run", {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({ ...base, backup: corruptedBackup }),
    });
    expect(rejectedBackup.response.status).toBe(400);
  },
);
