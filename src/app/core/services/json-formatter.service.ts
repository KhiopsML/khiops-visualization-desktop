/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { Injectable } from '@angular/core';

/**
 * Describes the format state of the original JSON file.
 * Used to reproduce the exact same formatting on save.
 */
export interface JsonFormatState {
  /** Detected indentation string (e.g. '  ', '    ', '\t') */
  indent: string;
  /** Line ending style used in the file */
  lineEnding: '\r\n' | '\n';
  /**
   * Set of dot-separated key paths whose value was inlined (minified) in the
   * original file, e.g. "coclusteringReport.summary".
   * A path is considered minified when its entire value fits on a single line.
   */
  minifiedPaths: Set<string>;
  /**
   * Set of dot-separated key paths that are ARRAYS whose items are inlined
   * (each item fits on a single line).
   * e.g. "coclusteringReport.cellPartIndexes" means every [i] inside is inlined.
   * This is separate from minifiedPaths so that newly-merged items (indices
   * beyond the original range) are also serialised inline.
   */
  minifiedArrayItemPaths: Set<string>;
  /**
   * Set of dot-separated key paths whose string value contained escaped forward
   * slashes (\/  →  /) in the original file.
   * JSON.stringify never emits \/, so we re-apply the escaping on those paths.
   */
  escapedSlashPaths: Set<string>;
  /**
   * Ordered list of keys for every object encountered, keyed by dot-path.
   * This lets us reproduce the original key ordering at every nesting level.
   */
  keyOrder: Map<string, string[]>;
}

/**
 * Service responsible for analyzing and applying JSON formatting.
 * Handles detection of indent style, line endings, key ordering, and minification patterns.
 * Allows reproducing the exact original file format when saving modified JSON data.
 */
@Injectable({
  providedIn: 'root',
})
export class JsonFormatterService {
  /**
   * Analyse the raw JSON text and return a JsonFormatState that captures:
   * – indent string
   * – line ending style
   * – which key paths were minified (value on same line as key, no internal newlines)
   * – which array paths have their items inlined (covers merged indices too)
   * – key ordering at every object level
   */
  analyzeJsonFormat(raw: string): JsonFormatState {
    const lineEnding: '\r\n' | '\n' = raw.includes('\r\n') ? '\r\n' : '\n';

    // Detect indent: find first line that starts with whitespace after a newline
    const indentMatch = raw.match(/\n([ \t]+)\S/);
    const indent = indentMatch ? indentMatch[1] : '  ';

    const keyOrder = new Map<string, string[]>();
    const minifiedPaths = new Set<string>();
    const minifiedArrayItemPaths = new Set<string>();
    const escapedSlashPaths = new Set<string>();

    this.walkRawJson(
      raw,
      keyOrder,
      minifiedPaths,
      minifiedArrayItemPaths,
      escapedSlashPaths,
    );

    return {
      indent,
      lineEnding,
      keyOrder,
      minifiedPaths,
      minifiedArrayItemPaths,
      escapedSlashPaths,
    };
  }

