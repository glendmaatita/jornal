// Metadata required for conditional sync writes and explicit deletion
// propagation. Existing records remain live at revision 0 until a client
// writes them with the new protocol.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("jornal_records")
    collection.fields.add(new Field({
      name: "revision",
      type: "number",
      // Existing rows need to migrate before the request hook can populate
      // this value. The hook treats an absent value as revision 0 and assigns
      // the first revision on the next write.
      required: false,
      min: 0,
    }))
    collection.fields.add(new Field({
      name: "deleted_at",
      type: "date",
      required: false,
    }))
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("jornal_records")
    collection.fields.removeByName("revision")
    collection.fields.removeByName("deleted_at")
    app.save(collection)
  },
)
