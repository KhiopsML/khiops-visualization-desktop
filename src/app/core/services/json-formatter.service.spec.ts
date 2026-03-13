/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck

import { TestBed } from '@angular/core/testing';
import {
  JsonFormatterService,
  JsonFormatState,
} from './json-formatter.service';

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

    const serialized = service.serializeWithFormatState(
      updatedData,
      formatState,
    );

    // Verify key order is preserved
    expect(serialized.indexOf('zebra')).toBeLessThan(
      serialized.indexOf('apple'),
    );
    expect(serialized.indexOf('apple')).toBeLessThan(
      serialized.indexOf('nested'),
    );

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

    const serialized = service.serializeWithFormatState(
      updatedData,
      formatState,
    );
    const parsed = JSON.parse(serialized);

    // Verify that the "first" object is still minified (single line)
    expect(serialized.match(/"first":\s*{[^}]*}/)[0]).not.toContain('\n');

    // Verify all keys are present
    expect(parsed).toEqual(updatedData);

    // Verify order: original keys first, then new keys
    const keys = Object.keys(parsed);
    expect(keys).toEqual(['first', 'second', 'third']);
  });

  /**
   * Test 11: Handle deeply nested objects with mixed formatting
   */
  it('should handle deeply nested objects with mixed formatting', () => {
    const json = `{
  "level1": {
    "level2": {"level3": {"value": 42}},
    "expanded": {
      "nested": {
        "deep": "data"
      }
    }
  }
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.keyOrder.get('level1')).toEqual(['level2', 'expanded']);
    expect(result.keyOrder.get('level1.level2')).toEqual(['level3']);
    expect(result.minifiedPaths.has('level1.level2')).toBe(true);
  });

  /**
   * Test 12: Handle null values
   */
  it('should serialize null values correctly', () => {
    const originalJson = `{
  "nullValue": null,
  "stringValue": "test"
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = { nullValue: null, stringValue: 'test' };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.nullValue).toBeNull();
    expect(parsed.stringValue).toBe('test');
  });

  /**
   * Test 13: Preserve empty objects
   */
  it('should preserve empty objects in the output', () => {
    const originalJson = `{
  "empty": {},
  "notEmpty": {"key": "value"}
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = { empty: {}, notEmpty: { key: 'value' } };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.empty).toEqual({});
    expect(Object.keys(parsed.empty).length).toBe(0);
  });

  /**
   * Test 14: Preserve empty arrays
   */
  it('should preserve empty arrays in the output', () => {
    const originalJson = `{
  "emptyArray": [],
  "filledArray": [1, 2]
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = { emptyArray: [], filledArray: [1, 2] };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(Array.isArray(parsed.emptyArray)).toBe(true);
    expect(parsed.emptyArray.length).toBe(0);
  });

  /**
   * Test 15: Detect tab indentation
   */
  it('should detect tab indentation', () => {
    const jsonWithTabs = `{\n\t"key": "value"\n}`;

    const result = service.analyzeJsonFormat(jsonWithTabs);

    expect(result.indent).toBe('\t');
  });

  /**
   * Test 16: Handle mixed types in arrays
   */
  it('should detect minified arrays with mixed types', () => {
    const json = `{
  "mixed": [1, "string", true, null, {"obj": "value"}]
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.minifiedArrayItemPaths.has('mixed')).toBe(true);
  });

  /**
   * Test 17: Preserve key order in nested objects
   */
  it('should preserve key order at all nesting levels', () => {
    const json = `{
  "z": 1,
  "a": {
    "z": 2,
    "b": {
      "z": 3,
      "a": 4
    }
  }
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.keyOrder.get('')).toEqual(['z', 'a']);
    expect(result.keyOrder.get('a')).toEqual(['z', 'b']);
    expect(result.keyOrder.get('a.b')).toEqual(['z', 'a']);
  });

  /**
   * Test 18: Handle strings with special characters
   */
  it('should preserve strings with special characters', () => {
    const originalJson = `{
  "special": "!@#$%^&*()",
  "quotes": "\\"quoted\\"",
  "newline": "line1\\nline2"
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = {
      special: '!@#$%^&*()',
      quotes: '"quoted"',
      newline: 'line1\nline2',
    };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.special).toBe('!@#$%^&*()');
    expect(parsed.quotes).toBe('"quoted"');
  });

  /**
   * Test 19: Handle very large numeric values
   */
  it('should handle large numeric values', () => {
    const originalJson = `{
  "largeInt": 9007199254740991,
  "decimal": 3.14159265359
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = {
      largeInt: 9007199254740991,
      decimal: 3.14159265359,
    };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.largeInt).toBe(9007199254740991);
    expect(parsed.decimal).toBeCloseTo(3.14159265359, 5);
  });

  /**
   * Test 20: Handle boolean values mixed with other types
   */
  it('should correctly serialize boolean values', () => {
    const originalJson = `{
  "true": true,
  "false": false,
  "string": "true"
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = { true: true, false: false, string: 'true' };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.true).toBe(true);
    expect(parsed.false).toBe(false);
    expect(parsed.string).toBe('true');
  });

  /**
   * Test 21: Multiple minified paths in same object
   */
  it('should handle multiple minified paths in the same object', () => {
    const json = `{
  "min1": {"a": 1},
  "min2": [1, 2],
  "expanded": {
    "nested": {
      "value": 1
    }
  }
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.minifiedPaths.has('min1')).toBe(true);
    expect(result.minifiedPaths.has('min2')).toBe(true);
    expect(result.minifiedPaths.has('expanded')).toBe(false);
  });

  /**
   * Test 22: Handle stripped runtime keys
   */
  it('should strip runtime keys during serialization', () => {
    const originalJson = `{
  "data": "value"
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = { data: 'value', filename: 'should-be-stripped.json' };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.data).toBe('value');
    expect(parsed.filename).toBeUndefined();
  });

  /**
   * Test 23: Array with objects, some minified
   */
  it('should detect minified arrays containing objects', () => {
    const json = `{
  "items": [{"id": 1}, {"id": 2}, {"id": 3}]
}`;

    const result = service.analyzeJsonFormat(json);

    expect(result.minifiedArrayItemPaths.has('items')).toBe(true);
  });

  /**
   * Test 24: Complex nested structure with arrays
   */
  it('should handle complex structures with nested arrays', () => {
    const json = `{
  "matrix": [
    [1, 2, 3],
    [4, 5, 6]
  ]
}`;

    const result = service.analyzeJsonFormat(json);

    // The outer array items are minified (single line each)
    expect(result.minifiedArrayItemPaths.has('matrix')).toBe(true);
  });

  /**
   * Test 25: Unicode characters in strings
   */
  it('should preserve unicode characters', () => {
    const originalJson = `{
  "emoji": "😀😃😄",
  "chinese": "你好",
  "arabic": "مرحبا"
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = {
      emoji: '😀😃😄',
      chinese: '你好',
      arabic: 'مرحبا',
    };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.emoji).toBe('😀😃😄');
    expect(parsed.chinese).toBe('你好');
  });

  /**
   * Test 26: Zero and negative numbers
   */
  it('should handle zero and negative numbers', () => {
    const originalJson = `{
  "zero": 0,
  "negative": -42,
  "negativeDecimal": -3.14
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = { zero: 0, negative: -42, negativeDecimal: -3.14 };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.zero).toBe(0);
    expect(parsed.negative).toBe(-42);
    expect(parsed.negativeDecimal).toBe(-3.14);
  });

  /**
   * Test 27: Serialization with partial data update
   */
  it('should correctly update partial data while preserving format', () => {
    const originalJson = `{
  "a": {"nested": "value1"},
  "b": 2,
  "c": [1, 2, 3]
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const updatedData = {
      a: { nested: 'value2' }, // Modified
      b: 2,
      c: [1, 2, 3, 4, 5], // Extended array
    };

    const serialized = service.serializeWithFormatState(
      updatedData,
      formatState,
    );
    const parsed = JSON.parse(serialized);

    expect(parsed.a.nested).toBe('value2');
    expect(parsed.c).toEqual([1, 2, 3, 4, 5]);
  });

  /**
   * Test 28: Key order preserved after removing and re-adding keys
   */
  it('should maintain key order even after removing keys', () => {
    const originalJson = `{
  "z": 1,
  "a": 2,
  "m": 3
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const updatedData = { z: 1, m: 3 }; // 'a' is removed

    const serialized = service.serializeWithFormatState(
      updatedData,
      formatState,
    );
    const parsed = JSON.parse(serialized);
    const keys = Object.keys(parsed);

    // Order should be preserved from original, but 'a' is missing
    expect(keys).toEqual(['z', 'm']);
  });

  /**
   * Test 29: Empty string values
   */
  it('should preserve empty string values', () => {
    const originalJson = `{
  "empty": "",
  "notEmpty": "text"
}`;

    const formatState = service.analyzeJsonFormat(originalJson);
    const data = { empty: '', notEmpty: 'text' };

    const serialized = service.serializeWithFormatState(data, formatState);
    const parsed = JSON.parse(serialized);

    expect(parsed.empty).toBe('');
    expect(parsed.empty.length).toBe(0);
  });

  /**
   * Test 30: Complex mixed format with all data types
   */
  it('should handle complex structures with all data types mixed', () => {
    const json = `{
  "string": "value",
  "number": 42,
  "boolean": true,
  "null": null,
  "array": [1, 2, 3],
  "object": {"nested": "value"},
  "emptyArray": [],
  "emptyObject": {}
}`;

    const result = service.analyzeJsonFormat(json);
    const data = {
      string: 'value',
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      object: { nested: 'value' },
      emptyArray: [],
      emptyObject: {},
    };

    const serialized = service.serializeWithFormatState(data, result);
    const parsed = JSON.parse(serialized);

    expect(parsed.string).toBe('value');
    expect(parsed.number).toBe(42);
    expect(parsed.boolean).toBe(true);
    expect(parsed.null).toBeNull();
    expect(parsed.array).toEqual([1, 2, 3]);
    expect(parsed.object.nested).toBe('value');
    expect(parsed.emptyArray.length).toBe(0);
    expect(Object.keys(parsed.emptyObject).length).toBe(0);
  });
});
