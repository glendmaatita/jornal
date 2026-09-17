import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pocketBase = process.env.POCKETBASE_BIN;
if (!pocketBase) throw new Error("POCKETBASE_BIN wajib diisi");
const count = Number(process.env.INVOICE_BENCHMARK_COUNT || 10_000);
if (!Number.isSafeInteger(count) || count < 1 || count > 100_000)
  throw new Error("INVOICE_BENCHMARK_COUNT tidak valid");
const dataDirectory = await mkdtemp(join(tmpdir(), "jornal-invoice-scale-"));
const migrations = resolve(
  import.meta.dir,
  "../backend/pocketbase/pb_migrations",
);
const hooks = resolve(import.meta.dir, "../backend/pocketbase/pb_hooks");
const port = 36_000 + Math.floor(Math.random() * 1_000);
const origin = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn> | null = null;
const run = (args: string[], stdin?: string) => {
  const result = Bun.spawnSync(args, {
    stdin: stdin ? Buffer.from(stdin) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
};
const start = async () => {
  server = Bun.spawn(
    [
      pocketBase,
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
      stdout: "ignore",
      stderr: "inherit",
      env: { ...process.env, JORNAL_INVOICE_REMINDERS_ENABLED: "true" },
    },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await fetch(`${origin}/api/health`).catch(() => null))?.ok) return;
    await Bun.sleep(50);
  }
  throw new Error("PocketBase benchmark tidak siap");
};
const stop = async () => {
  server?.kill();
  if (server) await server.exited.catch(() => undefined);
  server = null;
};
const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${origin}${path}`, init);
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
};
try {
  run([
    pocketBase,
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
    pocketBase,
    "superuser",
    "upsert",
    "scale-admin@jornal.test",
    "StrongPass123!",
    "--dir",
    dataDirectory,
  ]);
  await start();
  const jsonHeaders = { "Content-Type": "application/json" };
  const admin = await request(
    "/api/collections/_superusers/auth-with-password",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        identity: "scale-admin@jornal.test",
        password: "StrongPass123!",
      }),
    },
  );
  const adminToken = String(admin.token);
  const user = await request("/api/collections/users/records", {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: adminToken },
    body: JSON.stringify({
      email: "scale-owner@jornal.test",
      verified: true,
      password: "UserPass123!",
      passwordConfirm: "UserPass123!",
    }),
  });
  const impersonated = await request(
    `/api/collections/users/impersonate/${user.id}`,
    { method: "POST", headers: { Authorization: adminToken } },
  );
  const token = String(impersonated.token);
  const company = await request("/api/jornal/companies/setup", {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: token },
    body: JSON.stringify({
      name: "Scale Company",
      creationKey: "scale-company",
      requestId: "scale-company",
      initialSetup: true,
      profile: {
        businessName: "Scale Company",
        businessType: "INDIVIDUAL",
        taxScheme: "NOT_CALCULATED",
      },
      accounts: [],
    }),
  });
  const companyId = String(company.id);
  const customerResult = await request("/api/jornal/invoicing/customers", {
    method: "POST",
    headers: { ...jsonHeaders, Authorization: token },
    body: JSON.stringify({
      companyId,
      dataEpoch: 1,
      commandKey: "scale-customer",
      name: "Scale Customer",
    }),
  });
  const customerId = String(
    (customerResult.customer as Record<string, unknown>).id,
  );
  await request(
    `/api/jornal/invoicing/settings?companyId=${companyId}&dataEpoch=1`,
    { headers: { Authorization: token } },
  );
  await stop();
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const now = new Date().toISOString().replace("T", " ");
  const snapshot = JSON.stringify({ id: customerId, name: "Scale Customer" });
  const sender = JSON.stringify({ name: "Scale Company", logoAssetId: null });
  const items = JSON.stringify([
    {
      id: "scale-item",
      description: "Scale item",
      quantityScaled: 1000,
      unitLabel: "pcs",
      unitPrice: 1000,
      lineTotal: 1000,
      sortOrder: 0,
    },
  ]);
  const statements = [
    "BEGIN;",
    "UPDATE invoice_settings SET reminder_hour=0, reminder_repeat_days=7 WHERE company_id=" +
      quote(companyId) +
      ";",
  ];
  for (let index = 1; index <= count; index += 1) {
    const id = `inv${String(index).padStart(12, "0")}`;
    const number = String(index).padStart(6, "0");
    statements.push(
      `INSERT INTO invoices (id,tenant_id,company_id,data_epoch,customer_id,status,sequence,invoice_number,issue_date,due_date,timezone,customer_snapshot,sender_snapshot,payment_instructions_snapshot,items,shipping_method,subtotal,discount_amount,shipping_amount,tax_rate_bps,tax_amount,grand_total,currency,template_version,content_hash,issued_at,paid_at,payment_cycle,void_reason,revision,deleted_at,created,updated,replaced_invoice_id) VALUES (${quote(id)},${quote(String(user.id))},${quote(companyId)},1,${quote(customerId)},'UNPAID',${index},${quote(number)},'2026-09-01','2026-09-15','Asia/Jakarta',${quote(snapshot)},${quote(sender)},'[]',${quote(items)},'',1000,0,0,0,0,1000,'IDR','dropify-order-v1',${quote(`scale-${index}`)},${quote(now)},'',1,'',1,'',${quote(now)},${quote(now)},'');`,
    );
  }
  statements.push(
    `UPDATE invoice_sequences SET next_value=${count + 1} WHERE company_id=${quote(companyId)};`,
    "COMMIT;",
  );
  run(["sqlite3", join(dataDirectory, "data.db")], statements.join("\n"));
  await start();
  const timed = async <T>(name: string, action: () => Promise<T>) => {
    const started = performance.now();
    const result = await action();
    const durationMs = Math.round(performance.now() - started);
    return { name, result, durationMs };
  };
  const summary = await timed("summary", () =>
    request(
      `/api/jornal/invoicing/summary?companyId=${companyId}&dataEpoch=1`,
      { headers: { Authorization: token } },
    ),
  );
  assert.equal(summary.result.unpaidCount, count);
  assert.equal(summary.result.unpaidTotal, count * 1000);
  assert.ok(
    summary.durationMs < 10_000,
    `summary terlalu lambat: ${summary.durationMs}ms`,
  );
  const page = await timed("page", () =>
    request(
      `/api/jornal/invoicing/invoices?companyId=${companyId}&dataEpoch=1&page=100&perPage=100`,
      { headers: { Authorization: token } },
    ),
  );
  assert.equal(page.result.totalItems, count);
  assert.equal((page.result.items as unknown[]).length, 100);
  assert.ok(
    page.durationMs < 10_000,
    `pagination terlalu lambat: ${page.durationMs}ms`,
  );
  const reminders = await timed("reminders", () =>
    request("/api/jornal/admin/invoices/run-jobs", {
      method: "POST",
      headers: { Authorization: adminToken },
    }),
  );
  assert.equal(reminders.result.created, count);
  assert.ok(
    reminders.durationMs < 120_000,
    `scheduler terlalu lambat: ${reminders.durationMs}ms`,
  );
  await stop();
  const reminderCount = Number(
    run([
      "sqlite3",
      join(dataDirectory, "data.db"),
      "SELECT COUNT(*) FROM invoice_reminders;",
    ]).trim(),
  );
  assert.equal(reminderCount, count);
  console.log(
    JSON.stringify(
      {
        invoices: count,
        summaryMs: summary.durationMs,
        pageMs: page.durationMs,
        reminderJobMs: reminders.durationMs,
        reminders: reminderCount,
      },
      null,
      2,
    ),
  );
} finally {
  await stop();
  await rm(dataDirectory, { recursive: true, force: true });
}
