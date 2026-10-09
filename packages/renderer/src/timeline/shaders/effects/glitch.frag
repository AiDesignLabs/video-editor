
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

float hash(float n) { return fract(sin(n) * 43758.5453); }
void main(void) {
  vec4 source = texture(uTexture, vTextureCoord); float band = floor(vTextureCoord.y * 36.0);
  float shift = (hash(band + floor(uTime * 12.0)) - 0.5) * uAmount * 0.08;
  vec3 color = sampleColor(vTextureCoord + vec2(shift, 0.0));
  if (hash(band * 2.7 + floor(uTime * 8.0)) > 0.83 * (1.0 - uAmount * 0.7)) color = color.bgr;
  finalColor = premultiply(color, source.a);
}
