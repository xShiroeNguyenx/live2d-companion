/**
 * TypeScript shapes for the Live2D Cubism runtime JSON files this editor writes.
 *
 * These mirror the public Cubism specification, not the framework's internal
 * classes: the editor keeps the JSON as the source of truth and rebuilds runtime
 * objects from it, so the preview always matches what will be exported.
 */

/** `.model3.json` — the entry point that ties every other file together. */
export interface Model3Json {
  Version: number;
  FileReferences: {
    Moc: string;
    Textures: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    Expressions?: Array<{ Name: string; File: string }>;
    Motions?: Record<string, Model3MotionEntry[]>;
    UserData?: string;
  };
  Groups?: Array<{
    Target: 'Parameter' | 'Part';
    Name: 'EyeBlink' | 'LipSync' | string;
    Ids: string[];
  }>;
  /** `Id` refers to an existing ArtMesh (drawable) — hit areas cannot be drawn from scratch. */
  HitAreas?: Array<{ Id: string; Name: string }>;
}

export interface Model3MotionEntry {
  File: string;
  Sound?: string;
  FadeInTime?: number;
  FadeOutTime?: number;
}

/** Segment type ids as they appear inline in a motion3 `Segments` array. */
export enum MotionSegmentType {
  Linear = 0,
  Bezier = 1,
  Stepped = 2,
  InverseStepped = 3
}

/** `.motion3.json` — animation curves. `Segments` is a flat number array; see MotionSerializer. */
export interface Motion3Json {
  Version: number;
  Meta: Motion3Meta;
  Curves: Motion3Curve[];
  UserData?: Array<{ Time: number; Value: string }>;
}

export interface Motion3Meta {
  Duration: number;
  Fps: number;
  Loop: boolean;
  /**
   * When true, bezier handles stay inside their segment and the runtime uses the
   * fast parametric evaluation. The editor always writes `true` so the preview
   * matches other runtimes (VTube Studio, pixi-live2d-display) exactly.
   */
  AreBeziersRestricted: boolean;
  CurveCount: number;
  TotalSegmentCount: number;
  TotalPointCount: number;
  UserDataCount: number;
  TotalUserDataSize: number;
  FadeInTime?: number;
  FadeOutTime?: number;
}

export interface Motion3Curve {
  Target: 'Parameter' | 'PartOpacity' | 'Model';
  Id: string;
  FadeInTime?: number;
  FadeOutTime?: number;
  Segments: number[];
}

/** `.physics3.json` — the chains that make hair, clothing and accessories sway. */
export interface Physics3Json {
  Version: number;
  Meta: {
    PhysicsSettingCount: number;
    TotalInputCount: number;
    TotalOutputCount: number;
    VertexCount: number;
    Fps?: number;
    EffectiveForces: {
      Gravity: Vector2Json;
      Wind: Vector2Json;
    };
    PhysicsDictionary: Array<{ Id: string; Name: string }>;
  };
  PhysicsSettings: PhysicsSetting[];
}

export interface PhysicsSetting {
  Id: string;
  Input: PhysicsInput[];
  Output: PhysicsOutput[];
  Vertices: PhysicsVertex[];
  Normalization: {
    Position: PhysicsNormalizationRange;
    Angle: PhysicsNormalizationRange;
  };
}

export interface PhysicsNormalizationRange {
  Minimum: number;
  Default: number;
  Maximum: number;
}

export interface PhysicsInput {
  Source: { Target: 'Parameter'; Id: string };
  Weight: number;
  Type: 'X' | 'Y' | 'Angle';
  Reflect: boolean;
}

export interface PhysicsOutput {
  Destination: { Target: 'Parameter'; Id: string };
  VertexIndex: number;
  Scale: number;
  Weight: number;
  Type: 'X' | 'Y' | 'Angle';
  Reflect: boolean;
}

export interface PhysicsVertex {
  Position: Vector2Json;
  Mobility: number;
  Delay: number;
  Acceleration: number;
  Radius: number;
}

export interface Vector2Json {
  X: number;
  Y: number;
}

/** `.exp3.json` — a named set of parameter offsets. */
export interface Exp3Json {
  Type: 'Live2D Expression';
  FadeInTime?: number;
  FadeOutTime?: number;
  Parameters: Array<{
    Id: string;
    Value: number;
    Blend?: 'Add' | 'Multiply' | 'Overwrite';
  }>;
}

/**
 * `.pose3.json` — each group is a radio set: exactly one part visible, the rest
 * faded out. This is what makes outfits and accessories switchable.
 */
export interface Pose3Json {
  Type: 'Live2D Pose';
  FadeInTime?: number;
  Groups: Array<Array<{ Id: string; Link: string[] }>>;
}

/** `.cdi3.json` — human-readable display names shown throughout the editor. */
export interface Cdi3Json {
  Version: number;
  Parameters: Array<{ Id: string; GroupId: string; Name: string }>;
  ParameterGroups: Array<{ Id: string; GroupId: string; Name: string }>;
  Parts: Array<{ Id: string; Name: string }>;
}

/** `.userdata3.json` — free-form per-drawable metadata. */
export interface UserData3Json {
  Version: number;
  Meta: { UserDataCount: number; TotalUserDataSize: number };
  UserData: Array<{ Target: string; Id: string; Value: string }>;
}
