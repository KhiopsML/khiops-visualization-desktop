/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck

import { TestBed } from '@angular/core/testing';
import { JsonFormatterService, JsonFormatState } from './json-formatter.service';

describe('JsonFormatterService', () => {
  let service: JsonFormatterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [JsonFormatterService],
    });
    service = TestBed.inject(JsonFormatterService);
  });

  /**
   * Test 1: Detect Unix line endings (\n)
   */
  it('should detect Unix line endings correctly', () => {
    const jsonWithUnixEndings = `{
  "name": "test",
  "value": 42
}`;

    const result = service.analyzeJsonFormat(jsonWithUnixEndings);

    expect(result.lineEnding).toBe('\n');
  });

  /**
   * Test 2: Detect Windows line endings (\r\n)
   */
  it('should detect Windows line endings correctly', () => {
    const jsonWithWindowsEndings = `{\r\n  "name": "test",\r\n  "value": 42\r\n}`;

    const result = service.analyzeJsonFormat(jsonWithWindowsEndings);

    expect(result.lineEnding).toBe('\r\n');
  });

  /**
   * Test 3: Detect 2-space indentation
   */
  it('should detect 2-space indentation', () => {
    const jsonWith2Spaces = `{
  "key": "value"
}`;

    const result = service.analyzeJsonFormat(jsonWith2Spaces);

    expect(result.indent).toBe('  ');
  });

  /**
   * Test 4: Detect 4-space indentation
   */
  it('should detect 4-space indentation', () => {
    const jsonWith4Spaces = `{
    "key": "value"
}`;

    const result = service.analyzeJsonFormat(jsonWith4Spaces);

    expect(result.indent).toBe('    ');
  });

  /**
   * Test 5: Preserve key ordering at root level
   */
  it('should preserve key ordering at root level', () => {
    const json = `{
  "zebra": 1,
  "apple": 2,
  "banana": 3
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.keyOrder.get('')).toEqual(['zebra', 'apple', 'banana']);
  });

  /**
   * Test 6: Detect minified paths (values on single line)
   */
  it('should detect minified paths correctly', () => {
    const json = `{
  "minified": {"nested": "value"},
  "expanded": {
    "nested": "value"
  }
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.minifiedPaths.has('minified')).toBe(true);
    expect(result.minifiedPaths.has('expanded')).toBe(false);
  });

  /**
   * Test 7: Detect minified array items (each item on single line)
   */
  it('should detect minified array items', () => {
    const json = `{
  "numbers": [1, 2, 3],
  "objects": [
    {"id": 1},
    {"id": 2}
  ]
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.minifiedArrayItemPaths.has('numbers')).toBe(true);
    expect(result.minifiedArrayItemPaths.has('objects')).toBe(true);
  });

  /**
   * Test 8: Detect escaped forward slashes in strings
   */
  it('should detect escaped forward slashes in string values', () => {
    const json = `{
  "url": "https:\\/\\/example.com",
  "normal": "test"
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.escapedSlashPaths.has('url')).toBe(true);
    expect(result.escapedSlashPaths.has('normal')).toBe(false);
  });

  /**
   * Test 9: Serialization preserves format state (key order, indentation, line endings)
   */
  it('should serialize data while preserving original format state', () => {
    const originalJson = `{
  "zebra": 1,
  "apple": 2,
  "nested": {
    "x": 10,
    "y": 20
  }
}`;

    const formatState = service.analyzeJsonFormat(originalJson);

    // Update only one field, keep others
    const updatedData = {
      zebra: 1,
      apple: 2,
      nested: {
        x: 10,
        y: 20,
      },
    };

    const serialized = service.serializeWithFormatState(updatedData, formatState);

    // Verify key order is preserved
    expect(serialized.indexOf('zebra')).toBeLessThan(serialized.indexOf('apple'));
    expect(serialized.indexOf('apple')).toBeLessThan(serialized.indexOf('nested'));

    // Verify indentation is preserved
    expect(serialized).toContain('  "');
  });

  /**
   * Test 10: Serialization handles new keys (appends at end) and preserves minified paths
   */
  it('should append new keys at the end while preserving minified path formatting', () => {
    const originalJson = `{
  "first": {"nested": "value"},
  "second": 2
}`;

    const formatState = service.analyzeJsonFormat(originalJson);

    // Add a new key not in the original
    const updatedData = {
      first: { nested: 'value' },
      second: 2,
      third: 3,
    };

    const serialized = service.serializeWithFormatState(updatedData, formatState);
    const parsed = JSON.parse(serialized);

    // Verify that the "first" object is still minified (single line)
    expect(serialized.match(/"first":\s*{[^}]*}/)[0]).not.toContain('\n');

    // Verify all keys are present
    expect(parsed).toEqual(updatedData);

    // Verify order: original keys first, then new keys
    const keys = Object.keys(parsed);
    expect(keys).toEqual(['first', 'second', 'third']);
  });
});
