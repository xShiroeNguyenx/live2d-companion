import type {
  Cdi3Json,
  Exp3Json,
  Model3Json,
  Physics3Json,
  Pose3Json
} from '@shared/types/live2d-files';
import type { ModelInfo } from '../../core/cubism/ModelInfo';
import type { ExpressionSet } from '../../document/stores/documentStores';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  /** Which document the issue is in, e.g. "model3.json" or an expression name. */
  source: string;
  message: string;
  /** What the user should do about it, when that is not obvious. */
  hint?: string;
}

export interface ValidationInput {
  info: ModelInfo;
  model3: Model3Json;
  pose: Pose3Json | null;
  physics: Physics3Json | null;
  cdi3: Cdi3Json | null;
  expressions: ExpressionSet;
  /** Texture sizes read at load, for the power-of-two warning. */
  textureSizes: Array<{ width: number; height: number }>;
}

/**
 * Checks a model against its own moc before export.
 *
 * The whole class of bug this catches: JSON can name a parameter or part that
 * does not exist in the compiled moc, and nothing complains — the runtime
 * silently ignores it, so an expression the user carefully built simply does
 * nothing in VTube Studio. Only the moc can settle whether an id is real, which
 * is why validation lives here rather than in a JSON schema.
 */
export function validateModel(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parameterIds = new Set(input.info.parameters.map((parameter) => parameter.id));
  const partIds = new Set(input.info.parts.map((part) => part.id));
  const drawableIds = new Set(input.info.drawables.map((drawable) => drawable.id));

  validateModel3(input, issues, parameterIds, drawableIds);
  validateExpressions(input, issues, parameterIds);
  validatePose(input, issues, partIds);
  validatePhysics(input, issues, parameterIds);
  validateCdi3(input, issues, parameterIds, partIds);
  validateTextures(input, issues);

  return issues;
}

function validateModel3(
  input: ValidationInput,
  issues: ValidationIssue[],
  parameterIds: Set<string>,
  drawableIds: Set<string>
): void {
  const source = 'model3.json';
  const refs = input.model3.FileReferences;

  if (!refs.Moc) {
    issues.push({ severity: 'error', source, message: 'Thiếu tham chiếu tới file .moc3.' });
  }
  if (refs.Textures.length === 0) {
    issues.push({ severity: 'error', source, message: 'Không có texture nào được khai báo.' });
  }

  for (const [index, area] of (input.model3.HitAreas ?? []).entries()) {
    if (!drawableIds.has(area.Id)) {
      issues.push({
        severity: 'error',
        source,
        message: `Vùng chạm "${area.Name || index}" trỏ tới mesh không tồn tại: ${area.Id}`,
        hint: 'Xoá vùng chạm này rồi chọn lại mesh bằng cách bấm lên model.'
      });
    }
    if (!area.Name) {
      issues.push({
        severity: 'warning',
        source,
        message: `Vùng chạm thứ ${index + 1} chưa có tên.`,
        hint: 'Runtime dùng tên này để phân biệt vùng nào được bấm.'
      });
    }
  }

  for (const group of input.model3.Groups ?? []) {
    for (const id of group.Ids) {
      if (group.Target === 'Parameter' && !parameterIds.has(id)) {
        issues.push({
          severity: 'error',
          source,
          message: `Nhóm ${group.Name} chứa tham số không tồn tại: ${id}`
        });
      }
    }
  }

  if (!(input.model3.Groups ?? []).some((group) => group.Name === 'EyeBlink')) {
    issues.push({
      severity: 'warning',
      source,
      message: 'Chưa cấu hình nhóm EyeBlink.',
      hint: 'Không có nhóm này thì model sẽ không tự nháy mắt.'
    });
  }
  if (!(input.model3.Groups ?? []).some((group) => group.Name === 'LipSync')) {
    issues.push({
      severity: 'warning',
      source,
      message: 'Chưa cấu hình nhóm LipSync.',
      hint: 'Không có nhóm này thì miệng không mấp máy theo tiếng.'
    });
  }

  // Companion apps and pixi-live2d-display auto-play the "Idle" group; without
  // it a model just stands still.
  const motionGroups = Object.keys(refs.Motions ?? {});
  if (motionGroups.length > 0 && !motionGroups.includes('Idle')) {
    issues.push({
      severity: 'warning',
      source,
      message: 'Có motion nhưng không có nhóm "Idle".',
      hint: 'Companion app và VTube Studio tự phát nhóm Idle; thiếu nó model sẽ đứng yên.'
    });
  }

  // Every expression the user created must be listed here, or other runtimes
  // will never see it.
  const listed = new Set((refs.Expressions ?? []).map((entry) => entry.Name));
  for (const name of input.expressions.order) {
    if (!listed.has(name)) {
      issues.push({
        severity: 'error',
        source,
        message: `Biểu cảm "${name}" chưa được khai báo trong model3.json.`,
        hint: 'Runtime khác sẽ không thấy biểu cảm này.'
      });
    }
  }
}

