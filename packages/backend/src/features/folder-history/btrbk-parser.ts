/**
 * Parser for btrbk raw format output
 *
 * This module provides functions to parse the raw output format of btrbk commands.
 * The raw format consists of key="value" pairs, with empty lines separating records.
 */

/**
 * Parses the raw output of `btrbk list snapshots --format=raw` or `btrbk list all --format=raw`
 * Handles both multi-line format (one key-value pair per line, empty lines between records)
 * and single-line format (multiple key-value pairs per line, one line per record)
 * @param rawOutput The raw output string from btrbk
 * @returns An array of parsed snapshot objects
 */
export function parseSnapshotsRaw(rawOutput: string): BtrbkSnapshot[] {
  const lines = rawOutput.trim().split("\n");
  const snapshots: BtrbkSnapshot[] = [];
  let currentSnapshot: BtrbkSnapshot = {};

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      // Empty line indicates end of a multi-line record
      if (Object.keys(currentSnapshot).length > 0) {
        snapshots.push(currentSnapshot);
        currentSnapshot = {};
      }
      continue;
    }

    // Parse the line to get key-value pairs
    const pairs = parseLine(trimmedLine);

    for (const [key, value] of pairs) {
      if (key && value !== undefined) {
        currentSnapshot[key] = value;
      }
    }

    // If we're processing a single-line record (multiple pairs), we save it immediately
    // Otherwise, we accumulate in currentSnapshot until we hit an empty line
    if (pairs.length > 1) {
      // This was a single-line record, save it and reset
      if (Object.keys(currentSnapshot).length > 0) {
        snapshots.push(currentSnapshot);
        currentSnapshot = {};
      }
    }
  }

  // Don't forget the last record if there wasn't a trailing empty line
  if (Object.keys(currentSnapshot).length > 0) {
    snapshots.push(currentSnapshot);
  }

  return snapshots;
}

/**
 * Parses the raw output of `btrbk usage --format=raw`
 * @param rawOutput The raw output string from btrbk
 * @returns An array of parsed usage objects
 */
export function parseUsageRaw(rawOutput: string): BtrbkUsage[] {
  return parseRecords(rawOutput);
}

/**
 * Parses the raw output of `btrbk origin --format=raw`
 * @param rawOutput The raw output string from btrbk
 * @returns An array of parsed origin objects
 */
export function parseOriginRaw(rawOutput: string): BtrbkOrigin[] {
  return parseRecords(rawOutput);
}

/**
 * Parses the raw output of `btrbk dryrun --format=raw`
 * @param rawOutput The raw output string from btrbk
 * @returns An array of parsed dryrun objects
 */
export function parseDryRunRaw(rawOutput: string): BtrbkDryRunEntry[] {
  return parseRecords(rawOutput);
}

/**
 * Splits blank-line separated btrbk records and collects their key/value
 * pairs. Records without any pairs are skipped.
 */
function parseRecords(rawOutput: string): Record<string, string>[] {
  const records = rawOutput.trim().split(/\n\s*\n/);
  const parsed: Record<string, string>[] = [];

  for (const record of records) {
    if (!record.trim()) continue;

    const fields: Record<string, string> = {};
    for (const line of record.trim().split("\n")) {
      const [key, value] = parseKeyValuePair(line);
      if (key && value !== undefined) {
        fields[key] = value;
      }
    }

    // Only add complete records
    if (Object.keys(fields).length > 0) {
      parsed.push(fields);
    }
  }

  return parsed;
}

/**
 * Helper function to parse a key="value" pair, supporting both single and double quotes
 * @param pair A string in the format key="value" or key='value'
 * @returns A tuple of [key, value] or [null, null] if parsing fails
 */
function parseKeyValuePair(pair: string): [string | null, string | undefined] {
  // Try to match key="value" or key='value' patterns, handling escaped quotes within the value
  const doubleQuoteMatch = pair.match(/^([^=]+)="((?:[^"\\]|\\.)*)"?$/);
  const singleQuoteMatch = pair.match(/^([^=]+)='((?:[^'\\]|\\.)*)'?$/);

  let match: RegExpMatchArray | null = null;
  let quoteChar = '"';

  if (doubleQuoteMatch) {
    match = doubleQuoteMatch;
  } else if (singleQuoteMatch) {
    match = singleQuoteMatch;
    quoteChar = "'";
  }

  if (!match) {
    // Handle unquoted values
    const parts = pair.split("=");
    if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    return [null, undefined];
  }

  const key = match[1];
  // Unescape quotes in the value
  const value = match[2].replace(
    new RegExp(`\\\\${quoteChar}`, "g"),
    quoteChar,
  );

  return [key, value];
}

/**
 * Helper function to parse a line that might contain multiple key=value pairs
 * @param line A line that might contain multiple key=value pairs
 * @returns An array of [key, value] tuples
 */
function parseLine(line: string): Array<[string, string | undefined]> {
  const pairs: Array<[string, string | undefined]> = [];

  // First try to parse as a single line with multiple pairs
  // Look for patterns like key=value or key="value" separated by spaces
  const keyValuePairs = line.match(
    /(?:\w+)=(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^ ]*)/g,
  );

  if (keyValuePairs && keyValuePairs.length > 1) {
    // This looks like a single-line format with multiple pairs
    for (const pair of keyValuePairs) {
      const [key, value] = parseKeyValuePair(pair);
      if (key && value !== undefined) {
        pairs.push([key, value]);
      }
    }
  } else {
    // This looks like a single key=value pair
    const [key, value] = parseKeyValuePair(line);
    if (key && value !== undefined) {
      pairs.push([key, value]);
    }
  }

  return pairs;
}

export type BtrbkSnapshot = {
  // Fields from list snapshots
  volume?: string;
  snapshot?: string;
  snapshot_type?: string;
  timestamp?: string;
  parent_uuid?: string;
  snapshot_dir?: string;
  snapshot_path?: string;
  filesystem_uuid?: string;

  // Fields from list all
  source_url?: string;
  source_subvolume?: string;
  snapshot_subvolume?: string;
  snapshot_name?: string;
  target_url?: string;
  target_subvolume?: string;
  target_type?: string;
  type?: string;
  status?: string;
  source_host?: string;
  source_port?: string;
  target_host?: string;
  target_port?: string;
  source_rsh?: string;
  target_rsh?: string;

  [key: string]: string | undefined; // Allow for additional properties
};

export type BtrbkUsage = {
  volume?: string;
  device?: string;
  size?: string;
  used?: string;
  free?: string;
  total?: string;
  [key: string]: string | undefined; // Allow for additional properties
};

export type BtrbkOrigin = {
  volume?: string;
  subvolume?: string;
  snapshot?: string;
  origin?: string;
  received_from?: string;
  parent_uuid?: string;
  uuid?: string;
  send_subvolume?: string;
  [key: string]: string | undefined; // Allow for additional properties
};

export type BtrbkDryRunEntry = {
  volume?: string;
  snapshot_create?: string;
  snapshot_preserve_min?: string;
  snapshot_preserve?: string;
  target_preserve_min?: string;
  target_preserve?: string;
  subvolume?: string;
  subvolume_rel?: string;
  snapshot_dir?: string;
  snapshot_name?: string;
  snapshot_exists?: string;
  timestamp?: string;
  snapshot_type?: string;
  snapshot_protected?: string;
  target_sync?: string;
  target_volume?: string;
  target_subvolume?: string;
  target_exists?: string;
  target_protected?: string;
  target_isidentical?: string;
  backup_success?: string;
  backup_phase?: string;
  [key: string]: string | undefined; // Allow for additional properties
};
