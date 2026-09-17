function exportRecord(record, helpers, jsonFields) {
  const output = JSON.parse(JSON.stringify(record.publicExport()));
  delete output.collectionId;
  delete output.collectionName;
  delete output.expand;
  for (const field of jsonFields || [])
    output[field] = helpers.json(record, field, output[field] ?? null);
  return output;
}

function validate(backup, helpers) {
  if (
    !backup ||
    backup.manifest?.format !== "jornal-invoice-backup" ||
    backup.manifest?.version !== 1 ||
    !backup.data ||
    !backup.checksums
  )
    throw new ApiError(400, "Format backup invoice tidak didukung");
  for (const [name, rows] of Object.entries(backup.data))
    if (
      backup.checksums[name] !== $security.sha256(helpers.stableStringify(rows))
    )
      throw new ApiError(400, `Checksum backup tidak cocok: ${name}`);
  if (
    backup.checksums.bundle !==
    $security.sha256(helpers.stableStringify(backup.data))
  )
    throw new ApiError(400, "Checksum bundle backup tidak cocok");
  return backup;
}

module.exports = { exportRecord, validate };
