routerAdd(
  "GET",
  "/api/jornal/invoicing/backup",
  (event) => {
    const h = require(`${__hooks}/invoice_helpers.js`);
    const backupHelpers = require(`${__hooks}/invoice_backup_helpers.js`);
    const query = event.requestInfo().query || {};
    const scope = h.requestScope(event, query, false);
    const company = h.ownedCompany(
      $app,
      scope.tenantId,
      scope.companyId,
      scope.epoch,
      false,
    );
    const scoped = (name, sort) =>
      h.findAllRecords(
        $app,
        name,
        "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch}",
        sort || "created,id",
        {
          tenant: scope.tenantId,
          company: scope.companyId,
          epoch: scope.epoch,
        },
      );
    const customers = scoped("invoice_customers").map((record) =>
      backupHelpers.exportRecord(record, h),
    );
    const units = scoped("invoice_units", "sort_order,id").map((record) =>
      backupHelpers.exportRecord(record, h),
    );
    const settings = scoped("invoice_settings").map((record) =>
      backupHelpers.exportRecord(record, h, ["payment_instructions"]),
    );
    const invoices = scoped("invoices").map((record) =>
      backupHelpers.exportRecord(record, h, [
        "customer_snapshot",
        "sender_snapshot",
        "payment_instructions_snapshot",
        "items",
      ]),
    );
    const payments = scoped("invoice_payments").map((record) =>
      backupHelpers.exportRecord(record, h, ["original_ledger_snapshot"]),
    );
    const audit = scoped("invoice_audit").map((record) =>
      backupHelpers.exportRecord(record, h, [
        "before_snapshot",
        "after_snapshot",
      ]),
    );
    const ledgerIds = [
      ...new Set(
        payments
          .map((item) => String(item.ledger_transaction_id || ""))
          .filter(Boolean),
      ),
    ];
    const ledger = ledgerIds
      .map((id) => {
        try {
          const record = $app.findFirstRecordByFilter(
            "jornal_records",
            "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'transactions' && app_id = {:id}",
            {
              tenant: scope.tenantId,
              company: scope.companyId,
              epoch: scope.epoch,
              id,
            },
          );
          return backupHelpers.exportRecord(record, h, ["payload"]);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const assetIds = new Set();
    const activeLogoId = company.getString("logo_asset_id");
    if (activeLogoId) assetIds.add(activeLogoId);
    for (const invoice of invoices) {
      const id = String(invoice.sender_snapshot?.logoAssetId || "");
      if (id) assetIds.add(id);
    }
    const assets = [...assetIds]
      .map((id) => {
        try {
          const record = $app.findRecordById("company_assets", id);
          if (
            record.getString("tenant_id") !== scope.tenantId ||
            record.getString("company_id") !== scope.companyId
          )
            return null;
          return backupHelpers.exportRecord(record, h, ["content_base64"]);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const data = {
      customers,
      units,
      settings,
      invoices,
      payments,
      ledger,
      assets,
      audit,
    };
    const checksums = {};
    for (const [name, rows] of Object.entries(data))
      checksums[name] = $security.sha256(h.stableStringify(rows));
    checksums.bundle = $security.sha256(h.stableStringify(data));
    return event.json(200, {
      manifest: {
        format: "jornal-invoice-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceCompanyId: scope.companyId,
        sourceCompanyName: company.getString("name"),
        sourceDataEpoch: scope.epoch,
        activeLogoAssetId: activeLogoId || null,
        remindersIncluded: false,
      },
      data,
      checksums,
    });
  },
  $apis.requireAuth(),
);

routerAdd(
  "POST",
  "/api/jornal/invoicing/backup/dry-run",
  (event) => {
    const h = require(`${__hooks}/invoice_helpers.js`);
    const backupHelpers = require(`${__hooks}/invoice_backup_helpers.js`);
    const body = h.jsonBody(event);
    const scope = h.requestScope(event, body, false);
    const backup = backupHelpers.validate(body.backup, h);
    const invoices = Array.isArray(backup.data.invoices)
      ? backup.data.invoices
      : [];
    const conflicts = [];
    const requiredAccountIds = new Set();
    for (const invoice of invoices)
      if (invoice.invoice_number) {
        const matches = $app.findRecordsByFilter(
          "invoices",
          "tenant_id = {:tenant} && company_id = {:company} && invoice_number = {:number}",
          "",
          1,
          0,
          {
            tenant: scope.tenantId,
            company: scope.companyId,
            number: String(invoice.invoice_number),
          },
        );
        if (
          matches.length &&
          matches[0].getString("content_hash") !==
            String(invoice.content_hash || "")
        )
          conflicts.push({
            type: "INVOICE_NUMBER",
            invoiceNumber: invoice.invoice_number,
          });
      }
    for (const row of Array.isArray(backup.data.ledger)
      ? backup.data.ledger
      : []) {
      const accountId = String(row.payload?.accountId || "");
      if (accountId && !(body.accountMap && body.accountMap[accountId])) {
        const existing = $app.findRecordsByFilter(
          "jornal_records",
          "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'accounts' && app_id = {:account}",
          "",
          1,
          0,
          {
            tenant: scope.tenantId,
            company: scope.companyId,
            epoch: scope.epoch,
            account: accountId,
          },
        );
        if (!existing.length) requiredAccountIds.add(accountId);
      }
    }
    const invalidAssets = (
      Array.isArray(backup.data.assets) ? backup.data.assets : []
    )
      .filter(
        (asset) =>
          $security.sha256(String(asset.content_base64 || "")) !==
          String(asset.checksum || ""),
      )
      .map((asset) => String(asset.id || ""));
    const counts = {};
    for (const [name, rows] of Object.entries(backup.data))
      counts[name] = Array.isArray(rows) ? rows.length : 0;
    return event.json(200, {
      valid: conflicts.length === 0 && invalidAssets.length === 0,
      counts,
      conflicts,
      invalidAssets,
      requiredAccountIds: [...requiredAccountIds],
      willReplaceActiveLogo:
        body.replaceLogo === true && Boolean(backup.manifest.activeLogoAssetId),
      remindersWillNotBeRestored: true,
      warnings: requiredAccountIds.size
        ? ["Pemetaan rekening diperlukan bila restore ke company berbeda."]
        : [],
    });
  },
  $apis.bodyLimit(30_000_000),
  $apis.requireAuth(),
);

routerAdd(
  "POST",
  "/api/jornal/invoicing/backup/restore",
  (event) => {
    const h = require(`${__hooks}/invoice_helpers.js`);
    const c = require(`${__hooks}/company_helpers.js`);
    const backupHelpers = require(`${__hooks}/invoice_backup_helpers.js`);
    const body = h.jsonBody(event);
    const scope = h.requestScope(event, body, true);
    const backup = backupHelpers.validate(body.backup, h);
    if (body.confirm !== true)
      throw new ApiError(400, "Konfirmasi restore wajib diisi");
    const key = h.requireCommand(body);
    const hash = h.commandHash("RESTORE_INVOICE_BACKUP", {
      commandKey: key,
      companyId: scope.companyId,
      dataEpoch: scope.epoch,
      checksum: backup.checksums.bundle,
      replaceLogo: body.replaceLogo === true,
      accountMap: body.accountMap || {},
    });
    let response;
    $app.runInTransaction((tx) => {
      const replay = h.replayCommand(
        tx,
        scope.tenantId,
        scope.companyId,
        scope.epoch,
        key,
        "RESTORE_INVOICE_BACKUP",
        hash,
      );
      if (replay) {
        response = replay.body;
        return;
      }
      const company = h.ownedCompany(
        tx,
        scope.tenantId,
        scope.companyId,
        scope.epoch,
        true,
      );
      const source = (name) =>
        Array.isArray(backup.data[name]) ? backup.data[name] : [];
      const maps = {
        customers: {},
        units: {},
        invoices: {},
        ledger: {},
        assets: {},
      };
      const counts = { created: 0, merged: 0, skipped: 0 };
      const find = (name, filter, params) => {
        try {
          return tx.findFirstRecordByFilter(name, filter, params);
        } catch {
          return null;
        }
      };
      const assign = (record, item, fields) => {
        for (const field of fields)
          if (item[field] !== undefined && item[field] !== null)
            record.set(field, item[field]);
      };
      const resolveAccount = (sourceId) => {
        const id = String(sourceId || "");
        if (!id) return "";
        const mapped = String((body.accountMap || {})[id] || id);
        return find(
          "jornal_records",
          "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'accounts' && app_id = {:account}",
          {
            tenant: scope.tenantId,
            company: scope.companyId,
            epoch: scope.epoch,
            account: mapped,
          },
        )
          ? mapped
          : "";
      };
      for (const item of source("assets")) {
        const encoded = String(item.content_base64 || "");
        if (
          !encoded ||
          $security.sha256(encoded) !== String(item.checksum || "")
        )
          throw new ApiError(400, "Checksum aset logo tidak cocok");
        let record = find(
          "company_assets",
          "tenant_id = {:tenant} && company_id = {:company} && checksum = {:checksum}",
          {
            tenant: scope.tenantId,
            company: scope.companyId,
            checksum: String(item.checksum),
          },
        );
        if (record) counts.merged += 1;
        else {
          const bytes = c.bytesFromBase64(encoded);
          const extension = String(item.mime || "image/png")
            .split("/")[1]
            .replace("jpeg", "jpg");
          record = new Record(tx.findCollectionByNameOrId("company_assets"), {
            tenant_id: scope.tenantId,
            company_id: scope.companyId,
            kind: "COMPANY_LOGO",
            file: $filesystem.fileFromBytes(
              bytes,
              `restored-logo.${extension}`,
            ),
            mime: item.mime,
            byte_size: bytes.length,
            width: item.width,
            height: item.height,
            checksum: item.checksum,
            content_base64: encoded,
          });
          tx.save(record);
          counts.created += 1;
        }
        maps.assets[String(item.id || "")] = record.id;
      }
      for (const item of source("customers")) {
        let record = item.normalized_email
          ? find(
              "invoice_customers",
              "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && normalized_email = {:email}",
              {
                tenant: scope.tenantId,
                company: scope.companyId,
                epoch: scope.epoch,
                email: String(item.normalized_email),
              },
            )
          : null;
        if (!record && item.normalized_phone)
          record = find(
            "invoice_customers",
            "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && normalized_phone = {:phone} && name = {:name}",
            {
              tenant: scope.tenantId,
              company: scope.companyId,
              epoch: scope.epoch,
              phone: String(item.normalized_phone),
              name: String(item.name || ""),
            },
          );
        if (record) counts.merged += 1;
        else {
          record = new Record(
            tx.findCollectionByNameOrId("invoice_customers"),
            {
              tenant_id: scope.tenantId,
              company_id: scope.companyId,
              data_epoch: scope.epoch,
            },
          );
          assign(record, item, [
            "name",
            "email",
            "normalized_email",
            "phone",
            "normalized_phone",
            "address_line1",
            "address_line2",
            "district",
            "city",
            "province",
            "postal_code",
            "status",
            "revision",
          ]);
          if (!record.getInt("revision")) record.set("revision", 1);
          tx.save(record);
          counts.created += 1;
        }
        maps.customers[String(item.id || "")] = record.id;
      }
      for (const item of source("units")) {
        let record = find(
          "invoice_units",
          "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && normalized_label = {:label}",
          {
            tenant: scope.tenantId,
            company: scope.companyId,
            epoch: scope.epoch,
            label: String(item.normalized_label || ""),
          },
        );
        if (record) counts.merged += 1;
        else {
          record = new Record(tx.findCollectionByNameOrId("invoice_units"), {
            tenant_id: scope.tenantId,
            company_id: scope.companyId,
            data_epoch: scope.epoch,
          });
          assign(record, item, [
            "label",
            "normalized_label",
            "status",
            "sort_order",
            "revision",
          ]);
          if (!record.getInt("revision")) record.set("revision", 1);
          tx.save(record);
          counts.created += 1;
        }
        maps.units[String(item.id || "")] = record.id;
      }
      const settingsInput = source("settings")[0];
      if (settingsInput) {
        const settings = h.ensureSettings(
          tx,
          scope.tenantId,
          scope.companyId,
          scope.epoch,
          company.getString("name"),
        );
        assign(settings, settingsInput, [
          "sender_name",
          "sender_phone",
          "sender_email",
          "default_due_days",
          "numbering_prefix",
          "numbering_padding",
          "numbering_start",
          "payment_instructions",
          "default_account_id",
          "reminder_enabled",
          "reminder_timezone",
          "reminder_hour",
          "reminder_repeat_days",
        ]);
        settings.set(
          "default_unit_id",
          maps.units[String(settingsInput.default_unit_id || "")] || "",
        );
        settings.set(
          "default_account_id",
          resolveAccount(settingsInput.default_account_id),
        );
        settings.set(
          "schedule_version",
          settings.getInt("schedule_version") + 1,
        );
        settings.set("revision", settings.getInt("revision") + 1);
        tx.save(settings);
      }
      const pendingReplacements = [];
      for (const item of source("invoices")) {
        let record = item.invoice_number
          ? find(
              "invoices",
              "tenant_id = {:tenant} && company_id = {:company} && invoice_number = {:number}",
              {
                tenant: scope.tenantId,
                company: scope.companyId,
                number: String(item.invoice_number),
              },
            )
          : find(
              "invoices",
              "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && content_hash = {:hash} && status = 'DRAFT'",
              {
                tenant: scope.tenantId,
                company: scope.companyId,
                epoch: scope.epoch,
                hash: String(
                  item.content_hash ||
                    $security.sha256(h.stableStringify(item)),
                ),
              },
            );
        if (record) {
          if (
            item.invoice_number &&
            record.getString("content_hash") !== String(item.content_hash || "")
          )
            throw new ApiError(
              409,
              `Nomor invoice konflik: ${item.invoice_number}`,
            );
          counts.merged += 1;
        } else {
          const customerId = maps.customers[String(item.customer_id || "")];
          if (!customerId)
            throw new ApiError(
              400,
              "Pelanggan invoice backup tidak dapat dipetakan",
            );
          record = new Record(tx.findCollectionByNameOrId("invoices"), {
            tenant_id: scope.tenantId,
            company_id: scope.companyId,
            data_epoch: scope.epoch,
            customer_id: customerId,
          });
          assign(record, item, [
            "status",
            "sequence",
            "invoice_number",
            "issue_date",
            "due_date",
            "timezone",
            "customer_snapshot",
            "payment_instructions_snapshot",
            "items",
            "shipping_method",
            "subtotal",
            "discount_amount",
            "shipping_amount",
            "tax_rate_bps",
            "tax_amount",
            "grand_total",
            "currency",
            "template_version",
            "issued_at",
            "paid_at",
            "payment_cycle",
            "void_reason",
            "revision",
            "deleted_at",
          ]);
          const sender = { ...(item.sender_snapshot || {}) };
          if (sender.logoAssetId)
            sender.logoAssetId =
              maps.assets[String(sender.logoAssetId)] || null;
          record.set("sender_snapshot", sender);
          record.set(
            "content_hash",
            String(
              item.content_hash || $security.sha256(h.stableStringify(item)),
            ),
          );
          if (!record.getInt("revision")) record.set("revision", 1);
          tx.save(record);
          counts.created += 1;
        }
        maps.invoices[String(item.id || "")] = record.id;
        if (item.replaced_invoice_id)
          pendingReplacements.push([record, String(item.replaced_invoice_id)]);
      }
      for (const [record, sourceId] of pendingReplacements) {
        const mapped = maps.invoices[sourceId];
        if (mapped) {
          record.set("replaced_invoice_id", mapped);
          tx.save(record);
        }
      }
      for (const item of source("ledger")) {
        const sourceId = String(item.app_id || "");
        let record = find(
          "jornal_records",
          "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'transactions' && app_id = {:id}",
          {
            tenant: scope.tenantId,
            company: scope.companyId,
            epoch: scope.epoch,
            id: sourceId,
          },
        );
        if (record) counts.merged += 1;
        else {
          const payload = {
            ...(item.payload || {}),
            businessId: scope.tenantId,
            companyId: scope.companyId,
            invoiceId:
              maps.invoices[String(item.payload?.invoiceId || "")] || null,
            customerId:
              maps.customers[String(item.payload?.customerId || "")] || null,
            accountId: resolveAccount(item.payload?.accountId) || null,
            invoicePaymentId: null,
          };
          record = new Record(tx.findCollectionByNameOrId("jornal_records"), {
            business_id: scope.tenantId,
            company_id: scope.companyId,
            data_epoch: scope.epoch,
            entity: "transactions",
            app_id: sourceId,
            payload,
            revision: Number(item.revision || 1),
            deleted_at: item.deleted_at || "",
          });
          tx.save(record);
          counts.created += 1;
        }
        maps.ledger[sourceId] = record.getString("app_id");
      }
      for (const item of source("payments")) {
        const invoiceId = maps.invoices[String(item.invoice_id || "")];
        const ledgerId = maps.ledger[String(item.ledger_transaction_id || "")];
        if (!invoiceId || !ledgerId) {
          counts.skipped += 1;
          continue;
        }
        let record = find(
          "invoice_payments",
          "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && invoice_id = {:invoice} && status = {:status}",
          {
            tenant: scope.tenantId,
            company: scope.companyId,
            epoch: scope.epoch,
            invoice: invoiceId,
            status: String(item.status || "ACTIVE"),
          },
        );
        if (record) counts.merged += 1;
        else {
          record = new Record(tx.findCollectionByNameOrId("invoice_payments"), {
            tenant_id: scope.tenantId,
            company_id: scope.companyId,
            data_epoch: scope.epoch,
            invoice_id: invoiceId,
          });
          assign(record, item, [
            "amount",
            "paid_on",
            "origin",
            "original_ledger_snapshot",
            "status",
            "lifecycle",
            "reference",
            "reversal_reason",
            "reversed_at",
            "revision",
          ]);
          record.set("account_id", resolveAccount(item.account_id));
          record.set("ledger_transaction_id", ledgerId);
          if (!record.getInt("revision")) record.set("revision", 1);
          tx.save(record);
          counts.created += 1;
          const ledgerRecord = find(
            "jornal_records",
            "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'transactions' && app_id = {:id}",
            {
              tenant: scope.tenantId,
              company: scope.companyId,
              epoch: scope.epoch,
              id: ledgerId,
            },
          );
          if (ledgerRecord) {
            const payload = h.json(ledgerRecord, "payload", {});
            ledgerRecord.set("payload", {
              ...payload,
              invoicePaymentId: record.id,
            });
            tx.save(ledgerRecord);
          }
        }
      }
      let maxSequence = 0;
      for (const record of h.findAllRecords(
        tx,
        "invoices",
        "tenant_id = {:tenant} && company_id = {:company}",
        "",
        { tenant: scope.tenantId, company: scope.companyId },
      ))
        maxSequence = Math.max(maxSequence, record.getInt("sequence"));
      let sequence = find(
        "invoice_sequences",
        "tenant_id = {:tenant} && company_id = {:company}",
        { tenant: scope.tenantId, company: scope.companyId },
      );
      if (!sequence)
        sequence = new Record(
          tx.findCollectionByNameOrId("invoice_sequences"),
          {
            tenant_id: scope.tenantId,
            company_id: scope.companyId,
            next_value: maxSequence + 1,
          },
        );
      else
        sequence.set(
          "next_value",
          Math.max(sequence.getInt("next_value"), maxSequence + 1),
        );
      tx.save(sequence);
      if (body.replaceLogo === true && backup.manifest.activeLogoAssetId) {
        company.set(
          "logo_asset_id",
          maps.assets[String(backup.manifest.activeLogoAssetId)] || "",
        );
        company.set("revision", company.getInt("revision") + 1);
        tx.save(company);
      }
      response = {
        restored: true,
        counts,
        remindersRestored: false,
        nextInvoiceNumber: maxSequence + 1,
      };
      h.audit(
        tx,
        scope.tenantId,
        scope.companyId,
        scope.epoch,
        scope.tenantId,
        "invoice-backup-restored",
        "backup",
        backup.checksums.bundle,
        key,
        String(body.reason || "Restore backup invoice"),
        null,
        response,
      );
      h.saveCommand(
        tx,
        scope.tenantId,
        scope.companyId,
        scope.epoch,
        key,
        "RESTORE_INVOICE_BACKUP",
        hash,
        200,
        response,
      );
    });
    return event.json(200, response);
  },
  $apis.bodyLimit(30_000_000),
  $apis.requireAuth(),
);
