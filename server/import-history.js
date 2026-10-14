// Provenance is historical metadata. It never resolves or reads an external path.
export function independentMetadata(value) {
  const next = { ...value };
  if (Object.hasOwn(next, 'importRoot')) {
    next.historicalImportRoot = next.historicalImportRoot || next.importRoot;
    delete next.importRoot;
  }
  if (next.provenance) {
    const provenance = { ...next.provenance };
    if (provenance.path) { provenance.historicalPath = provenance.historicalPath || provenance.path; delete provenance.path; }
    if (provenance.file) { provenance.historicalFile = provenance.historicalFile || provenance.file; delete provenance.file; }
    if (provenance.snapshot) {
      if (provenance.sha256 && provenance.sha256 !== provenance.snapshot) provenance.sourceSha256 = provenance.sourceSha256 || provenance.sha256;
      provenance.sha256 = provenance.snapshot;
    }
    next.provenance = provenance;
  }
  return next;
}

export function migrateImportHistory(db) {
  // Update only inert metadata, including old versions. Preserve all revision numbers and payloads.
  for (const table of ['entities', 'history']) {
    for (const row of db.prepare(`SELECT rowid, json FROM ${table}`).all()) {
      const previous = JSON.parse(row.json), next = independentMetadata(previous);
      if (JSON.stringify(previous) !== JSON.stringify(next)) db.prepare(`UPDATE ${table} SET json=? WHERE rowid=?`).run(JSON.stringify(next), row.rowid);
    }
  }
}
