import mongoose from 'mongoose';

// ÉLAN builds the indexes its models ask for. A *unique* index it did not ask for, on one of its collections, almost
// always means the database is shared with another project (typically MongoDB's default "test" database). Such an index
// makes inserts fail halfway through with "E11000 duplicate key", so we look for it up front and explain instead.

/** The unique indexes in `existing` (as listed by MongoDB) whose names are in `unexpected`. Never the _id index. */
export function pickUniqueIndexes(existing, unexpected) {
  const names = new Set(unexpected ?? []);
  return (existing ?? []).filter((ix) => ix.name !== '_id_' && ix.unique === true && names.has(ix.name));
}

/** Every unexpected unique index on a registered model: [{ collection, name, fields }]. Never throws. */
export async function findForeignUniqueIndexes(models = Object.values(mongoose.models)) {
  const found = [];
  for (const Model of models) {
    try {
      const existing = await Model.listIndexes();
      if (!existing?.length) continue;
      const { toDrop } = await Model.diffIndexes();
      for (const ix of pickUniqueIndexes(existing, toDrop)) {
        found.push({ collection: Model.collection.collectionName, name: ix.name, fields: Object.keys(ix.key ?? {}) });
      }
    } catch {
      // The collection does not exist yet, or this server cannot inspect it. The check must never be the reason
      // something fails, so whatever cannot be inspected is skipped.
    }
  }
  return found;
}

/** The message a person reads when such indexes are found. */
export function explainForeignIndexes(found, dbName) {
  const lines = found.map((f) => `  - ${f.collection}: ${f.name} (${f.fields.join(', ')})`);
  return [
    `The database "${dbName}" has a unique index that ÉLAN did not create:`,
    ...lines,
    '',
    `This usually means "${dbName}" is used by another project (MongoDB's default database is called "test"). Saving`,
    'would fail halfway with "E11000 duplicate key".',
    '',
    'Fix: give ÉLAN a database of its own. Put the name at the end of MONGODB_URI, for example',
    '  mongodb://127.0.0.1:27017/elan',
    'or, for Atlas, add /elan after the host and before the "?". Nothing in your existing database is touched.',
    'If you are sure these indexes are harmless, run again with --skip-index-check.',
  ].join('\n');
}
