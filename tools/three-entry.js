// Entry for web/vendor/three.min.js: only the three.js classes the 3D generators (web/smart3d.js) use, so the
// vendored file stays small. It is a plain script that defines a global THREE, so the app still runs from file://.
// Rebuild (needs the three package and esbuild, e.g. from any node project that has them):
//   NODE_PATH=<node_modules> esbuild tools/three-entry.js --bundle --format=iife --global-name=THREE --minify --outfile=web/vendor/three.min.js
// When smart3d.js needs another class, add it here and rebuild.
export {
  WebGLRenderer, WebGLRenderTarget, Scene, PerspectiveCamera, Color, Fog, FogExp2, Group, Object3D,
  Mesh, InstancedMesh, Points, LineSegments, BufferGeometry, BufferAttribute, Float32BufferAttribute, InstancedBufferAttribute,
  IcosahedronGeometry, TorusKnotGeometry, BoxGeometry, SphereGeometry, PlaneGeometry, EdgesGeometry, WireframeGeometry,
  MeshBasicMaterial, MeshStandardMaterial, PointsMaterial, LineBasicMaterial, ShaderMaterial,
  AmbientLight, DirectionalLight, PointLight, Matrix4, Vector3, Euler, Quaternion, MathUtils,
  AdditiveBlending, NormalBlending, DoubleSide, LinearSRGBColorSpace, ColorManagement, REVISION,
} from 'three';
