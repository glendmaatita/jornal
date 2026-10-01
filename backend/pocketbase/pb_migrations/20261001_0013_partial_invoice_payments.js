migrate(
  (app) => {
    const invoices = app.findCollectionByNameOrId("invoices")
    if (!invoices.fields.getByName("paid_amount")) {
      invoices.fields.add(new NumberField({ name: "paid_amount", required: false, min: 0, max: 1_000_000_000_000, onlyInt: true }))
      app.save(invoices)
    }
    for (const invoice of app.findAllRecords(invoices)) {
      const payments = app.findRecordsByFilter("invoice_payments", "invoice_id = {:invoice} && status = 'ACTIVE'", "", 0, 0, { invoice: invoice.id })
      invoice.set("paid_amount", payments.reduce((sum, payment) => sum + payment.getInt("amount"), 0))
      app.save(invoice)
    }
    const collection = app.findCollectionByNameOrId("invoice_payments")
    collection.indexes = collection.indexes.filter((index) => !String(index).includes("idx_invoice_active_payment"))
    collection.indexes.push("CREATE INDEX idx_invoice_active_payments ON invoice_payments (company_id, data_epoch, invoice_id) WHERE status = 'ACTIVE'")
    app.save(collection)
  },
  () => {
    // Payments cannot safely be collapsed back to one active record.
  },
)
