
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
  vec4 source = texture(uTexture, vTextureCoord); float flicker = 0.94 + 0.06 * sin(uTime * 16.0); float line = 0.92 + 0.08 * sin(vTextureCoord.y * uInputSize.y * 3.14159 + uTime * 2.0);
  finalColor = premultiply(unpremultiply(source) * mix(1.0, line * flicker, uAmount), source.a);
}
