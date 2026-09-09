# Third-Party Notices

Live2D Companion Studio bundles the following third-party components. Each block
lists the source, the applicable licence, and the attribution required.

---

## Live2D Cubism Core

- **Files**: `vendor/live2dcubismcore/live2dcubismcore.js`,
  `live2dcubismcore.min.js`, `live2dcubismcore.d.ts`
- **Version**: Cubism 5 SDK for Web R5 (Core 6.0.1)
- **Owner**: Live2D Inc.
- **Licence**: [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).
  The SDK's own `RedistributableFiles.txt` names exactly these three files as
  redistributable; nothing else from the Core package is shipped.
- **Publication licence**: distributing an application built on the Cubism SDK
  requires agreeing to the [SDK Release License](https://www.live2d.com/en/sdk/license/).
  It is free for individuals and small-scale enterprises below Live2D's annual
  revenue threshold; above it, a paid Publication License Agreement is required.
  **Confirm current terms before any public release.**
- **Attribution**: © Live2D Inc. All rights reserved. "Live2D" and "Cubism" are
  trademarks of Live2D Inc.

## Live2D Cubism Web Framework

- **Files**: `vendor/cubism-web-framework/` (TypeScript source and `Shaders/`)
- **Version**: Cubism 5 SDK for Web R5 (commit `d4da0aa`, 2026-04-02)
- **Source**: https://github.com/Live2D/CubismWebFramework
- **Licence**: [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)
  — permits use and modification of the source.
- **Modifications**: any change we make is recorded under
  `vendor/patches/`. Re-apply those after upgrading the SDK, then run
  `npm run build:framework-types`.

## Live2D Sample Model — Hiyori

- **Files**: `resources/sample-models/Hiyori/`
- **Owner**: Live2D Inc.
- **Licence**: [Free Material License Agreement](https://www.live2d.com/en/learn/sample/)
  plus the Sample Data Terms. Commercial use is permitted for general users and
  small-scale enterprises within Live2D's revenue threshold. Erotic, violent or
  discriminatory use is prohibited. Redistribution is allowed only as part of an
  end product.
- **Attribution**: "Hiyori" © Live2D Inc., used under the Free Material License.
- **Purpose here**: bundled so a first run has a model to open without the user
  having to source one.

---

## This project's own code

Everything outside `vendor/` and `resources/sample-models/` is released under
the MIT License. Third-party assets retain their original licences.
