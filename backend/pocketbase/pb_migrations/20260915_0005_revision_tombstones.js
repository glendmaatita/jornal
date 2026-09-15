// Metadata required for conditional sync writes and explicit deletion
// propagation. Existing records remain live at revision 0 until a client
// writes them with the new protocol.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("jornal_records")
    if (!collection.fields.getByName("revision")) collection.fields.add(new Field({
      name: "revision",
      type: "number",
      // Existing rows need to migrate before the request hook can populate
      // this value. The hook treats an absent value as revision 0 and assigns
      // the first revision on the next write.
      required: false,
      min: 0,
    }))
    if (!collection.fields.getByName("deleted_at")) collection.fields.add(new Field({
      name: "deleted_at",
      type: "date",
      required: false,
    }))
    app.save(collection)
  },
  () => {
    // Keep metadata on rollback to avoid deleting values from a populated
    // database when field ownership cannot be distinguished safely.
  },
)