  /**
   * Serialize `data` to a JSON string that reproduces the formatting captured
   * in `state`: key order, minification per path, indent, line endings.
   *
   * Keys present in `data` but absent from the original key order are appended
   * at the end (handles merged/added fields).
   * Keys that were in the original but are missing in `data` are simply omitted.
   * Empty objects/arrays/strings are preserved (never skipped).
   */
  serializeWithFormatState(data: any, state: JsonFormatState): string {
    const {
      indent,
      lineEnding,
      keyOrder,
      minifiedPaths,
      minifiedArrayItemPaths,
      escapedSlashPaths,
    } = state;

    // Strip the internal `filename` key that we inject at runtime
    const cleaned = this.stripRuntimeKeys(data, ['filename']);

    const serialize = (value: any, path: string, depth: number): string => {
      if (value === null) return 'null';
      if (typeof value === 'boolean') return String(value);
      if (typeof value === 'number') return String(value);
      if (typeof value === 'string') {
        const serialized = JSON.stringify(value);
        // Re-apply escaped forward slashes if the original file used \/
        return escapedSlashPaths.has(path)
          ? serialized.replace(/\//g, '\\/')
          : serialized;
      }

      if (Array.isArray(value)) {
        return serializeArray(value, path, depth);
      }

      if (typeof value === 'object') {
        return serializeObject(value, path, depth);
      }

      return JSON.stringify(value);
    };

    const isMinified = (path: string): boolean => minifiedPaths.has(path);

    const pad = (depth: number) => indent.repeat(depth);

    const serializeObject = (obj: any, path: string, depth: number): string => {
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';

      // Reconstruct key order: original order first, then any new keys appended
      const originalOrder = keyOrder.get(path) ?? [];
      const orderedKeys: string[] = [
        ...originalOrder.filter((k) => k in obj),
        ...keys.filter((k) => !originalOrder.includes(k)),
      ];

      const entries = orderedKeys.map((key) => {
        const childPath = path ? `${path}.${key}` : key;
        const childValue = obj[key];

        if (isMinified(childPath)) {
          // Inline / minified: serialize value without extra whitespace
          const inlineValue = serializeInline(childValue);
          return `${pad(depth + 1)}${JSON.stringify(key)}: ${inlineValue}`;
        } else {
          return `${pad(depth + 1)}${JSON.stringify(key)}: ${serialize(childValue, childPath, depth + 1)}`;
        }
      });

      return (
        '{' +
        lineEnding +
        entries.join(',' + lineEnding) +
        lineEnding +
        pad(depth) +
        '}'
      );
    };

    const serializeArray = (
      arr: any[],
      path: string,
      depth: number,
    ): string => {
      if (arr.length === 0) return '[]';

      // The whole array value is minified (e.g. written as [1,2,3] on one line)
      if (isMinified(path)) {
        return serializeInline(arr);
      }

      // Each item in this array is inlined (one compact item per line).
      // This covers both the original indices AND any new indices added by merge.
      const itemsAreInlined = minifiedArrayItemPaths.has(path);

      const items = arr.map((item, idx) => {
        const childPath = `${path}.${idx}`;

        // Priority 1: this specific index was explicitly minified in the original
        // Priority 2: the parent array is known to have inlined items
        if (isMinified(childPath) || itemsAreInlined) {
          return `${pad(depth + 1)}${serializeInline(item)}`;
        }
        return `${pad(depth + 1)}${serialize(item, childPath, depth + 1)}`;
      });

      return (
        '[' +
        lineEnding +
        items.join(',' + lineEnding) +
        lineEnding +
        pad(depth) +
        ']'
      );
    };

    /**
     * Serialize a value compactly (no newlines) – used for minified paths.
     */
    const serializeInline = (value: any): string => {
      return JSON.stringify(value);
    };

    const result = serialize(cleaned, '', 0);

    // Normalise line endings
    const normalised =
      lineEnding === '\r\n'
        ? result.replace(/\r?\n/g, '\r\n')
        : result.replace(/\r\n/g, '\n');

    return normalised;
  }

  /**
   * Walk the raw JSON text using a simple character-level scanner to determine:
   * 1. The key order for every object (at any depth).
   * 2. Whether a given key's value is "minified" (no newline inside the value).
   * 3. Whether an array's items are each inlined (one compact item per line).
   *
   * We track the current "path" as a stack of keys/indices.
   */
  private walkRawJson(
    raw: string,
    keyOrder: Map<string, string[]>,
    minifiedPaths: Set<string>,
    minifiedArrayItemPaths: Set<string>,
    escapedSlashPaths: Set<string>,
  ): void {
    let i = 0;
    const pathStack: Array<string | number> = [];

    const currentPath = () => pathStack.join('.');

    const skipWhitespace = () => {
      while (i < raw.length && /\s/.test(raw[i])) i++;
    };

    const readString = (): string => {
      // i is at opening "
      i++; // skip "
      let str = '';
      while (i < raw.length) {
        const ch = raw[i];
        if (ch === '\\') {
          i += 2;
          str += '\\';
          continue;
        }
        if (ch === '"') {
          i++;
          break;
        }
        str += ch;
        i++;
      }
      return str;
    };

    /**
     * Consume one JSON value starting at position i.
     * Returns the raw text of that value (used to detect minification).
     */
    const consumeValue = (): string => {
      skipWhitespace();
      const start = i;

      if (raw[i] === '{') {
        consumeObject();
      } else if (raw[i] === '[') {
        consumeArray();
      } else if (raw[i] === '"') {
        readString();
      } else {
        // number / bool / null
        while (i < raw.length && !/[\s,\}\]]/.test(raw[i])) i++;
      }
      return raw.slice(start, i);
    };

    const consumeObject = () => {
      i++; // skip {
      skipWhitespace();

      const objPath = currentPath();
      const keys: string[] = [];

      while (i < raw.length && raw[i] !== '}') {
        skipWhitespace();
        if (raw[i] !== '"') {
          i++;
          continue;
        } // safety

        const key = readString();
        keys.push(key);

        skipWhitespace();
        if (raw[i] === ':') i++; // skip :
        skipWhitespace();

        pathStack.push(key);
        const valueRaw = consumeValue();
        pathStack.pop();

        // Minified = the entire value raw text contains no newline character
        const hasNewlineInValue =
          valueRaw.includes('\n') || valueRaw.includes('\r');
        if (!hasNewlineInValue) {
          minifiedPaths.add(currentPath() ? currentPath() + '.' + key : key);
        }

        // Detect escaped forward slashes: the raw value is a string containing \/
        const keyPath = currentPath() ? currentPath() + '.' + key : key;
        if (valueRaw.startsWith('"') && valueRaw.includes('\\/')) {
          escapedSlashPaths.add(keyPath);
        }

        skipWhitespace();
        if (raw[i] === ',') i++; // skip ,
        skipWhitespace();
      }

      if (raw[i] === '}') i++; // skip }

      if (keys.length > 0) {
        keyOrder.set(objPath, keys);
      }
    };

    const consumeArray = () => {
      i++; // skip [
      skipWhitespace();

      const arrayPath = currentPath();
      let idx = 0;
      let firstItemInlined: boolean | null = null;

      while (i < raw.length && raw[i] !== ']') {
        skipWhitespace();
        if (raw[i] === ']') break;

        pathStack.push(idx);
        const itemRaw = consumeValue();
        pathStack.pop();

        // Detect whether items are inlined: check the first item only as a sample.
        // An item is "inlined" when its raw text contains no newline.
        if (firstItemInlined === null && itemRaw.trim().length > 0) {
          firstItemInlined = !itemRaw.includes('\n') && !itemRaw.includes('\r');
        }

        idx++;
        skipWhitespace();
        if (raw[i] === ',') i++;
        skipWhitespace();
      }
      if (raw[i] === ']') i++;

      // If the first item was inlined, record the parent array path so that ALL
      // items (including newly merged ones) will be serialised inline on save.
      if (firstItemInlined === true && arrayPath !== '') {
        minifiedArrayItemPaths.add(arrayPath);
      }
    };

    consumeValue();
  }

  /**
   * Return a shallow-deep copy of `data` with the given runtime-only keys
   * removed from the top level (and recursively if needed).
   */
  private stripRuntimeKeys(data: any, keys: string[]): any {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return data;
    }
    const copy: any = {};
    for (const k of Object.keys(data)) {
      if (keys.includes(k)) continue;
      copy[k] = data[k];
    }
    return copy;
  }
}
