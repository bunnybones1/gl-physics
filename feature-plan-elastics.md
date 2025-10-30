# Feature Plan: Elastic Connections Between Points

Goal:
Add support for elastic physical connections between points using four RGBA Float32 textures, each encoding one connection per point. Compute the aggregate elastic force per point in a shader and add it to velocityRT each frame.

Key Encoding:

- Each connection texture stores per-texel RGBA as:
  - R,G: XY of the target point that this point is elastically attached to (in uv space).
  - B: Desired connection length (default: one texel).
  - A: Elasticity (spring stiffness).
- There will be 4 such textures, allowing up to 4 connections per point (e.g., +X, -X, +Y, -Y).

Phases:

Phase 1: Data Model and Resource Allocation

- Define four WebGLRenderTarget or DataTexture Float32 RGBA textures: elastic0..elastic3.
- Set texture parameters: NearestFilter for min/mag, RGBAFormat, FloatType, NoColorSpace, flipY consistent with existing pipeline.
- Acceptance criteria:
  - The four textures are created, sized w x h, and visible in a debug preview list.
  - No changes in simulation output yet.

Phase 2: Initialization Patterns (Cardinal Neighborhood)

- Populate textures with default connections:
  - elastic0: one texel to the right (wrap at last column attaching to itself).
  - elastic1: one texel to the left (wrap at first column attaching to itself).
  - elastic2: one texel up (wrap at top row attaching to itself).
  - elastic3: one texel down (wrap at bottom row attaching to itself).
- Set B (desired length) to exactly one texel in uv: 1.0 / w or 1.0 / h for x/y; choose isotropic min or store scalar one-texel for now as provided.
- Set A (elasticity) to a tunable default (e.g., physicsSettings.elasticity or a constant).
- Acceptance criteria:
  - CPU-side arrays prepared and uploaded to the four textures correctly.
  - Visual inspection/spot checks confirm correct neighbor UVs, including borders.

Phase 3: Elastic Force Shader Material

- Create a MeshBasicMaterial that:
  - Reads current position texture (selfPos).
  - Samples up the 4 elastic connection textures.
  - For each connection: compute delta = targetPos - selfPos, len = length(delta), dir = normalize(delta), stretch = len - desiredLength; force = dir _ stretch _ elasticity.
  - Sum all forces and output as vec4(force.xy, 0, 1).
- Use additive blending to accumulate forces into velocityRT.
- Acceptance criteria:
  - The shader compiles and outputs zero when no stretch (i.e., at steady spacing).
  - Force magnitudes look reasonable in a debug render target.

Phase 4: Pipeline Integration

- Insert a render pass before velocity integration friction step:
  - Set plane.material to elasticForceToVelocityMat.
  - Render to velocityRT with additive blending.
- Ensure ordering with existing pressure vector integration is correct (pressure then elastic or vice versa); start with pressure then elastic and evaluate.
- Acceptance criteria:
  - Simulation remains stable with small timestep/elasticity.
  - Points resist separation/compression as per connections.

Implementation Notes:

- Use TEXEL_SIZE define (1.0 / w) to unify sizing in shaders.
- Sampling positions: target UV read from elastic textures; then sample positionRTBackBuffer (ingoingPositionTextureUniform) at those UVs for target positions to avoid read-after-write hazards.
- Border handling: initialize self-links for border texels to avoid reading outside; also safe to use fract(uv) for wrap.
- Strength scaling: multiply final force by a small factor consistent with current time step or integrate into friction/integration step.

Stretch Goals:

- Support variable desired length per-axis or per-connection (store in B as scalar; later support anisotropic length via additional texture or convention).
- Dynamic editing of elastic textures for constraints (mouse or procedural).
- Different elasticity per connection texture for anisotropic behavior.

Risks:

- Overly strong elasticity can destabilize. Provide clamp and damping.
- Precision and filtering: must use NearestFilter to preserve exact UVs.

Acceptance Summary:

- Four connection textures created, initialized, and previewable.
- New shader pass computes elastic force and adds it to velocityRT.
- Controls in physicsSettings allow enabling and tuning elasticity.
