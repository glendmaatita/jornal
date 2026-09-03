migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "jornal_records",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "business_id", type: "text", required: true },
        { name: "entity", type: "text", required: true },
        { name: "app_id", type: "text", required: true },
        { name: "payload", type: "json", required: true },
        { name: "attachment", type: "file", maxSelect: 1, maxSize: 10485760 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_jornal_records_business_entity_app ON jornal_records (business_id, entity, app_id)",
      ],
    })

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("jornal_records")
    app.delete(collection)
  },
)