function validateExpressions(
  input: ValidationInput,
  issues: ValidationIssue[],
  parameterIds: Set<string>
): void {
  for (const name of input.expressions.order) {
    const expression: Exp3Json | undefined = input.expressions.byName[name];
    const source = `${name}.exp3.json`;
    if (!expression) continue;

    if (expression.Parameters.length === 0) {
      issues.push({
        severity: 'warning',
        source,
        message: 'Biểu cảm không chứa tham số nào — sẽ không có tác dụng gì.'
      });
    }

    const seen = new Set<string>();
    for (const parameter of expression.Parameters) {
      if (!parameterIds.has(parameter.Id)) {
        issues.push({
          severity: 'error',
          source,
          message: `Tham số không tồn tại trong moc: ${parameter.Id}`,
          hint: 'Runtime sẽ bỏ qua dòng này mà không báo lỗi.'
        });
      }
      if (seen.has(parameter.Id)) {
        issues.push({
          severity: 'warning',
          source,
          message: `Tham số bị khai báo trùng: ${parameter.Id}`
        });
      }
      seen.add(parameter.Id);

      if (!Number.isFinite(parameter.Value)) {
        issues.push({
          severity: 'error',
          source,
          message: `Giá trị không hợp lệ cho ${parameter.Id}.`
        });
      }
    }
  }
}

function validatePose(
  input: ValidationInput,
  issues: ValidationIssue[],
  partIds: Set<string>
): void {
  if (!input.pose) return;
  const source = 'pose3.json';

  for (const [index, group] of input.pose.Groups.entries()) {
    if (group.length < 2) {
      issues.push({
        severity: 'warning',
        source,
        message: `Nhóm ${index + 1} chỉ có ${group.length} part.`,
        hint: 'Một nhóm bật/tắt cần ít nhất 2 part để có gì mà chuyển.'
      });
    }
    for (const member of group) {
      if (!partIds.has(member.Id)) {
        issues.push({
          severity: 'error',
          source,
          message: `Nhóm ${index + 1} chứa part không tồn tại: ${member.Id}`
        });
      }
      for (const link of member.Link) {
        if (!partIds.has(link)) {
          issues.push({
            severity: 'error',
            source,
            message: `Part liên kết không tồn tại: ${link}`
          });
        }
      }
    }
  }

  // A part in two groups means two groups fight over its opacity.
  const owners = new Map<string, number[]>();
  for (const [index, group] of input.pose.Groups.entries()) {
    for (const member of group) {
      for (const id of [member.Id, ...member.Link]) {
        const list = owners.get(id);
        if (list) list.push(index + 1);
        else owners.set(id, [index + 1]);
      }
    }
  }
  for (const [id, groupNumbers] of owners) {
    if (groupNumbers.length > 1) {
      issues.push({
        severity: 'error',
        source,
        message: `Part ${id} thuộc nhiều nhóm (${groupNumbers.join(', ')}).`,
        hint: 'Các nhóm sẽ tranh nhau điều khiển độ mờ của part này.'
      });
    }
  }
}

