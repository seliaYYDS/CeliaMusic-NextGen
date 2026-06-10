type StringKeyedRecord<T> = Record<string, T>;

function buildProtectedKeySet(keys?: Iterable<string>) {
  return new Set(
    Array.from(keys ?? []).filter((key): key is string => typeof key === "string" && key.trim().length > 0),
  );
}

export function pruneBoundedMap<K, V>(
  map: Map<K, V>,
  maxEntries: number,
  protectedKeys?: Iterable<K>,
) {
  if (maxEntries < 1) {
    map.clear();
    return [] as K[];
  }

  const preserved = new Set(protectedKeys ?? []);
  const removed: K[] = [];
  for (const key of map.keys()) {
    if (map.size <= maxEntries) {
      break;
    }
    if (preserved.has(key)) {
      continue;
    }

    map.delete(key);
    removed.push(key);
  }

  return removed;
}

export function setBoundedMapValue<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
  protectedKeys?: Iterable<K>,
) {
  if (map.has(key)) {
    map.delete(key);
  }

  map.set(key, value);
  return pruneBoundedMap(map, maxEntries, protectedKeys);
}

export function pruneBoundedRecord<T>(
  record: StringKeyedRecord<T>,
  maxEntries: number,
  protectedKeys?: Iterable<string>,
) {
  if (maxEntries < 1) {
    const removed = Object.keys(record);
    removed.forEach((key) => {
      delete record[key];
    });
    return removed;
  }

  const preserved = buildProtectedKeySet(protectedKeys);
  const removed: string[] = [];
  let remainingEntries = Object.keys(record).length;
  Object.keys(record).forEach((key) => {
    if (remainingEntries <= maxEntries) {
      return;
    }
    if (preserved.has(key)) {
      return;
    }

    delete record[key];
    remainingEntries -= 1;
    removed.push(key);
  });

  return removed;
}

export function setBoundedRecordValue<T>(
  record: StringKeyedRecord<T>,
  key: string,
  value: T,
  maxEntries: number,
  protectedKeys?: Iterable<string>,
) {
  if (Object.prototype.hasOwnProperty.call(record, key)) {
    delete record[key];
  }

  record[key] = value;
  return pruneBoundedRecord(record, maxEntries, protectedKeys);
}
