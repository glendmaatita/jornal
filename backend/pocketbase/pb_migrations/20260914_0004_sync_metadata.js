// Sync metadata and private receipt files for existing jornal_records installs.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("jornal_records")
    collection.fields.add(new Field({
      name: "created",
      type: "autodate",
      onCreate: true,
      onUpdate: false,
    }))
    collection.fields.add(new Field({
      name: "updated",
      type: "autodate",
      onCreate: true,
      onUpdate: true,
    }))
    const attachment = collection.fields.getByName("attachment")
    if (attachment) attachment.protected = true
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("jornal_records")
    collection.fields.removeByName("created")
    collection.fields.removeByName("updated")
    const attachment = collection.fields.getByName("attachment")
    if (attachment) attachment.protected = false
    app.save(collection)
  },
)