function validatePhysics(
  input: ValidationInput,
  issues: ValidationIssue[],
  parameterIds: Set<string>
): void {
  if (!input.physics) return;
  const source = 'physics3.json';
  const physics = input.physics;

  let inputCount = 0;
  let outputCount = 0;
  let vertexCount = 0;

  for (const [index, setting] of physics.PhysicsSettings.entries()) {
    inputCount += setting.Input.length;
    outputCount += setting.Output.length;
    vertexCount += setting.Vertices.length;

    for (const entry of setting.Input) {
      if (!parameterIds.has(entry.Source.Id)) {
        issues.push({
          severity: 'error',
          source,
          message: `Chain ${index + 1}: tham số nguồn không tồn tại: ${entry.Source.Id}`
        });
      }
    }
    for (const entry of setting.Output) {
      if (!parameterIds.has(entry.Destination.Id)) {
        issues.push({
          severity: 'error',
          source,
          message: `Chain ${index + 1}: tham số đích không tồn tại: ${entry.Destination.Id}`
        });
      }
      if (entry.VertexIndex >= setting.Vertices.length) {
        issues.push({
          severity: 'error',
          source,
          message: `Chain ${index + 1}: VertexIndex ${entry.VertexIndex} vượt quá số đốt (${setting.Vertices.length}).`
        });
      }
    }
  }

  // Wrong Meta counts crash some third-party loaders outright, so these are
  // errors rather than warnings.
  const meta = physics.Meta;
  if (meta.PhysicsSettingCount !== physics.PhysicsSettings.length) {
    issues.push({
      severity: 'error',
      source,
      message: `Meta.PhysicsSettingCount (${meta.PhysicsSettingCount}) khác số chain thật (${physics.PhysicsSettings.length}).`,
      hint: 'Một số loader sẽ crash khi đọc file này.'
    });
  }
  if (meta.TotalInputCount !== inputCount) {
    issues.push({
      severity: 'error',
      source,
      message: `Meta.TotalInputCount (${meta.TotalInputCount}) khác thực tế (${inputCount}).`
    });
  }
  if (meta.TotalOutputCount !== outputCount) {
    issues.push({
      severity: 'error',
      source,
      message: `Meta.TotalOutputCount (${meta.TotalOutputCount}) khác thực tế (${outputCount}).`
    });
  }
  if (meta.VertexCount !== vertexCount) {
    issues.push({
      severity: 'error',
      source,
      message: `Meta.VertexCount (${meta.VertexCount}) khác thực tế (${vertexCount}).`
    });
  }
  if (meta.Fps === undefined) {
    issues.push({
      severity: 'warning',
      source,
      message: 'Meta.Fps chưa được đặt.',
      hint: 'Không có Fps, physics chạy khác nhau giữa các runtime và tốc độ khung hình.'
    });
  }
}

function validateCdi3(
  input: ValidationInput,
  issues: ValidationIssue[],
  parameterIds: Set<string>,
  partIds: Set<string>
): void {
  if (!input.cdi3) return;
  const source = 'cdi3.json';

  for (const entry of input.cdi3.Parameters) {
    if (!parameterIds.has(entry.Id)) {
      issues.push({
        severity: 'warning',
        source,
        message: `Tên hiển thị cho tham số không tồn tại: ${entry.Id}`,
        hint: 'Không gây lỗi, chỉ là dữ liệu thừa.'
      });
    }
  }
  for (const entry of input.cdi3.Parts) {
    if (!partIds.has(entry.Id)) {
      issues.push({
        severity: 'warning',
        source,
        message: `Tên hiển thị cho part không tồn tại: ${entry.Id}`
      });
    }
  }
}

function validateTextures(input: ValidationInput, issues: ValidationIssue[]): void {
  for (const [index, size] of input.textureSizes.entries()) {
    if (!isPowerOfTwo(size.width) || !isPowerOfTwo(size.height)) {
      issues.push({
        severity: 'warning',
        source: `texture ${index}`,
        message: `Kích thước ${size.width}×${size.height} không phải luỹ thừa của 2.`,
        hint: 'Một số runtime cũ và thiết bị di động cần texture luỹ thừa của 2.'
      });
    }
  }
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/** Convenience split for the UI, which shows errors and warnings separately. */
export function splitIssues(issues: ValidationIssue[]): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning')
  };
}
