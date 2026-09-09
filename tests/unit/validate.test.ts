import { describe, expect, it } from 'vitest';
import {
  splitIssues,
  validateModel,
  type ValidationInput
} from '../../src/renderer/features/export/validate';
import { suggestGroupIds } from '../../src/renderer/features/config/configOps';
import type { ModelInfo, ParameterInfo } from '../../src/renderer/core/cubism/ModelInfo';

function parameter(index: number, id: string): ParameterInfo {
  return {
    index,
    id,
    name: id,
    groupId: '',
    minimum: -1,
    maximum: 1,
    default: 0,
    isBlendShape: false,
    repeats: false
  };
}

function modelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
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
    parameters: [
      parameter(0, 'ParamAngleX'),
      parameter(1, 'ParamEyeLOpen'),
      parameter(2, 'ParamEyeROpen'),
      parameter(3, 'ParamMouthOpenY')
    ],
    parts: [
      { index: 0, id: 'PartArmA', name: 'Arm A', parentIndex: -1 },
      { index: 1, id: 'PartArmB', name: 'Arm B', parentIndex: -1 }
    ],
    drawables: [
      { index: 0, id: 'ArtMesh_Head', textureIndex: 0, parentPartIndex: 0, vertexCount: 4 },
      { index: 1, id: 'ArtMesh_Body', textureIndex: 0, parentPartIndex: 1, vertexCount: 4 }
    ],
    parameterGroups: [],
    usesMasking: false,
    ...overrides
  };
}

/** A model that should validate cleanly, as the baseline for each test. */
function cleanInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    info: modelInfo(),
    model3: {
      Version: 3,
      FileReferences: { Moc: 'm.moc3', Textures: ['t.png'] },
      Groups: [
        { Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] },
        { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] }
      ],
      HitAreas: [{ Id: 'ArtMesh_Head', Name: 'Head' }]
    },
    pose: null,
    physics: null,
    cdi3: null,
    expressions: { byName: {}, files: {}, order: [] },
    textureSizes: [{ width: 2048, height: 2048 }],
    ...overrides
  };
}

describe('validateModel — model3.json', () => {
  it('passes a well-formed model', () => {
    expect(validateModel(cleanInput())).toEqual([]);
  });

  it('rejects a hit area pointing at a mesh that is not in the moc', () => {
    const input = cleanInput();
    input.model3.HitAreas = [{ Id: 'ArtMesh_Ghost', Name: 'Head' }];

    const { errors } = splitIssues(validateModel(input));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('ArtMesh_Ghost');
  });

  it('warns about a hit area with no name', () => {
    const input = cleanInput();
    input.model3.HitAreas = [{ Id: 'ArtMesh_Head', Name: '' }];

    const { warnings } = splitIssues(validateModel(input));
    expect(warnings.some((issue) => issue.message.includes('chưa có tên'))).toBe(true);
  });

  it('rejects a group referencing a parameter that is not in the moc', () => {
    const input = cleanInput();
    input.model3.Groups = [
      { Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamNope'] },
      { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] }
    ];

    const { errors } = splitIssues(validateModel(input));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('ParamNope');
  });

  it('warns when the blink and lip-sync groups are missing', () => {
    const input = cleanInput();
    input.model3.Groups = [];

    const { warnings } = splitIssues(validateModel(input));
    expect(warnings.filter((issue) => /EyeBlink|LipSync/.test(issue.message))).toHaveLength(2);
  });

  it('warns when motions exist but none are in an Idle group', () => {
    const input = cleanInput();
    input.model3.FileReferences.Motions = { TapBody: [{ File: 'a.motion3.json' }] };

    const { warnings } = splitIssues(validateModel(input));
    expect(warnings.some((issue) => issue.message.includes('Idle'))).toBe(true);
  });

  it('does not warn about Idle when there are no motions at all', () => {
    const { warnings } = splitIssues(validateModel(cleanInput()));
    expect(warnings.some((issue) => issue.message.includes('Idle'))).toBe(false);
  });

  it('rejects an expression that is not declared in model3.json', () => {
    // This is the trap the panel exists to prevent: the file is on disk and
    // looks fine, but no runtime will ever load it.
    const input = cleanInput({
      expressions: {
        byName: { smile: { Type: 'Live2D Expression', Parameters: [] } },
        files: { smile: 'smile.exp3.json' },
        order: ['smile']
      }
    });

    const { errors } = splitIssues(validateModel(input));
    expect(errors.some((issue) => issue.message.includes('chưa được khai báo'))).toBe(true);
  });
});

