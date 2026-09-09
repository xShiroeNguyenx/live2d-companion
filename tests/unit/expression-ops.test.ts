import { describe, expect, it } from 'vitest';
import {
  captureExpression,
  findExpressionConflicts,
  proposeExpressionName
} from '../../src/renderer/features/expressions/expressionOps';
import type { ModelInfo, ParameterInfo } from '../../src/renderer/core/cubism/ModelInfo';
import type { ExpressionSet } from '../../src/renderer/document/stores/documentStores';

function parameter(
  index: number,
  id: string,
  defaultValue: number,
  min = -1,
  max = 1
): ParameterInfo {
  return {
    index,
    id,
    name: id,
    groupId: '',
    minimum: min,
    maximum: max,
    default: defaultValue,
    isBlendShape: false,
    repeats: false
  };
}

function modelInfo(parameters: ParameterInfo[]): ModelInfo {
  return {
    mocVersion: 3,
    latestSupportedMocVersion: 6,
    canvas: {
      widthPixel: 2048,
      heightPixel: 2048,
      originX: 1024,
      originY: 1024,
      pixelsPerUnit: 1024,
      widthUnit: 2,
      heightUnit: 2
    },
    parameters,
    parts: [],
    drawables: [],
    parameterGroups: [],
    usesMasking: false
  };
}

describe('captureExpression', () => {
  it('records only parameters that moved, as offsets from default', () => {
    const info = modelInfo([
      parameter(0, 'ParamAngleX', 0),
      parameter(1, 'ParamEyeLOpen', 1, 0, 1),
      parameter(2, 'ParamMouthOpenY', 0, 0, 1)
    ]);
    // Angle unchanged, eye closed, mouth opened halfway.
    const values = new Float32Array([0, 0, 0.5]);

    const expression = captureExpression({ values, info });

    expect(expression.Type).toBe('Live2D Expression');
    expect(expression.Parameters).toEqual([
      { Id: 'ParamEyeLOpen', Value: -1, Blend: 'Add' },
      { Id: 'ParamMouthOpenY', Value: 0.5, Blend: 'Add' }
    ]);
  });

  it('ignores float noise below the capture threshold', () => {
    const info = modelInfo([parameter(0, 'ParamAngleX', 0)]);
    const expression = captureExpression({ values: new Float32Array([1e-6]), info });
    expect(expression.Parameters).toHaveLength(0);
  });

  it('rounds values so the written JSON stays readable', () => {
    const info = modelInfo([parameter(0, 'ParamAngleX', 0, -30, 30)]);
    const expression = captureExpression({
      values: new Float32Array([12.3456789]),
      info
    });
    expect(expression.Parameters[0].Value).toBe(12.3457);
  });

  it('produces an empty expression for an untouched model', () => {
    const info = modelInfo([parameter(0, 'ParamAngleX', 5), parameter(1, 'ParamAngleY', -3)]);
    const expression = captureExpression({ values: new Float32Array([5, -3]), info });
    expect(expression.Parameters).toHaveLength(0);
  });
});

describe('proposeExpressionName', () => {
  const emptySet: ExpressionSet = { byName: {}, files: {}, order: [] };

  it('uses the plain base name when nothing is taken', () => {
    expect(proposeExpressionName(emptySet, 'smile')).toEqual({
      name: 'smile',
      fileName: 'smile.exp3.json'
    });
  });

  it('suffixes until it finds a free name', () => {
    const set: ExpressionSet = {
      byName: { smile: { Type: 'Live2D Expression', Parameters: [] } },
      files: { smile: 'expressions/smile.exp3.json' },
      order: ['smile']
    };
    expect(proposeExpressionName(set, 'smile').name).toBe('smile_2');
  });

  it('avoids a filename collision even when the name itself is free', () => {
    // A file can exist under a different expression name; the new file must
    // still not overwrite it.
    const set: ExpressionSet = {
      byName: { happy: { Type: 'Live2D Expression', Parameters: [] } },
      files: { happy: 'smile.exp3.json' },
      order: ['happy']
    };
    expect(proposeExpressionName(set, 'smile').fileName).toBe('smile_2.exp3.json');
  });
});

describe('findExpressionConflicts', () => {
  const set: ExpressionSet = {
    byName: {
      smile: {
        Type: 'Live2D Expression',
        Parameters: [
          { Id: 'ParamMouthForm', Value: 1, Blend: 'Add' },
          { Id: 'ParamEyeLSmile', Value: 1, Blend: 'Add' }
        ]
      },
      angry: {
        Type: 'Live2D Expression',
        Parameters: [
          { Id: 'ParamMouthForm', Value: -1, Blend: 'Add' },
          { Id: 'ParamBrowLY', Value: -1, Blend: 'Add' }
        ]
      },
      blink: {
        Type: 'Live2D Expression',
        Parameters: [{ Id: 'ParamEyeLOpen', Value: -1, Blend: 'Add' }]
      }
    },
    files: {},
    order: ['smile', 'angry', 'blink']
  };

  it('reports a parameter two active expressions both drive', () => {
    const conflicts = findExpressionConflicts(set, ['smile', 'angry']);
    expect([...conflicts.keys()]).toEqual(['ParamMouthForm']);
    expect(conflicts.get('ParamMouthForm')).toEqual(['smile', 'angry']);
  });

  it('reports nothing when active expressions are disjoint', () => {
    expect(findExpressionConflicts(set, ['smile', 'blink']).size).toBe(0);
  });

  it('reports nothing for a single active expression', () => {
    expect(findExpressionConflicts(set, ['smile']).size).toBe(0);
  });

  it('ignores names that are not in the set', () => {
    expect(findExpressionConflicts(set, ['smile', 'missing']).size).toBe(0);
  });
});
