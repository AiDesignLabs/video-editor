
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uAmount;
uniform float uTime;
vec3 unpremultiply(vec4 c) { return c.a > 0.0001 ? c.rgb / c.a : c.rgb; }
vec4 premultiply(vec3 rgb, float alpha) { return vec4(clamp(rgb, 0.0, 1.0) * alpha, alpha); }
vec3 sampleColor(vec2 uv) { return unpremultiply(texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw))); }

void main(void) {
  vec4 source = texture(uTexture, vTextureCoord); vec2 uv = vTextureCoord / max(uInputClamp.zw, vec2(0.0001));
  float edge = distance(uv, vec2(0.5)) / 0.70710678; float shade = 1.0 - uAmount * smoothstep(0.34, 0.92, edge);
  finalColor = premultiply(unpremultiply(source) * shade, source.a);
}