describe('validateModel — expressions', () => {
  const withExpression = (parameters: Array<{ Id: string; Value: number }>) =>
    cleanInput({
      model3: {
        Version: 3,
        FileReferences: {
          Moc: 'm.moc3',
          Textures: ['t.png'],
          Expressions: [{ Name: 'smile', File: 'smile.exp3.json' }]
        },
        Groups: [
          { Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen'] },
          { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] }
        ]
      },
      expressions: {
        byName: {
          smile: {
            Type: 'Live2D Expression',
            Parameters: parameters.map((entry) => ({ ...entry, Blend: 'Add' as const }))
          }
        },
        files: { smile: 'smile.exp3.json' },
        order: ['smile']
      }
    });

  it('accepts an expression whose parameters all exist', () => {
    const issues = validateModel(withExpression([{ Id: 'ParamAngleX', Value: 15 }]));
    expect(splitIssues(issues).errors).toEqual([]);
  });

  it('rejects a parameter that is not in the moc', () => {
    const { errors } = splitIssues(
      validateModel(withExpression([{ Id: 'ParamGhost', Value: 1 }]))
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('smile.exp3.json');
  });

  it('warns about an expression with no parameters', () => {
    const { warnings } = splitIssues(validateModel(withExpression([])));
    expect(warnings.some((issue) => issue.message.includes('không chứa tham số'))).toBe(true);
  });

  it('warns about a duplicated parameter', () => {
    const { warnings } = splitIssues(
      validateModel(
        withExpression([
          { Id: 'ParamAngleX', Value: 10 },
          { Id: 'ParamAngleX', Value: 20 }
        ])
      )
    );
    expect(warnings.some((issue) => issue.message.includes('trùng'))).toBe(true);
  });
});

describe('validateModel — pose', () => {
  it('rejects a part that is in two groups at once', () => {
    const input = cleanInput({
      pose: {
        Type: 'Live2D Pose',
        Groups: [
          [
            { Id: 'PartArmA', Link: [] },
            { Id: 'PartArmB', Link: [] }
          ],
          [
            { Id: 'PartArmA', Link: [] },
            { Id: 'PartArmB', Link: [] }
          ]
        ]
      }
    });

    const { errors } = splitIssues(validateModel(input));
    // Both parts are double-claimed, so both are reported.
    expect(errors.filter((issue) => issue.message.includes('nhiều nhóm'))).toHaveLength(2);
  });

  it('warns about a group with only one member', () => {
    const input = cleanInput({
      pose: { Type: 'Live2D Pose', Groups: [[{ Id: 'PartArmA', Link: [] }]] }
    });

    const { warnings } = splitIssues(validateModel(input));
    expect(warnings.some((issue) => issue.message.includes('chỉ có 1 part'))).toBe(true);
  });

  it('rejects a part that is not in the moc', () => {
    const input = cleanInput({
      pose: {
        Type: 'Live2D Pose',
        Groups: [
          [
            { Id: 'PartGhost', Link: [] },
            { Id: 'PartArmB', Link: [] }
          ]
        ]
      }
    });

    const { errors } = splitIssues(validateModel(input));
    expect(errors.some((issue) => issue.message.includes('PartGhost'))).toBe(true);
  });
});

describe('validateModel — physics meta counts', () => {
  const physicsWith = (metaOverrides: Record<string, number>) => ({
    Version: 3,
    Meta: {
      PhysicsSettingCount: 1,
      TotalInputCount: 1,
      TotalOutputCount: 1,
      VertexCount: 2,
      Fps: 30,
      EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
      PhysicsDictionary: [{ Id: 'PhysicsSetting1', Name: 'Hair' }],
      ...metaOverrides
    },
    PhysicsSettings: [
      {
        Id: 'PhysicsSetting1',
        Input: [
          {
            Source: { Target: 'Parameter' as const, Id: 'ParamAngleX' },
            Weight: 60,
            Type: 'X' as const,
            Reflect: false
          }
        ],
        Output: [
          {
            Destination: { Target: 'Parameter' as const, Id: 'ParamAngleX' },
            VertexIndex: 1,
            Scale: 1,
            Weight: 100,
            Type: 'Angle' as const,
            Reflect: false
          }
        ],
        Vertices: [
          { Position: { X: 0, Y: 0 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 0 },
          { Position: { X: 0, Y: -1 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 1 }
        ],
        Normalization: {
          Position: { Minimum: -10, Default: 0, Maximum: 10 },
          Angle: { Minimum: -10, Default: 0, Maximum: 10 }
        }
      }
    ]
  });

  it('accepts physics whose meta counts match the data', () => {
    const issues = validateModel(cleanInput({ physics: physicsWith({}) }));
    expect(splitIssues(issues).errors).toEqual([]);
  });

  it('rejects a wrong input count, because some loaders crash on it', () => {
    const { errors } = splitIssues(
      validateModel(cleanInput({ physics: physicsWith({ TotalInputCount: 5 }) }))
    );
    expect(errors.some((issue) => issue.message.includes('TotalInputCount'))).toBe(true);
  });

  it('rejects a wrong vertex count', () => {
    const { errors } = splitIssues(
      validateModel(cleanInput({ physics: physicsWith({ VertexCount: 9 }) }))
    );
    expect(errors.some((issue) => issue.message.includes('VertexCount'))).toBe(true);
  });

  it('rejects an output whose VertexIndex is past the end of the chain', () => {
    const physics = physicsWith({});
    physics.PhysicsSettings[0].Output[0].VertexIndex = 7;

    const { errors } = splitIssues(validateModel(cleanInput({ physics })));
    expect(errors.some((issue) => issue.message.includes('VertexIndex'))).toBe(true);
  });

  it('warns when Fps is unset, since behaviour then varies by runtime', () => {
    const physics = physicsWith({});
    delete (physics.Meta as { Fps?: number }).Fps;

    const { warnings } = splitIssues(validateModel(cleanInput({ physics })));
    expect(warnings.some((issue) => issue.message.includes('Fps'))).toBe(true);
  });
});

describe('validateModel — textures', () => {
  it('warns about non-power-of-two textures', () => {
    const { warnings } = splitIssues(
      validateModel(cleanInput({ textureSizes: [{ width: 2976, height: 4175 }] }))
    );
    expect(warnings.some((issue) => issue.message.includes('luỹ thừa của 2'))).toBe(true);
  });

  it('accepts power-of-two textures', () => {
    const { warnings } = splitIssues(
      validateModel(cleanInput({ textureSizes: [{ width: 1024, height: 2048 }] }))
    );
    expect(warnings.some((issue) => issue.message.includes('luỹ thừa'))).toBe(false);
  });
});

describe('suggestGroupIds', () => {
  it('picks the standard blink and mouth parameters when present', () => {
    expect(suggestGroupIds(modelInfo())).toEqual({
      eyeBlink: ['ParamEyeLOpen', 'ParamEyeROpen'],
      lipSync: ['ParamMouthOpenY']
    });
  });

  it('falls back to name matching for non-standard ids', () => {
    const info = modelInfo({
      parameters: [
        parameter(0, 'CustomEyeOpenLeft'),
        parameter(1, 'CustomEyeOpenRight'),
        parameter(2, 'CustomEyeBallX'),
        parameter(3, 'CustomMouthOpen')
      ]
    });

    expect(suggestGroupIds(info)).toEqual({
      eyeBlink: ['CustomEyeOpenLeft', 'CustomEyeOpenRight'],
      lipSync: ['CustomMouthOpen']
    });
  });

  it('excludes eye-ball and mouth-form parameters from the fallback', () => {
    // Driving MouthForm from audio volume would distort the mouth shape rather
    // than open it, and EyeBall is gaze direction, not blinking.
    const info = modelInfo({
      parameters: [
        parameter(0, 'MyEyeBallOpenX'),
        parameter(1, 'MyMouthFormOpen'),
        parameter(2, 'MyEyeOpen'),
        parameter(3, 'MyMouthOpen')
      ]
    });

    const result = suggestGroupIds(info);
    expect(result.eyeBlink).toEqual(['MyEyeOpen']);
    expect(result.lipSync).toEqual(['MyMouthOpen']);
  });

  it('suggests nothing when no parameter looks relevant', () => {
    const info = modelInfo({ parameters: [parameter(0, 'ParamAngleX')] });
    expect(suggestGroupIds(info)).toEqual({ eyeBlink: [], lipSync: [] });
  });
});
