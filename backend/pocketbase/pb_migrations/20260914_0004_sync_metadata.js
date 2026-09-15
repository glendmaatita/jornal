// Sync metadata and private receipt files for existing jornal_records installs.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("jornal_records")
    if (!collection.fields.getByName("created")) collection.fields.add(new Field({
      name: "created",
      type: "autodate",
      onCreate: true,
      onUpdate: false,
    }))
    if (!collection.fields.getByName("updated")) collection.fields.add(new Field({
      name: "updated",
      type: "autodate",
      onCreate: true,
      onUpdate: true,
    }))
    const attachment = collection.fields.getByName("attachment")
    if (attachment) attachment.protected = true
    app.save(collection)
  },
  () => {
    // Keep fields on rollback: an idempotent migration cannot know whether a
    // pre-existing field belonged to this migration, and removing it could
    // destroy populated data.
  },
)
